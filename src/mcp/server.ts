#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { z } from "zod";
import { writeFile } from "node:fs";
import { exec } from "node:child_process";
import { analyzeFile } from "../core/engine/rule-engine.js";
import { loadFile } from "../core/engine/loader.js";
import { parseDesignData } from "../core/engine/design-data-parser.js";
import { enrichWithDesignContext } from "../core/adapters/figma-mcp-adapter.js";
import { calculateScores, formatScoreSummary } from "../core/engine/scoring.js";
import { generateHtmlReport } from "../core/report-html/index.js";
import { getReportsDir, ensureReportsDir } from "../core/engine/config-store.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../core/rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../core/rules/custom/config-loader.js";
import { loadCustomRules } from "../core/rules/custom/custom-rule-loader.js";
import { ruleRegistry } from "../core/rules/rule-registry.js";
import type { RuleConfig, RuleId } from "../core/contracts/rule.js";
import { initMonitoring, trackEvent, trackError, shutdownMonitoring, EVENTS } from "../core/monitoring/index.js";
import { POSTHOG_API_KEY as BUILTIN_PH_KEY, SENTRY_DSN as BUILTIN_SENTRY_DSN } from "../core/monitoring/keys.js";
import { getTelemetryEnabled, getPosthogApiKey, getSentryDsn, getDeviceId } from "../core/engine/config-store.js";

// Load .env for FIGMA_TOKEN
config();

// Import rules to register them
import "../core/rules/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const server = new McpServer({
  name: "canicode",
  version: pkg.version,
});

