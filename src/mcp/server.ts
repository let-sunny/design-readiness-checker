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
import { calculateScores, buildResultJson } from "../core/engine/scoring.js";
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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(buildResultJson(file.name, result, scores), null, 2),
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
  "version",
  "Get the current canicode version. Use this when the user asks what version is installed.",
  {},
  {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    title: "Get Version",
  },
  async () => ({
    content: [{ type: "text" as const, text: `canicode v${pkg.version}` }],
  }),
);

server.tool(
  "docs",
  `Get documentation for CanICode.

Available topics:
- setup: Installation and token configuration
- rules: All rule IDs with default scores and severity
- config: Config overrides (scores, severity, node exclusions, thresholds)
- custom-rules: How to add project-specific checks
- visual-compare: Pixel-level comparison between Figma and AI-generated code
- design-tree: Generate DOM-like design tree from fixture for AI code generation
- all: Full customization guide

Use this when the user asks about how to use canicode, configuration, rules, visual comparison, or any feature.`,
  {
    topic: z.enum(["all", "setup", "rules", "config", "custom-rules", "visual-compare", "design-tree"]).optional()
      .describe("Topic to retrieve. Default: all"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false,
    title: "Get Documentation",
  },
  async ({ topic }) => {
    const selectedTopic = topic ?? "all";

    // Inline topics (not from REFERENCE.md)
    const inlineTopics: Record<string, string> = {
      "setup": `# Setup

## CLI
\`\`\`bash
npm install -g canicode
canicode init --token figd_xxxxxxxxxxxxx
\`\`\`

Get your token: Figma → Settings → Security → Personal access tokens → Generate new token

## MCP Server (Claude Code / Cursor / Claude Desktop)
\`\`\`bash
claude mcp add canicode -- npx -y -p canicode canicode-mcp
claude mcp add -s project -t http figma https://mcp.figma.com/mcp
\`\`\`

With Figma API token (no Figma MCP needed):
\`\`\`bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
\`\`\`

## CLI vs MCP

| Feature | CLI (FIGMA_TOKEN) | MCP (Figma MCP) |
|---------|:-:|:-:|
| Component master trees | ✅ | ❌ |
| Component metadata | ✅ | ❌ |
| Annotations (dev mode) | ❌ private beta | ✅ data-annotations |
| FIGMA_TOKEN required | ✅ | ❌ |

Use CLI for accurate component analysis. Use MCP for quick checks and annotation-aware workflows.`,

      "visual-compare": `# Visual Compare

Pixel-level comparison between Figma design and AI-generated code.

## Usage
\`\`\`bash
canicode visual-compare ./index.html --figma-url 'https://www.figma.com/design/ABC/File?node-id=1-234'
\`\`\`

## Options
| Option | Default | Description |
|--------|---------|-------------|
| --figma-url <url> | (required) | Figma URL with node-id |
| --token <token> | FIGMA_TOKEN env | Figma API token |
| --output <dir> | /tmp/canicode-visual-compare | Output directory |
| --width <px> | (inferred from Figma PNG ÷ scale) | Logical viewport width in CSS px |
| --height <px> | (inferred from Figma PNG ÷ scale) | Logical viewport height in CSS px |
| --figma-scale <n> | 2 | Figma export scale (matches @2x fixture PNGs) |

Viewport and device pixel ratio are auto-inferred from the Figma PNG dimensions and export scale. Override only when needed.

## Output Files
/tmp/canicode-visual-compare/
  figma.png — Figma screenshot (at export scale, default @2x)
  code.png — Playwright render of your HTML
  diff.png — Pixel diff (red = different)

## JSON Output (stdout)
{
  "similarity": 87,
  "diffPixels": 1340,
  "totalPixels": 102400,
  "width": 800, "height": 600,
  "figmaScreenshot": "...", "codeScreenshot": "...", "diff": "..."
}

## How It Works
1. Fetches Figma screenshot via REST API (scale=2)
2. Reads screenshot dimensions
3. Renders HTML with Playwright at same viewport size
4. Compares pixel-by-pixel with pixelmatch (threshold: 0.1)

## Requirements
- npx playwright install chromium
- Figma API token with read access`,

      "design-tree": `# Design Tree

Generate a DOM-like design tree from a Figma fixture. Converts the node tree to a concise text format with inline CSS styles — 50-100x smaller than raw JSON.

## Usage
\`\`\`bash
canicode design-tree ./fixtures/design
canicode design-tree ./fixtures/design --output tree.txt
canicode design-tree "https://www.figma.com/design/ABC/File?node-id=1-234"
\`\`\`

## Output Format
Each node = one line with name, type, dimensions, followed by CSS-ready styles:
\`\`\`
Hero Form (INSTANCE, 375x960)
  style: display: flex; flex-direction: column; gap: 32px; padding: 160px 24px; background: #F5F5F5
  Title (TEXT, 117x58)
    style: font-family: "Inter"; font-weight: 700; font-size: 48px; color: #2C2C2C; text: "Title"
\`\`\`

## Use Cases
- AI code generation — feed this to an LLM instead of raw 250KB fixture JSON
- Calibration pipeline — Converter uses this for accurate code reproduction
- Debugging — quickly see the design structure and styles`,
    };

    // Check inline topics first
    if (selectedTopic in inlineTopics) {
      return {
        content: [{ type: "text" as const, text: `canicode v${pkg.version}\n\n${inlineTopics[selectedTopic]}` }],
      };
    }

    // Fall back to REFERENCE.md for config/custom-rules/rules/all
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const docPath = resolve(__dirname, "../../docs/REFERENCE.md");
      let content: string;

      try {
        content = await readFile(docPath, "utf-8");
      } catch {
        const altPath = resolve(__dirname, "../docs/REFERENCE.md");
        content = await readFile(altPath, "utf-8");
      }

      if (selectedTopic !== "all") {
        const sections: Record<string, string> = {
          "config": "## Config Overrides",
          "custom-rules": "## Custom Rules",
          "rules": "### All Rule IDs",
        };
        const header = sections[selectedTopic];
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
        content: [{ type: "text" as const, text: `canicode v${pkg.version}\n\n${content}` }],
      };
    } catch {
      return {
        content: [{ type: "text" as const, text: "Documentation not found. See: https://github.com/let-sunny/canicode" }],
        isError: true,
      };
    }
  },
);

