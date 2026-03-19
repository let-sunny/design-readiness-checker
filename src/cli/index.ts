#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { config } from "dotenv";
import cac from "cac";

// Load .env file
config();

import { FigmaClient } from "../adapters/figma-client.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { analyzeFile } from "../core/rule-engine.js";
import { calculateScores, formatScoreSummary } from "../core/scoring.js";
import { getConfigsWithPreset, type Preset } from "../rules/rule-config.js";
import { generateHtmlReport } from "../report-html/index.js";
import {
  runCalibration,
  runCalibrationAnalyze,
  runCalibrationEvaluate,
} from "../agents/orchestrator.js";
import { createAnthropicExecutor } from "../agents/anthropic-executor.js";

// Import rules to register them
import "../rules/index.js";

const cli = cac("drc");

interface AnalyzeOptions {
  preset?: Preset;
  output?: string;
  token?: string;
}

function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

interface LoadResult {
  file: AnalysisFile;
  nodeId?: string | undefined;
}

async function loadFile(
  input: string,
  token?: string
): Promise<LoadResult> {
  if (isJsonFile(input)) {
    // Load from JSON fixture
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log(`Loading from JSON: ${filePath}`);
    return { file: await loadFigmaFileFromJson(filePath) };
  }

  if (isFigmaUrl(input)) {
    // Fetch from Figma API
    const { fileKey, nodeId } = parseFigmaUrl(input);
    console.log(`Fetching from Figma API: ${fileKey}`);
    if (nodeId) {
      console.log(`Target node: ${nodeId}`);
    }

    const figmaToken = token ?? process.env["FIGMA_TOKEN"];
    if (!figmaToken) {
      throw new Error(
        "Figma token required. Provide --token or set FIGMA_TOKEN environment variable."
      );
    }

    const client = new FigmaClient({ token: figmaToken });
    const response = await client.getFile(fileKey);
    return {
      file: transformFigmaResponse(fileKey, response),
      nodeId,
    };
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
}

cli
  .command("analyze <input>", "Analyze a Figma file or JSON fixture")
  .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
  .option("--output <path>", "HTML report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .example("  drc analyze https://www.figma.com/design/ABC123/MyDesign")
  .example("  drc analyze ./fixtures/design.json --output report.html")
  .example("  drc analyze ./fixtures/design.json --preset strict")
  .action(async (input: string, options: AnalyzeOptions) => {
    try {
      // Load file
      const { file, nodeId } = await loadFile(input, options.token);
      console.log(`\nAnalyzing: ${file.name}`);
      console.log(`Nodes: analyzing...`);

      // Build analysis options
      const analyzeOptions = {
        ...(options.preset && { configs: getConfigsWithPreset(options.preset) }),
        ...(nodeId && { targetNodeId: nodeId }),
      };

      // Run analysis
      const result = analyzeFile(file, analyzeOptions);
      console.log(`Nodes: ${result.nodeCount} (max depth: ${result.maxDepth})`);

      // Calculate scores
      const scores = calculateScores(result);

      // Print summary to terminal
      console.log("\n" + "=".repeat(50));
      console.log(formatScoreSummary(scores));
      console.log("=".repeat(50));

      // Generate HTML report
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      const defaultOutput = `reports/${ts}-${file.fileKey}.html`;
      const reportOutput = options.output ?? defaultOutput;
      const outputPath = resolve(reportOutput);
      const outputDir = dirname(outputPath);

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const html = generateHtmlReport(file, result, scores);
      await writeFile(outputPath, html, "utf-8");
      console.log(`\nReport saved: ${outputPath}`);

      // Exit with error code if grade is F
      if (scores.overall.grade === "F") {
        process.exit(1);
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
// Calibration subcommands
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
  .example("  drc calibrate-analyze ./fixtures/sample.json")
  .example("  drc calibrate-analyze https://www.figma.com/design/ABC123/MyDesign")
  .action(async (input: string, options: CalibrateAnalyzeOptions) => {
    try {
      console.log("Running calibration analysis...");

      const config = {
        input,
        maxConversionNodes: 20,
        samplingStrategy: "top-issues" as const,
        outputPath: "logs/calibration/calibration-report.md",
        ...(options.token && { token: options.token }),
        ...(options.targetNodeId && { targetNodeId: options.targetNodeId }),
      };

      const { analysisOutput, ruleScores, fileKey } =
        await runCalibrationAnalyze(config);

      const outputData = {
        fileKey,
        fileName: analysisOutput.analysisResult.file.name,
        analyzedAt: analysisOutput.analysisResult.analyzedAt,
        nodeCount: analysisOutput.analysisResult.nodeCount,
        issueCount: analysisOutput.analysisResult.issues.length,
        scoreReport: analysisOutput.scoreReport,
        nodeIssueSummaries: analysisOutput.nodeIssueSummaries,
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
      console.log(`\nNext step: Convert nodes using Claude Code session, then run 'drc calibrate-evaluate'.`);
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
  .example("  drc calibrate-evaluate calibration-analysis.json calibration-conversion.json")
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
  exportReport?: boolean;
}

cli
  .command(
    "calibrate-run <input>",
    "Run full calibration pipeline using Anthropic API"
  )
  .option("--output <path>", "Markdown report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--max-nodes <count>", "Max nodes to convert", { default: 5 })
  .option("--sampling <strategy>", "Sampling strategy (all | top-issues | random)", { default: "top-issues" })
  .option("--export-report", "Generate HTML report in reports/")
  .example("  drc calibrate-run https://www.figma.com/design/ABC123/MyDesign")
  .example("  drc calibrate-run https://www.figma.com/design/ABC123/MyDesign --export-report")
  .action(async (input: string, options: CalibrateRunOptions) => {
    try {
      const anthropicKey = process.env["ANTHROPIC_API_KEY"];
      if (!anthropicKey) {
        throw new Error(
          "ANTHROPIC_API_KEY environment variable is required for calibrate-run.\n" +
          "Set it in .env or export it in your shell."
        );
      }

      const figmaToken = options.token ?? process.env["FIGMA_TOKEN"];

      console.log("Running calibration pipeline...");
      console.log(`  Input: ${input}`);
      console.log(`  Max nodes: ${options.maxNodes ?? 5}`);
      console.log(`  Sampling: ${options.sampling ?? "top-issues"}`);
      if (options.exportReport) {
        console.log("  HTML report: enabled");
      }
      console.log("");

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const defaultOutput = `logs/calibration/calibration-${calTs}.md`;

      const executor = createAnthropicExecutor(anthropicKey);

      const result = await runCalibration(
        {
          input,
          maxConversionNodes: options.maxNodes ?? 5,
          samplingStrategy: (options.sampling as "all" | "top-issues" | "random") ?? "top-issues",
          outputPath: options.output ?? defaultOutput,
          ...(figmaToken && { token: figmaToken }),
        },
        executor,
        {
          enableActivityLog: true,
          ...(options.exportReport && { exportHtmlReport: true }),
        }
      );

      if (result.status === "failed") {
        throw new Error(result.error ?? "Calibration pipeline failed");
      }

      console.log("\nCalibration complete.");
      console.log(`  Grade: ${result.scoreReport.overall.grade} (${result.scoreReport.overall.percentage}%)`);
      console.log(`  Nodes with issues: ${result.nodeIssueSummaries.length}`);
      console.log(`  Mismatches: ${result.mismatches.length}`);
      console.log(`  Adjustments proposed: ${result.adjustments.length}`);
      console.log(`  Report: ${result.reportPath}`);
      if (result.htmlReportPath) {
        console.log(`  HTML report: ${result.htmlReportPath}`);
      }
      if (result.logPath) {
        console.log(`  Activity log: ${result.logPath}`);
      }

      console.log("");
      console.log("Tip: For long-running sessions on macOS, prevent sleep with:");
      console.log(`  caffeinate -i drc calibrate-run "${input}"`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

cli.help();
cli.version("0.1.0");

cli.parse();