server.tool(
  "analyze",
  `Analyze a Figma design for development-friendliness and AI-friendliness.

Two ways to provide design data:
1. designData — Pass Figma node data directly (from Figma MCP get_metadata). Recommended when using Figma MCP.
2. input — Figma URL (fetches via REST API, requires FIGMA_TOKEN).

Typical flow with Figma MCP (recommended, no token needed):
  Step 1: Call the official Figma MCP's get_metadata tool to get the node tree
  Step 2: Call the official Figma MCP's get_design_context tool on the same node to get style data
  Step 3: Pass get_metadata result as designData and get_design_context code as designContext to this tool

The designContext parameter enriches analysis with style information (colors, layout, spacing, effects)
that get_metadata alone cannot provide. Without it, token and layout rules may not fire.

IMPORTANT — Before calling this tool, check which data source is available:
- If the official Figma MCP (https://mcp.figma.com/mcp) is connected: use get_metadata + get_design_context → designData + designContext flow. No token needed.
- If Figma MCP is NOT connected: use the input parameter with a Figma URL. This requires a FIGMA_TOKEN.
  Tell the user: "The official Figma MCP server is not connected. To use without a token, set it up:
  claude mcp add -s project -t http figma https://mcp.figma.com/mcp
  Otherwise, provide a Figma API token via FIGMA_TOKEN env var or the token parameter."`,
  {
    designData: z.string().optional().describe("Figma node data from Figma MCP get_metadata (XML or JSON). Pass this instead of input when using Figma MCP."),
    designContext: z.string().optional().describe("Code output from Figma MCP get_design_context. Enriches designData with style info (colors, layout, spacing, effects). Highly recommended alongside designData."),
    input: z.string().optional().describe("Figma URL. Used when designData is not provided. Requires FIGMA_TOKEN."),
    fileKey: z.string().optional().describe("Figma file key (used with designData to generate deep links)"),
    fileName: z.string().optional().describe("Figma file name (used with designData for display)"),
    token: z.string().optional().describe("Figma API token (falls back to FIGMA_TOKEN env var)"),
    preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional().describe("Analysis preset"),
    targetNodeId: z.string().optional().describe("Scope analysis to a specific node ID"),
    configPath: z.string().optional().describe("Path to config JSON file for rule overrides"),
    customRulesPath: z.string().optional().describe("Path to custom rules JSON file"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    title: "Analyze Figma Design",
  },
  async ({ designData, designContext, input, fileKey, fileName, token, preset, targetNodeId, configPath, customRulesPath }) => {
    trackEvent(EVENTS.MCP_TOOL_CALLED, { tool: "analyze" });
    try {
      let file;
      let nodeId: string | undefined;

      if (designData) {
        // Direct data from Figma MCP
        file = parseDesignData(designData, fileKey ?? "unknown", fileName);

        // Enrich with design context if provided
        if (designContext) {
          enrichWithDesignContext(file, designContext, targetNodeId);
        }
      } else if (input) {
        // Fetch via REST API or load from fixture
        const loaded = await loadFile(input, token);
        file = loaded.file;
        nodeId = loaded.nodeId;
      } else {
        throw new Error("Provide either designData (from Figma MCP) or input (Figma URL).");
      }

      const effectiveNodeId = targetNodeId ?? nodeId;

      let configs: Record<string, RuleConfig> = preset
        ? { ...getConfigsWithPreset(preset as Preset) }
        : { ...RULE_CONFIGS };

      if (configPath) {
        const configFile = await loadConfigFile(configPath);
        configs = mergeConfigs(configs, configFile);
      }

      if (customRulesPath) {
        const { rules, configs: customConfigs } = await loadCustomRules(customRulesPath);
        for (const rule of rules) {
          ruleRegistry.register(rule);
        }
        configs = { ...configs, ...customConfigs };
      }

      const result = analyzeFile(file, {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(effectiveNodeId ? { targetNodeId: effectiveNodeId } : {}),
      });

      const scores = calculateScores(result);
      const summary = formatScoreSummary(scores);

      // Generate HTML report (with Figma token for comment buttons)
      const figmaToken = token ?? process.env["FIGMA_TOKEN"];
      const html = generateHtmlReport(file, result, scores, { figmaToken });

      // Save report to disk
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      ensureReportsDir();
      const reportPath = `${getReportsDir()}/report-${ts}-${file.fileKey}.html`;
      await new Promise<void>((resolve, reject) => {
        writeFile(reportPath, html, "utf-8", (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Open report in browser
      const openCmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
      exec(`${openCmd} "${reportPath}"`);

      trackEvent(EVENTS.ANALYSIS_COMPLETED, {
        nodeCount: result.nodeCount,
        issueCount: result.issues.length,
        grade: scores.overall.grade,
        percentage: scores.overall.percentage,
        source: designData ? "mcp-data" : "url",
      });

      const issuesByRule: Record<string, number> = {};
      for (const issue of result.issues) {
        const id = issue.violation.ruleId;
        issuesByRule[id] = (issuesByRule[id] ?? 0) + 1;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                fileName: file.name,
                nodeCount: result.nodeCount,
                maxDepth: result.maxDepth,
                issueCount: result.issues.length,
                scores: {
                  overall: scores.overall,
                  categories: scores.byCategory,
                },
                issuesByRule,
                summary,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      trackError(
        error instanceof Error ? error : new Error(String(error)),
        { tool: "analyze" },
      );
      trackEvent(EVENTS.ANALYSIS_FAILED, {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "list-rules",
  "List all available analysis rules with their current configuration",
  {},
  {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    title: "List Analysis Rules",
  },
  async () => {
    const rules = ruleRegistry.getAll().map((rule) => {
      const config =
        RULE_CONFIGS[rule.definition.id as keyof typeof RULE_CONFIGS];
      return {
        id: rule.definition.id,
        name: rule.definition.name,
        category: rule.definition.category,
        severity: config?.severity,
        score: config?.score,
        enabled: config?.enabled,
        why: rule.definition.why,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(rules, null, 2),
        },
      ],
    };
  },
);

server.tool(
  "docs",
  `Get the customization guide for CanICode.

Returns documentation on:
- Config overrides (excludeNodeNames, excludeNodeTypes, gridBase, colorTolerance, per-rule score/severity/enabled)
- Custom rules (how to add project-specific checks)
- All 39 rule IDs with default scores and severity
- Example configs (strict, relaxed, mobile-first)

Use this when the user asks about customization, configuration, rule settings, or how to adjust scores.`,
  {
    topic: z.enum(["all", "config", "custom-rules", "rules"]).optional()
      .describe("Specific topic: config (overrides), custom-rules (adding new rules), rules (all rule IDs). Default: all"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    title: "Get Customization Guide",
  },
  async ({ topic }) => {
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    try {
      // Resolve docs/CUSTOMIZATION.md relative to the package
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const docPath = resolve(__dirname, "../../docs/CUSTOMIZATION.md");
      let content: string;

      try {
        content = await readFile(docPath, "utf-8");
      } catch {
        // Fallback: try from package root (npm installed location)
        const altPath = resolve(__dirname, "../docs/CUSTOMIZATION.md");
        content = await readFile(altPath, "utf-8");
      }

      // Filter by topic if specified
      if (topic && topic !== "all") {
        const sections: Record<string, string> = {
          "config": "## Config Overrides",
          "custom-rules": "## Custom Rules",
          "rules": "### All Rule IDs",
        };
        const header = sections[topic];
        if (header) {
          const startIdx = content.indexOf(header);
          if (startIdx !== -1) {
            const nextH2 = content.indexOf("\n## ", startIdx + header.length);
            content = nextH2 !== -1
              ? content.slice(startIdx, nextH2)
              : content.slice(startIdx);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: content }],
      };
    } catch {
      return {
        content: [{ type: "text" as const, text: "Customization guide not found. See: https://github.com/let-sunny/canicode/blob/main/docs/CUSTOMIZATION.md" }],
        isError: true,
      };
    }
  },
);

async function main() {
  const monitoringConfig: Parameters<typeof initMonitoring>[0] = {
    environment: "mcp",
    version: pkg.version,
    enabled: getTelemetryEnabled(),
  };
  const phKey = getPosthogApiKey() || BUILTIN_PH_KEY;
  if (phKey) monitoringConfig.posthogApiKey = phKey;
  const sDsn = getSentryDsn() || BUILTIN_SENTRY_DSN;
  if (sDsn) monitoringConfig.sentryDsn = sDsn;
  monitoringConfig.distinctId = getDeviceId();
  initMonitoring(monitoringConfig);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

process.on("beforeExit", () => {
  shutdownMonitoring();
});

main().catch(console.error);
