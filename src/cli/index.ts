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
  runCalibrationAnalyze,
  runCalibrationEvaluate,
} from "../agents/orchestrator.js";
import { runVisualComparison } from "../agents/visual-comparator.js";
import type { VisualComparisonInput } from "../agents/contracts/visual-comparison.js";
import type { NodeScreenshot } from "../report-html/index.js";

// Import rules to register them
import "../rules/index.js";

const cli = cac("drc");

interface AnalyzeOptions {
  preset?: Preset;
  output?: string;
  token?: string;
  visual?: boolean;
  visualLimit?: number;
  verbose?: boolean;
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
  .option("--visual", "Capture Figma screenshots for blocking/risk nodes and include in report")
  .option("--visual-limit <count>", "Max nodes to capture screenshots for (default: 5)")
  .option("--verbose", "Show detailed logs for visual capture and other operations")
  .example("  drc analyze https://www.figma.com/design/ABC123/MyDesign")
  .example("  drc analyze ./fixtures/design.json --output report.html")
  .example("  drc analyze https://www.figma.com/design/ABC123/MyDesign --visual")
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

      // Visual node screenshots (if --visual and Figma URL)
      let nodeScreenshots: NodeScreenshot[] | undefined;

      if (options.visual && isFigmaUrl(input)) {
        const figmaToken = options.token ?? process.env["FIGMA_TOKEN"];
        if (!figmaToken) {
          console.warn("--visual requires FIGMA_TOKEN. Skipping screenshots.");
        } else {
          const maxNodes = options.visualLimit ?? 5;

          // Collect unique nodeIds with blocking/risk issues, ranked by score
          const nodeInfoMap = new Map<string, { path: string; score: number; issueCount: number; topSeverity: string }>();

          for (const issue of result.issues) {
            if (issue.config.severity === "blocking" || issue.config.severity === "risk") {
              const existing = nodeInfoMap.get(issue.violation.nodeId);
              if (existing) {
                existing.score += issue.calculatedScore;
                existing.issueCount++;
                if (issue.config.severity === "blocking") {
                  existing.topSeverity = "blocking";
                }
              } else {
                nodeInfoMap.set(issue.violation.nodeId, {
                  path: issue.violation.nodePath,
                  score: issue.calculatedScore,
                  issueCount: 1,
                  topSeverity: issue.config.severity,
                });
              }
            }
          }

          // Sort by score (most negative first), take top N
          const rankedNodes = [...nodeInfoMap.entries()]
            .sort((a, b) => a[1].score - b[1].score)
            .slice(0, maxNodes);

          if (rankedNodes.length > 0) {
            const totalCandidates = nodeInfoMap.size;
            console.log(`\nCapturing screenshots for ${rankedNodes.length} nodes${totalCandidates > maxNodes ? ` (top ${maxNodes} of ${totalCandidates})` : ""}...`);

            const client = new FigmaClient({ token: figmaToken });
            const nodeIdList = rankedNodes.map(([id]) => id);

            try {
              const imageUrls = await client.getNodeImages(file.fileKey, nodeIdList);

              if (options.verbose) {
                const urlCount = Object.values(imageUrls).filter(Boolean).length;
                const nullCount = Object.values(imageUrls).filter((v) => v === null).length;
                console.log(`  [verbose] Image API returned ${urlCount} URLs, ${nullCount} null`);
              }

              const screenshots: NodeScreenshot[] = [];
              for (const [nid, info] of rankedNodes) {
                const imageUrl = imageUrls[nid];
                if (!imageUrl) {
                  if (options.verbose) {
                    console.log(`  [verbose] Node ${nid}: no image URL (null)`);
                  }
                  continue;
                }

                try {
                  if (options.verbose) {
                    console.log(`  [verbose] Node ${nid}: downloading...`);
                  }
                  const base64 = await client.fetchImageAsBase64(imageUrl);
                  if (options.verbose) {
                    console.log(`  [verbose] Node ${nid}: OK (${Math.round(base64.length / 1024)}KB)`);
                  }
                  screenshots.push({
                    nodeId: nid,
                    nodePath: info.path,
                    screenshotBase64: base64,
                    issueCount: info.issueCount,
                    topSeverity: info.topSeverity,
                  });
                } catch (dlErr) {
                  if (options.verbose) {
                    console.warn(`  [verbose] Node ${nid}: download failed — ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`);
                  }
                }
              }

              if (screenshots.length > 0) {
                nodeScreenshots = screenshots;
                console.log(`  Captured ${screenshots.length} screenshots.`);
              } else if (options.verbose) {
                console.log(`  [verbose] No screenshots downloaded successfully.`);
              }
            } catch (err) {
              console.warn(`  Screenshot capture failed: ${err instanceof Error ? err.message : String(err)}`);
              if (options.verbose && err instanceof Error && err.stack) {
                console.warn(`  [verbose] ${err.stack}`);
              }
            }
          }
        }
      } else if (options.visual && !isFigmaUrl(input)) {
        console.warn("--visual requires a Figma URL input. Skipping screenshots.");
      }

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