server.tool(
  "visual-compare",
  `Compare AI-generated code against a Figma design at the pixel level.

Takes an HTML file path and a Figma URL, renders the HTML with Playwright,
fetches the Figma screenshot, and computes pixel-level similarity using pixelmatch.

Returns similarity percentage (0-100%), diff pixel count, and paths to
the Figma screenshot, code screenshot, and diff image.

Logical viewport and device pixel ratio are inferred from the Figma PNG export scale (default 2×) so code.png matches figma.png pixels.

Requires: Playwright with Chromium installed, Figma API token.`,
  {
    codePath: z.string().describe("Path to the HTML file to render and compare"),
    figmaUrl: z.string().describe("Figma URL with node-id (e.g., https://www.figma.com/design/ABC/File?node-id=1-234)"),
    token: z.string().optional().describe("Figma API token (falls back to FIGMA_TOKEN env var)"),
    outputDir: z.string().optional().describe("Output directory for screenshots (default: /tmp/canicode-visual-compare)"),
    figmaExportScale: z.number().int().min(1).max(4).optional().describe("Figma export scale (default 2, matches @2x fixture PNGs)"),
  },
  {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
    title: "Visual Compare",
  },
  async ({ codePath, figmaUrl, token, outputDir, figmaExportScale }) => {
    try {
      const { visualCompare } = await import("../core/engine/visual-compare.js");
      const figmaToken = token ?? process.env["FIGMA_TOKEN"];
      if (!figmaToken) {
        return {
          content: [{ type: "text" as const, text: "Error: Figma token required. Provide via token parameter or FIGMA_TOKEN env var." }],
          isError: true,
        };
      }

      const result = await visualCompare({
        figmaUrl,
        figmaToken,
        codePath,
        outputDir,
        ...(figmaExportScale !== undefined ? { figmaExportScale } : {}),
      });

      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            similarity: result.similarity,
            diffPixels: result.diffPixels,
            totalPixels: result.totalPixels,
            width: result.width,
            height: result.height,
            figmaScreenshot: result.figmaScreenshotPath,
            codeScreenshot: result.codeScreenshotPath,
            diff: result.diffPath,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
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
