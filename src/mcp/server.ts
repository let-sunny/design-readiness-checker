#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { z } from "zod";
import { writeFile } from "node:fs";
import { exec } from "node:child_process";
import { analyzeFile } from "../core/rule-engine.js";
import { loadFile } from "../core/loader.js";
import { parseDesignData } from "../core/design-data-parser.js";
import { calculateScores, formatScoreSummary } from "../core/scoring.js";
import { generateHtmlReport } from "../report-html/index.js";
import { getReportsDir, ensureReportsDir } from "../core/config-store.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../rules/custom/config-loader.js";
import { loadCustomRules } from "../rules/custom/custom-rule-loader.js";
import { ruleRegistry } from "../rules/rule-registry.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";

// Load .env for FIGMA_TOKEN
config();

// Import rules to register them
import "../rules/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const server = new McpServer({
  name: "aiready",
  version: pkg.version,
});

server.tool(
  "analyze",
  `Analyze a Figma design for development-friendliness and AI-friendliness.

Three ways to provide design data:
1. designData — Pass Figma node data directly (from Figma MCP get_metadata). Recommended when Claude Code has Figma MCP.
2. input — Figma URL (fetches via REST API, requires FIGMA_TOKEN) or local JSON fixture path.
3. Both — designData takes priority over input.

Typical flow with Figma MCP:
  Step 1: Call Figma MCP get_metadata to get the node tree
  Step 2: Pass the result as designData to this tool`,
  {
    designData: z.string().optional().describe("Figma node data from Figma MCP get_metadata (XML or JSON). Pass this instead of input when using Figma MCP."),
    input: z.string().optional().describe("Figma URL or JSON fixture path. Used when designData is not provided. Figma URL requires FIGMA_TOKEN."),
    fileKey: z.string().optional().describe("Figma file key (used with designData to generate deep links)"),
    fileName: z.string().optional().describe("Figma file name (used with designData for display)"),
    token: z.string().optional().describe("Figma API token (falls back to FIGMA_TOKEN env var)"),
    preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional().describe("Analysis preset"),
    targetNodeId: z.string().optional().describe("Scope analysis to a specific node ID"),
    configPath: z.string().optional().describe("Path to config JSON file for rule overrides"),
    customRulesPath: z.string().optional().describe("Path to custom rules JSON file"),
  },
  async ({ designData, input, fileKey, fileName, token, preset, targetNodeId, configPath, customRulesPath }) => {
    try {
      let file;
      let nodeId: string | undefined;

      if (designData) {
        // Direct data from Figma MCP
        file = parseDesignData(designData, fileKey ?? "unknown", fileName);
      } else if (input) {
        // Fetch via REST API or load from fixture
        const loaded = await loadFile(input, token, "api");
        file = loaded.file;
        nodeId = loaded.nodeId;
      } else {
        throw new Error("Provide either designData (from Figma MCP) or input (Figma URL / fixture path).");
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

      // Generate HTML report
      const html = generateHtmlReport(file, result, scores);

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
