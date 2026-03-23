#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { config } from "dotenv";
import cac from "cac";

// Load .env file
config();

import { parseFigmaUrl } from "../core/adapters/figma-url-parser.js";
import type { AnalysisFile } from "../core/contracts/figma-node.js";
import type { RuleConfig, RuleId } from "../core/contracts/rule.js";
import { analyzeFile } from "../core/engine/rule-engine.js";
import { loadFile, isFigmaUrl, isJsonFile } from "../core/engine/loader.js";
import {
  getFigmaToken, initAiready, getConfigPath, getReportsDir, ensureReportsDir,
  readConfig, getTelemetryEnabled, setTelemetryEnabled, getPosthogApiKey, getSentryDsn, getDeviceId,
} from "../core/engine/config-store.js";
import { calculateScores, formatScoreSummary, buildResultJson } from "../core/engine/scoring.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../core/rules/rule-config.js";
import { ruleRegistry } from "../core/rules/rule-registry.js";
import { loadCustomRules } from "../core/rules/custom/custom-rule-loader.js";
import { loadConfigFile, mergeConfigs } from "../core/rules/custom/config-loader.js";
import { generateHtmlReport } from "../core/report-html/index.js";
import {
  runCalibration,
  runCalibrationAnalyze,
  runCalibrationEvaluate,
  filterConversionCandidates,
} from "../agents/orchestrator.js";
import { handleDocs } from "./docs.js";
import { initMonitoring, trackEvent, trackError, shutdownMonitoring, EVENTS } from "../core/monitoring/index.js";
import { POSTHOG_API_KEY as BUILTIN_PH_KEY, SENTRY_DSN as BUILTIN_SENTRY_DSN } from "../core/monitoring/keys.js";

// Import rules to register them
import "../core/rules/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const cli = cac("canicode");

// Initialise monitoring (fire-and-forget, never blocks startup)
{
  const monitoringConfig: Parameters<typeof initMonitoring>[0] = {
    environment: "cli",
    version: pkg.version,
    enabled: getTelemetryEnabled(),
  };
  const phKey = getPosthogApiKey() || BUILTIN_PH_KEY;
  if (phKey) monitoringConfig.posthogApiKey = phKey;
  const sDsn = getSentryDsn() || BUILTIN_SENTRY_DSN;
  if (sDsn) monitoringConfig.sentryDsn = sDsn;
  monitoringConfig.distinctId = getDeviceId();
  initMonitoring(monitoringConfig);
}

process.on("beforeExit", () => {
  shutdownMonitoring();
});

const MAX_NODES_WITHOUT_SCOPE = 500;

/**
 * Find all FRAME/COMPONENT nodes with 50-500 nodes in their subtree,
 * then pick one at random. Used to auto-scope fixture analysis.
 */
function pickRandomScope(root: AnalysisFile["document"]): AnalysisFile["document"] | null {
  const candidates: AnalysisFile["document"][] = [];

  function collect(node: AnalysisFile["document"]): void {
    const isContainer = node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION";
    if (isContainer) {
      const size = countNodes(node);
      if (size >= 50 && size <= 500) {
        candidates.push(node);
      }
    }
    if ("children" in node && node.children) {
      for (const child of node.children) {
        collect(child);
      }
    }
  }

  collect(root);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx] ?? null;
}

function countNodes(node: { children?: readonly unknown[] | undefined }): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child as { children?: readonly unknown[] | undefined });
    }
  }
  return count;
}

interface AnalyzeOptions {
  preset?: Preset;
  output?: string;
  token?: string;
  api?: boolean;
  screenshot?: boolean;
  customRules?: string;
  config?: string;
  noOpen?: boolean;
  json?: boolean;
}