      const html = generateHtmlReport(file, result, scores,
        nodeScreenshots ? { nodeScreenshots } : undefined
      );
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
  visual?: boolean;
  deepCompare?: boolean;
}

cli
  .command(
    "calibrate-evaluate <analysisJson> <conversionJson>",
    "Evaluate conversion results and generate calibration report"
  )
  .option("--output <path>", "Report output path")
  .option("--visual", "Enable visual comparison (requires visualData in conversion JSON)")
  .option("--deep-compare", "Use Claude Vision for deep image comparison (requires ANTHROPIC_API_KEY)")
  .example("  drc calibrate-evaluate calibration-analysis.json calibration-conversion.json")
  .example("  drc calibrate-evaluate analysis.json conversion.json --visual --deep-compare")
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

      if (options.deepCompare && !process.env["ANTHROPIC_API_KEY"]) {
        throw new Error(
          "--deep-compare requires ANTHROPIC_API_KEY environment variable."
        );
      }

      const { readFile } = await import("node:fs/promises");
      const analysisData = JSON.parse(await readFile(analysisPath, "utf-8"));
      const conversionData = JSON.parse(await readFile(conversionPath, "utf-8"));

      // Run visual comparison if enabled and visual data is present
      let visualComparisons;
      if (options.visual && conversionData.visualData) {
        console.log("Running visual comparison...");
        const visualInputs: VisualComparisonInput[] = conversionData.visualData;
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];
        visualComparisons = await runVisualComparison(visualInputs, {
          ...(options.deepCompare && { deepCompare: options.deepCompare }),
          ...(anthropicKey && { anthropicApiKey: anthropicKey }),
        });
        console.log(`  Compared ${visualComparisons.length} nodes.`);
      }

      const { evaluationOutput, tuningOutput, report } = runCalibrationEvaluate(
        analysisData,
        conversionData,
        analysisData.ruleScores,
        visualComparisons
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
      if (visualComparisons && visualComparisons.length > 0) {
        const avgSimilarity = visualComparisons.reduce(
          (sum, vc) => sum + (100 - vc.pixelComparison.pixelDiffPercentage), 0
        ) / visualComparisons.length;
        console.log(`  Visual comparisons: ${visualComparisons.length} (avg similarity: ${avgSimilarity.toFixed(1)}%)`);
      }
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
    "Run full calibration pipeline (requires ConversionExecutor)"
  )
  .option("--output <path>", "Report output path (default: logs/calibration/calibration-YYYY-MM-DD-HH-mm.md)")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--max-nodes <count>", "Max nodes to convert", { default: 20 })
  .option("--sampling <strategy>", "Sampling strategy (all | top-issues | random)", { default: "top-issues" })
  .example("  drc calibrate-run ./fixtures/sample.json")
  .action(async (_input: string, _options: CalibrateRunOptions) => {
    try {
      console.log("Full calibration pipeline requires a ConversionExecutor.");
      console.log("This command is intended for programmatic use with an injected executor.");
      console.log("");
      console.log("For manual calibration, use the 3-step process:");
      console.log("  1. drc calibrate-analyze <input>");
      console.log("  2. Convert nodes in a Claude Code session with Figma MCP");
      console.log("  3. drc calibrate-evaluate <analysis.json> <conversion.json>");
      console.log("");
      console.log("Tip: For long-running sessions on macOS, prevent sleep with:");
      console.log("  caffeinate -i drc calibrate-run <url>");
      process.exit(1);
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
