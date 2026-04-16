#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config } from "dotenv";
import { z } from "zod";
import { writeFile } from "node:fs";
import { exec } from "node:child_process";
import { analyzeFile } from "../core/engine/rule-engine.js";
import { loadFile, isJsonFile, isFixtureDir } from "../core/engine/loader.js";
import { calculateScores, buildResultJson } from "../core/engine/scoring.js";
import { generateGotchaSurvey } from "../core/gotcha/survey-generator.js";
import { generateHtmlReport } from "../core/report-html/index.js";
import { getReportsDir, ensureReportsDir } from "../core/engine/config-store.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../core/rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../core/rules/config-loader.js";
import { ruleRegistry } from "../core/rules/rule-registry.js";
import type { RuleConfig, RuleId } from "../core/contracts/rule.js";
import { initMonitoring, trackEvent, trackError, shutdownMonitoring, EVENTS } from "../core/monitoring/index.js";
import { POSTHOG_API_KEY as BUILTIN_PH_KEY, SENTRY_DSN as BUILTIN_SENTRY_DSN } from "../core/monitoring/keys.js";
import { getTelemetryEnabled, getPosthogApiKey, getSentryDsn, getDeviceId } from "../core/engine/config-store.js";

// Load .env for FIGMA_TOKEN (quiet: suppress dotenv's stdout banner — MCP uses stdout for JSON-RPC)
config({ quiet: true });

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

Provide a Figma URL or fixture path via the input parameter. Requires FIGMA_TOKEN env var or the token parameter for live Figma URLs.`,
  {
    input: z.string().describe("Figma URL or local fixture path. Requires FIGMA_TOKEN for live URLs."),
    token: z.string().optional().describe("Figma API token (falls back to FIGMA_TOKEN env var)"),
    preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional().describe("Analysis preset"),
    targetNodeId: z.string().optional().describe("Scope analysis to a specific node ID"),
    configPath: z.string().optional().describe("Path to config JSON file for rule overrides"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    title: "Analyze Figma Design",
  },
  async ({ input, token, preset, targetNodeId, configPath }) => {
    trackEvent(EVENTS.MCP_TOOL_CALLED, { tool: "analyze" });
    try {
      // Fetch via REST API or load from fixture
      const { file, nodeId } = await loadFile(input, token);

      const effectiveNodeId = targetNodeId ?? nodeId;

      let configs: Record<string, RuleConfig> = preset
        ? { ...getConfigsWithPreset(preset as Preset) }
        : { ...RULE_CONFIGS };

      if (configPath) {
        const configFile = await loadConfigFile(configPath);
        configs = mergeConfigs(configs, configFile);
      }

      const result = analyzeFile(file, {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(effectiveNodeId ? { targetNodeId: effectiveNodeId } : {}),
      });

      const scores = calculateScores(result, configs as Record<RuleId, RuleConfig>);

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
        source: isJsonFile(input) || isFixtureDir(input) ? "fixture" : "figma",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(buildResultJson(file.name, result, scores, { fileKey: file.fileKey }), null, 2),
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
  "gotcha-survey",
  `Generate a gotcha survey from a Figma design analysis.

Analyzes the design and returns a GotchaSurvey JSON with designGrade, isReadyForCodeGen, and questions[].
When isReadyForCodeGen is true, questions will be empty (no survey needed).

Provide a Figma URL or fixture path via the input parameter. Requires FIGMA_TOKEN env var or the token parameter for live Figma URLs.`,
  {
    input: z.string().describe("Figma URL or local fixture path. Requires FIGMA_TOKEN for live URLs."),
    token: z.string().optional().describe("Figma API token (falls back to FIGMA_TOKEN env var)"),
    preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional().describe("Analysis preset"),
    targetNodeId: z.string().optional().describe("Scope analysis to a specific node ID"),
    configPath: z.string().optional().describe("Path to config JSON file for rule overrides"),
  },
  {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
    title: "Gotcha Survey",
  },
  async ({ input, token, preset, targetNodeId, configPath }) => {
    trackEvent(EVENTS.MCP_TOOL_CALLED, { tool: "gotcha-survey" });
    try {
      const { file, nodeId } = await loadFile(input, token);

      const effectiveNodeId = targetNodeId ?? nodeId;

      let configs: Record<string, RuleConfig> = preset
        ? { ...getConfigsWithPreset(preset as Preset) }
        : { ...RULE_CONFIGS };

      if (configPath) {
        const configFile = await loadConfigFile(configPath);
        configs = mergeConfigs(configs, configFile);
      }

      const result = analyzeFile(file, {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(effectiveNodeId ? { targetNodeId: effectiveNodeId } : {}),
      });

      const scores = calculateScores(result, configs as Record<RuleId, RuleConfig>);
      const survey = generateGotchaSurvey(result, scores);

      trackEvent(EVENTS.ANALYSIS_COMPLETED, {
        nodeCount: result.nodeCount,
        issueCount: result.issues.length,
        grade: scores.overall.grade,
        percentage: scores.overall.percentage,
        source: isJsonFile(input) || isFixtureDir(input) ? "fixture" : "figma",
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(survey, null, 2),
          },
        ],
      };
    } catch (error) {
      trackError(
        error instanceof Error ? error : new Error(String(error)),
        { tool: "gotcha-survey" },
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
- visual-compare: Pixel-level comparison between Figma and AI-generated code
- design-tree: Generate DOM-like design tree from fixture for AI code generation
- all: Full customization guide

Use this when the user asks about how to use canicode, configuration, rules, visual comparison, or any feature.`,
  {
    topic: z.enum(["all", "setup", "rules", "config", "visual-compare", "design-tree"]).optional()
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

    // Inline topics (not from CUSTOMIZATION.md)
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
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
\`\`\`

Requires FIGMA_TOKEN for live Figma URL analysis.`,

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

    // Fall back to CUSTOMIZATION.md for config/rules/all
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");

    try {
      const __dirname = dirname(fileURLToPath(import.meta.url));
      const docPath = resolve(__dirname, "../../docs/CUSTOMIZATION.md");
      let content: string;

      try {
        content = await readFile(docPath, "utf-8");
      } catch {
        const altPath = resolve(__dirname, "../docs/CUSTOMIZATION.md");
        content = await readFile(altPath, "utf-8");
      }

      if (selectedTopic !== "all") {
        const sections: Record<string, string> = {
          "config": "## Config Overrides",
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
      const { visualCompare } = await import("../core/comparison/visual-compare.js");
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