cli
  .command("analyze <input>", "Analyze a Figma file or JSON fixture")
  .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
  .option("--output <path>", "HTML report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--api", "Load via Figma REST API (requires FIGMA_TOKEN)")
  .option("--screenshot", "Include screenshot comparison in report (requires ANTHROPIC_API_KEY)")
  .option("--custom-rules <path>", "Path to custom rules JSON file")
  .option("--config <path>", "Path to config JSON file (override rule scores/settings)")
  .option("--no-open", "Don't open report in browser after analysis")
  .option("--json", "Output JSON results to stdout (same format as MCP)")
  .example("  canicode analyze https://www.figma.com/design/ABC123/MyDesign")
  .example("  canicode analyze https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN")
  .example("  canicode analyze ./fixtures/design.json --output report.html")
  .example("  canicode analyze ./fixtures/design.json --custom-rules ./my-rules.json")
  .example("  canicode analyze ./fixtures/design.json --config ./my-config.json")
  .action(async (input: string, options: AnalyzeOptions) => {
    const analysisStart = Date.now();
    trackEvent(EVENTS.ANALYSIS_STARTED, { source: isJsonFile(input) ? "fixture" : "figma" });
    try {
      // Check init
      if (!options.token && !getFigmaToken() && !isJsonFile(input)) {
        throw new Error(
          "canicode is not configured. Run 'canicode init --token YOUR_TOKEN' first."
        );
      }

      // Validate --screenshot requirements
      if (options.screenshot) {
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];
        if (!anthropicKey) {
          throw new Error(
            "ANTHROPIC_API_KEY required for --screenshot mode. Set it in .env or environment."
          );
        }
        console.log("Screenshot comparison mode enabled (coming soon).\n");
      }

      // Load file
      const { file, nodeId } = await loadFile(input, options.token);

      // Scope enforcement for large files
      const totalNodes = countNodes(file.document);
      let effectiveNodeId = nodeId;

      if (!effectiveNodeId && totalNodes > MAX_NODES_WITHOUT_SCOPE) {
        if (isJsonFile(input)) {
          // Fixture: auto-pick a random suitable FRAME
          const picked = pickRandomScope(file.document);
          if (picked) {
            effectiveNodeId = picked.id;
            console.log(`\nAuto-scoped to "${picked.name}" (${picked.id}, ${countNodes(picked)} nodes) — file too large (${totalNodes} nodes) for unscoped analysis.`);
          } else {
            console.warn(`\nWarning: Could not find a suitable scope in fixture. Analyzing all ${totalNodes} nodes.`);
          }
        } else {
          // Figma URL: require explicit node-id
          throw new Error(
            `Too many nodes (${totalNodes}) for unscoped analysis. ` +
            `Max ${MAX_NODES_WITHOUT_SCOPE} nodes without a node-id scope.\n\n` +
            `Add ?node-id=XXX to the Figma URL to target a specific section.\n` +
            `Example: canicode analyze "https://www.figma.com/design/.../MyDesign?node-id=1-234"`
          );
        }
      }
      if (!effectiveNodeId && totalNodes > 100) {
        console.warn(`\nWarning: Analyzing ${totalNodes} nodes without scope. Results may be noisy.`);
        console.warn("Tip: Add ?node-id=XXX to analyze a specific section.\n");
      }

      console.log(`\nAnalyzing: ${file.name}`);
      console.log(`Nodes: ${totalNodes}`);

      // Build rule configs: start from preset or defaults
      let configs: Record<string, RuleConfig> = options.preset
        ? { ...getConfigsWithPreset(options.preset) }
        : { ...RULE_CONFIGS };

      // Load and merge config file overrides
      let excludeNodeNames: string[] | undefined;
      let excludeNodeTypes: string[] | undefined;

      if (options.config) {
        const configFile = await loadConfigFile(options.config);
        configs = mergeConfigs(configs, configFile);
        excludeNodeNames = configFile.excludeNodeNames;
        excludeNodeTypes = configFile.excludeNodeTypes;
        console.log(`Config loaded: ${options.config}`);
      }

      // Load and register custom rules
      if (options.customRules) {
        const { rules, configs: customConfigs } = await loadCustomRules(options.customRules);
        for (const rule of rules) {
          ruleRegistry.register(rule);
        }
        configs = { ...configs, ...customConfigs };
        console.log(`Custom rules loaded: ${rules.length} rules from ${options.customRules}`);
      }

      // Build analysis options
      const analyzeOptions = {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(effectiveNodeId && { targetNodeId: effectiveNodeId }),
        ...(excludeNodeNames && { excludeNodeNames }),
        ...(excludeNodeTypes && { excludeNodeTypes }),
      };

      // Run analysis
      const result = analyzeFile(file, analyzeOptions);
      console.log(`Nodes: ${result.nodeCount} (max depth: ${result.maxDepth})`);

      // Calculate scores
      const scores = calculateScores(result);

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify(buildResultJson(file.name, result, scores), null, 2));
        return;
      }

      // Print summary to terminal
      console.log("\n" + "=".repeat(50));
      console.log(formatScoreSummary(scores));
      console.log("=".repeat(50));

      // Generate HTML report
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      let outputPath: string;

      if (options.output) {
        outputPath = resolve(options.output);
        const outputDir = dirname(outputPath);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }
      } else {
        ensureReportsDir();
        outputPath = resolve(getReportsDir(), `report-${ts}-${file.fileKey}.html`);
      }

      const figmaToken = options.token ?? getFigmaToken();
      const html = generateHtmlReport(file, result, scores, { figmaToken });
      await writeFile(outputPath, html, "utf-8");
      console.log(`\nReport saved: ${outputPath}`);

      trackEvent(EVENTS.ANALYSIS_COMPLETED, {
        nodeCount: result.nodeCount,
        issueCount: result.issues.length,
        grade: scores.overall.grade,
        percentage: scores.overall.percentage,
        duration: Date.now() - analysisStart,
      });
      trackEvent(EVENTS.REPORT_GENERATED, { format: "html" });

      // Open in browser unless --no-open
      if (!options.noOpen) {
        const { exec } = await import("node:child_process");
        const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
        exec(`${cmd} "${outputPath}"`);
      }

      // Exit with error code if grade is F
      if (scores.overall.grade === "F") {
        process.exit(1);
      }
    } catch (error) {
      trackError(
        error instanceof Error ? error : new Error(String(error)),
        { command: "analyze", input },
      );
      trackEvent(EVENTS.ANALYSIS_FAILED, {
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - analysisStart,
      });
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Internal calibration commands (used by subagents, hidden from user help)
// ============================================

interface CalibrateAnalyzeOptions {
  output?: string;
  token?: string;
  targetNodeId?: string;
}

cli
  .command(
    "calibrate-analyze <input>",
    "Run calibration analysis and output JSON for conversion step"
  )
  .option("--output <path>", "Output JSON path", { default: "logs/calibration/calibration-analysis.json" })
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--target-node-id <nodeId>", "Scope analysis to a specific node")
  .action(async (input: string, options: CalibrateAnalyzeOptions) => {
    try {
      console.log("Running calibration analysis...");

      const calibConfig = {
        input,
        maxConversionNodes: 20,
        samplingStrategy: "top-issues" as const,
        outputPath: "logs/calibration/calibration-report.md",
        ...(options.token && { token: options.token }),
        ...(options.targetNodeId && { targetNodeId: options.targetNodeId }),
      };

      const { analysisOutput, ruleScores, fileKey } =
        await runCalibrationAnalyze(calibConfig);

      // Filter out icon/graphic nodes that are not useful for code conversion
      const filteredSummaries = filterConversionCandidates(
        analysisOutput.nodeIssueSummaries,
        analysisOutput.analysisResult.file.document
      );

      const outputData = {
        fileKey,
        fileName: analysisOutput.analysisResult.file.name,
        analyzedAt: analysisOutput.analysisResult.analyzedAt,
        nodeCount: analysisOutput.analysisResult.nodeCount,
        issueCount: analysisOutput.analysisResult.issues.length,
        scoreReport: analysisOutput.scoreReport,
        nodeIssueSummaries: filteredSummaries,
        ruleScores,
      };

      const outputPath = resolve(options.output ?? "logs/calibration/calibration-analysis.json");
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      await writeFile(outputPath, JSON.stringify(outputData, null, 2), "utf-8");

      console.log(`\nAnalysis complete.`);
      console.log(`  Nodes: ${outputData.nodeCount}`);
      console.log(`  Issues: ${outputData.issueCount}`);
      console.log(`  Nodes with issues: ${outputData.nodeIssueSummaries.length}`);
      console.log(`  Grade: ${outputData.scoreReport.overall.grade} (${outputData.scoreReport.overall.percentage}%)`);
      console.log(`\nOutput saved: ${outputPath}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

interface CalibrateEvaluateOptions {
  output?: string;
}

cli
  .command(
    "calibrate-evaluate <analysisJson> <conversionJson>",
    "Evaluate conversion results and generate calibration report"
  )
  .option("--output <path>", "Report output path")
  .action(async (analysisJsonPath: string, conversionJsonPath: string, options: CalibrateEvaluateOptions) => {
    try {
      console.log("Running calibration evaluation...");

      const analysisPath = resolve(analysisJsonPath);
      const conversionPath = resolve(conversionJsonPath);

      if (!existsSync(analysisPath)) {
        throw new Error(`Analysis file not found: ${analysisPath}`);
      }
      if (!existsSync(conversionPath)) {
        throw new Error(`Conversion file not found: ${conversionPath}`);
      }

      const { readFile } = await import("node:fs/promises");
      const analysisData = JSON.parse(await readFile(analysisPath, "utf-8"));
      const conversionData = JSON.parse(await readFile(conversionPath, "utf-8"));

      const { evaluationOutput, tuningOutput, report } = runCalibrationEvaluate(
        analysisData,
        conversionData,
        analysisData.ruleScores
      );

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const defaultCalOutput = `logs/calibration/calibration-${calTs}.md`;
      const outputPath = resolve(options.output ?? defaultCalOutput);
      const calOutputDir = dirname(outputPath);
      if (!existsSync(calOutputDir)) {
        mkdirSync(calOutputDir, { recursive: true });
      }
      await writeFile(outputPath, report, "utf-8");

      const mismatchCounts = {
        overscored: 0,
        underscored: 0,
        "missing-rule": 0,
        validated: 0,
      };
      for (const m of evaluationOutput.mismatches) {
        const key = m.type as keyof typeof mismatchCounts;
        mismatchCounts[key]++;
      }

      console.log(`\nEvaluation complete.`);
      console.log(`  Validated: ${mismatchCounts.validated}`);
      console.log(`  Overscored: ${mismatchCounts.overscored}`);
      console.log(`  Underscored: ${mismatchCounts.underscored}`);
      console.log(`  Missing rules: ${mismatchCounts["missing-rule"]}`);
      console.log(`  Score adjustments proposed: ${tuningOutput.adjustments.length}`);
      console.log(`  New rule proposals: ${tuningOutput.newRuleProposals.length}`);
      console.log(`\nReport saved: ${outputPath}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

interface CalibrateRunOptions {
  output?: string;
  token?: string;
  maxNodes?: number;
  sampling?: string;
}

cli
  .command(
    "calibrate-run <input>",
    "Run full calibration pipeline (analysis-only, conversion via /calibrate-loop)"
  )
  .option("--output <path>", "Markdown report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--max-nodes <count>", "Max nodes to convert", { default: 5 })
  .option("--sampling <strategy>", "Sampling strategy (all | top-issues | random)", { default: "top-issues" })
  .action(async (input: string, options: CalibrateRunOptions) => {
    try {
      const figmaToken = options.token ?? getFigmaToken();

      if (isFigmaUrl(input) && !parseFigmaUrl(input).nodeId) {
        console.warn("\nWarning: No node-id specified. Calibrating entire file may produce noisy results.");
        console.warn("Tip: Add ?node-id=XXX to target a specific section.\n");
      }

      console.log("Running calibration pipeline (analysis-only)...");
      console.log(`  Input: ${input}`);
      console.log(`  Max nodes: ${options.maxNodes ?? 5}`);
      console.log(`  Sampling: ${options.sampling ?? "top-issues"}`);
      console.log("");

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const defaultOutput = `logs/calibration/calibration-${calTs}.md`;

      // Stub executor — code conversion is handled by the calibration-converter
      // subagent in /calibrate-loop, not by this CLI command.
      const executor = async (_nodeId: string, _fileKey: string, flaggedRuleIds: string[]) => ({
        generatedCode: `<!-- conversion skipped — use /calibrate-loop for full pipeline -->`,
        difficulty: "moderate" as const,
        notes: "Skipped — CLI runs analysis only. Use /calibrate-loop in Claude Code for full pipeline with code conversion.",
        ruleRelatedStruggles: flaggedRuleIds.map((r) => ({
          ruleId: r,
          description: "Unable to assess — conversion skipped",
          actualImpact: "moderate" as const,
        })),
        uncoveredStruggles: [],
      });

      const result = await runCalibration(
        {
          input,
          maxConversionNodes: options.maxNodes ?? 5,
          samplingStrategy: (options.sampling as "all" | "top-issues" | "random") ?? "top-issues",
          outputPath: options.output ?? defaultOutput,
          ...(figmaToken && { token: figmaToken }),
        },
        executor,
        { enableActivityLog: true }
      );

      if (result.status === "failed") {
        throw new Error(result.error ?? "Calibration pipeline failed");
      }

      console.log("\nCalibration complete (analysis-only).");
      console.log(`  Grade: ${result.scoreReport.overall.grade} (${result.scoreReport.overall.percentage}%)`);
      console.log(`  Nodes with issues: ${result.nodeIssueSummaries.length}`);
      console.log(`  Report: ${result.reportPath}`);
      if (result.logPath) {
        console.log(`  Activity log: ${result.logPath}`);
      }
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Utility commands
// ============================================

interface SaveFixtureOptions {
  output?: string;
  api?: boolean;
  token?: string;
}

cli
  .command(
    "save-fixture <input>",
    "Save Figma file data as a JSON fixture for offline analysis"
  )
  .option("--output <path>", "Output JSON path (default: fixtures/<filekey>.json)")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .example("  canicode save-fixture https://www.figma.com/design/ABC123/MyDesign")
  .example("  canicode save-fixture https://www.figma.com/design/ABC123/MyDesign --token YOUR_TOKEN")
  .action(async (input: string, options: SaveFixtureOptions) => {
    try {
      if (isFigmaUrl(input) && !parseFigmaUrl(input).nodeId) {
        console.warn("\nWarning: No node-id specified. Saving entire file as fixture.");
        console.warn("Tip: Add ?node-id=XXX to save a specific section.\n");
      }

      const { file } = await loadFile(input, options.token);

      const outputPath = resolve(
        options.output ?? `fixtures/${file.fileKey}.json`
      );
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      await writeFile(outputPath, JSON.stringify(file, null, 2), "utf-8");

      console.log(`Fixture saved: ${outputPath}`);
      console.log(`  File: ${file.name}`);
      console.log(`  Nodes: ${countNodes(file.document)}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Design tree command
// ============================================

cli
  .command(
    "design-tree <input>",
    "Generate a DOM-like design tree from a Figma file or fixture"
  )
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--output <path>", "Output file path (default: stdout)")
  .example("  canicode design-tree ./fixtures/design.json")
  .example("  canicode design-tree https://www.figma.com/design/ABC/File?node-id=1-234 --output tree.txt")
  .action(async (input: string, options: { token?: string; output?: string }) => {
    try {
      const { file } = await loadFile(input, options.token);
      const { generateDesignTree } = await import("../core/engine/design-tree.js");
      const tree = generateDesignTree(file);

      if (options.output) {
        const outputDir = dirname(resolve(options.output));
        if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
        const { writeFile: writeFileAsync } = await import("node:fs/promises");
        await writeFileAsync(resolve(options.output), tree, "utf-8");
        console.log(`Design tree saved: ${resolve(options.output)} (${Math.round(tree.length / 1024)}KB)`);
      } else {
        console.log(tree);
      }
    } catch (error) {
      console.error("\nError:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Visual compare command
// ============================================

interface VisualCompareOptions {
  figmaUrl: string;
  token?: string;
  output?: string;
  width?: number;
  height?: number;
}

cli
  .command(
    "visual-compare <codePath>",
    "Compare rendered code against Figma screenshot (pixel-level similarity)"
  )
  .option("--figma-url <url>", "Figma URL with node-id (required)")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--output <dir>", "Output directory for screenshots and diff (default: /tmp/canicode-visual-compare)")
  .option("--width <px>", "Viewport width (default: 1440)")
  .option("--height <px>", "Viewport height (default: 900)")
  .example("  canicode visual-compare ./generated/index.html --figma-url 'https://www.figma.com/design/ABC/File?node-id=1-234'")
  .action(async (codePath: string, options: VisualCompareOptions) => {
    try {
      if (!options.figmaUrl) {
        console.error("Error: --figma-url is required");
        process.exit(1);
      }

      const token = options.token ?? getFigmaToken();
      if (!token) {
        console.error("Error: Figma token required. Use --token or set FIGMA_TOKEN env var.");
        process.exit(1);
      }

      const { visualCompare } = await import("../core/engine/visual-compare.js");

      console.log("Comparing...");
      const result = await visualCompare({
        figmaUrl: options.figmaUrl,
        figmaToken: token,
        codePath: resolve(codePath),
        outputDir: options.output,
        viewport: {
          width: options.width ?? 1440,
          height: options.height ?? 900,
        },
      });

      // JSON output for programmatic use
      console.log(JSON.stringify({
        similarity: result.similarity,
        diffPixels: result.diffPixels,
        totalPixels: result.totalPixels,
        width: result.width,
        height: result.height,
        figmaScreenshot: result.figmaScreenshotPath,
        codeScreenshot: result.codeScreenshotPath,
        diff: result.diffPath,
      }, null, 2));

    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Setup command
// ============================================

interface InitOptions {
  token?: string;
  mcp?: boolean;
}

cli
  .command("init", "Set up canicode (Figma token or MCP)")
  .option("--token <token>", "Save Figma API token to ~/.canicode/")
  .option("--mcp", "Show Figma MCP setup instructions")
  .action((options: InitOptions) => {
    try {
      if (options.token) {
        initAiready(options.token);

        console.log(`  Config saved: ${getConfigPath()}`);
        console.log(`  Reports will be saved to: ${getReportsDir()}/`);
        console.log(`\n  Next: canicode analyze "https://www.figma.com/design/..."`);
        return;
      }

      if (options.mcp) {
        console.log(`FIGMA MCP SETUP (for Claude Code)\n`);
        console.log(`1. Register the official Figma MCP server at project level:`);
        console.log(`   claude mcp add -s project -t http figma https://mcp.figma.com/mcp\n`);
        console.log(`   This creates .mcp.json in your project root.\n`);
        console.log(`2. Use the /canicode skill in Claude Code:`);
        console.log(`   /canicode https://www.figma.com/design/.../MyDesign?node-id=1-234\n`);
        console.log(`   The skill calls Figma MCP directly — no FIGMA_TOKEN needed.`);
        return;
      }

      // No flags: show setup guide
      console.log(`CANICODE SETUP\n`);
      console.log(`Choose your Figma data source:\n`);
      console.log(`Option 1: REST API (recommended for CI/automation)`);
      console.log(`  canicode init --token YOUR_FIGMA_TOKEN`);
      console.log(`  Get token: figma.com > Settings > Personal access tokens\n`);
      console.log(`Option 2: Figma MCP (recommended for Claude Code)`);
      console.log(`  canicode init --mcp`);
      console.log(`  Uses the /canicode skill in Claude Code with official Figma MCP\n`);
      console.log(`After setup:`);
      console.log(`  canicode analyze "https://www.figma.com/design/..."`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Config command (telemetry opt-out)
// ============================================

interface ConfigOptions {
  telemetry?: boolean;
  noTelemetry?: boolean;
}

cli
  .command("config", "Manage canicode configuration")
  .option("--telemetry", "Enable anonymous telemetry")
  .option("--no-telemetry", "Disable anonymous telemetry")
  .action((options: ConfigOptions) => {
    try {
      if (options.noTelemetry === true) {
        setTelemetryEnabled(false);
        console.log("Telemetry disabled. No analytics data will be sent.");
        return;
      }

      if (options.telemetry === true) {
        setTelemetryEnabled(true);
        console.log("Telemetry enabled. Only anonymous usage events are tracked — no design data.");
        return;
      }

      // No flags: show current config
      const cfg = readConfig();
      console.log("CANICODE CONFIG\n");
      console.log(`  Config path: ${getConfigPath()}`);
      console.log(`  Figma token: ${cfg.figmaToken ? "set" : "not set"}`);
      console.log(`  Telemetry:   ${cfg.telemetry !== false ? "enabled" : "disabled"}`);
      console.log(`\nOptions:`);
      console.log(`  canicode config --no-telemetry    Opt out of anonymous telemetry`);
      console.log(`  canicode config --telemetry       Opt back in`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// List rules command
// ============================================

interface ListRulesOptions {
  customRules?: string;
  config?: string;
  json?: boolean;
}

cli
  .command("list-rules", "List all analysis rules with scores and severity")
  .option("--custom-rules <path>", "Include custom rules from JSON file")
  .option("--config <path>", "Apply config overrides to show effective scores")
  .option("--json", "Output as JSON")
  .action(async (options: ListRulesOptions) => {
    try {
      let configs: Record<string, RuleConfig> = { ...RULE_CONFIGS };

      if (options.config) {
        const configFile = await loadConfigFile(options.config);
        configs = mergeConfigs(configs, configFile);
      }

      if (options.customRules) {
        const { rules, configs: customConfigs } = await loadCustomRules(options.customRules);
        for (const rule of rules) {
          ruleRegistry.register(rule);
        }
        configs = { ...configs, ...customConfigs };
      }

      const rules = ruleRegistry.getAll().map((rule) => {
        const config = configs[rule.definition.id as string];
        return {
          id: rule.definition.id,
          name: rule.definition.name,
          category: rule.definition.category,
          severity: config?.severity ?? "risk",
          score: config?.score ?? 0,
          enabled: config?.enabled ?? true,
        };
      });

      if (options.json) {
        console.log(JSON.stringify(rules, null, 2));
        return;
      }

      // Group by category
      const byCategory = new Map<string, typeof rules>();
      for (const rule of rules) {
        const list = byCategory.get(rule.category) ?? [];
        list.push(rule);
        byCategory.set(rule.category, list);
      }

      for (const [category, catRules] of byCategory) {
        console.log(`\n  ${category.toUpperCase()}`);
        for (const r of catRules) {
          const status = r.enabled ? "" : " (disabled)";
          const pad = " ".repeat(Math.max(0, 40 - r.id.length));
          console.log(`    ${r.id}${pad} ${String(r.score).padStart(4)}  ${r.severity}${status}`);
        }
      }
      console.log(`\n  Total: ${rules.length} rules\n`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Prompt command
// ============================================

cli
  .command("prompt", "Output the standard design-to-code prompt for AI code generation")
  .action(async () => {
    try {
      const { readFile } = await import("node:fs/promises");
      const { dirname: dirnameFn, resolve: resolveFn } = await import("node:path");
      const { fileURLToPath } = await import("node:url");
      const __dirname = dirnameFn(fileURLToPath(import.meta.url));
      // Try from source location first, then npm-installed location
      const paths = [
        resolveFn(__dirname, "../../.claude/skills/design-to-code/PROMPT.md"),
        resolveFn(__dirname, "../.claude/skills/design-to-code/PROMPT.md"),
      ];
      for (const p of paths) {
        try {
          const content = await readFile(p, "utf-8");
          console.log(content);
          return;
        } catch { /* try next */ }
      }
      console.error("Prompt file not found");
      process.exit(1);
    } catch (error) {
      console.error("Error:", error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ============================================
// Documentation command
// ============================================

cli
  .command("docs [topic]", "Show documentation (topics: setup, rules, config, visual-compare, design-tree)")
  .action((topic?: string) => {
    handleDocs(topic);
  });

cli.help((sections) => {
  sections.push(
    {
      title: "\nSetup",
      body: [
        `  canicode init --token <token>   Save Figma token to ~/.canicode/`,
        `  canicode init --mcp             Show MCP setup instructions`,
      ].join("\n"),
    },
    {
      title: "\nData source",
      body: [
        `  --api                   Load via Figma REST API (needs FIGMA_TOKEN)`,
        `  --token <token>         Figma API token (or use FIGMA_TOKEN env var)`,
      ].join("\n"),
    },
    {
      title: "\nCustomization",
      body: [
        `  --config <path>         Override rule settings (see: canicode docs config)`,
        `  --custom-rules <path>   Add custom rules (see: canicode docs rules)`,
      ].join("\n"),
    },
    {
      title: "\nExamples",
      body: [
        `  $ canicode analyze "https://www.figma.com/design/..." --api`,
        `  $ canicode analyze "https://www.figma.com/design/..." --preset strict`,
        `  $ canicode analyze "https://www.figma.com/design/..." --config ./my-config.json`,
      ].join("\n"),
    },
    {
      title: "\nInstallation",
      body: [
        `  CLI:     npm install -g canicode`,
        `  MCP:     claude mcp add canicode -- npx -y -p canicode canicode-mcp`,
        `  Skills:  github.com/let-sunny/canicode`,
      ].join("\n"),
    },
  );
});
cli.version(pkg.version);

cli.parse();
