import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";

import {
  runCalibrationAnalyze,
  filterConversionCandidates,
  determineCalibrationTier,
} from "../../../agents/orchestrator.js";

interface CalibrateAnalyzeOptions {
  output?: string;
  runDir?: string;
  token?: string;
  targetNodeId?: string;
}

export function registerCalibrateAnalyze(cli: CAC): void {
  cli
    .command(
      "calibrate-analyze <input>",
      "Run calibration analysis and output JSON for conversion step"
    )
    .option("--output <path>", "Output JSON path", { default: "logs/calibration/calibration-analysis.json" })
    .option("--run-dir <path>", "Run directory (overrides --output, writes to <run-dir>/analysis.json)")
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

        const percentage = analysisOutput.scoreReport.overall.percentage;
        const calibrationTier = determineCalibrationTier(percentage);

        const outputData = {
          fileKey,
          fileName: analysisOutput.analysisResult.file.name,
          analyzedAt: analysisOutput.analysisResult.analyzedAt,
          nodeCount: analysisOutput.analysisResult.nodeCount,
          issueCount: analysisOutput.analysisResult.issues.length,
          calibrationTier,
          scoreReport: analysisOutput.scoreReport,
          nodeIssueSummaries: filteredSummaries,
          ruleScores,
        };

        const outputPath = options.runDir
          ? resolve(options.runDir, "analysis.json")
          : resolve(options.output ?? "logs/calibration/calibration-analysis.json");
        const outputDir = dirname(outputPath);
        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }
        await writeFile(outputPath, JSON.stringify(outputData, null, 2), "utf-8");

        console.log(`\nAnalysis complete.`);
        console.log(`  Nodes: ${outputData.nodeCount}`);
        console.log(`  Issues: ${outputData.issueCount}`);
        console.log(`  Nodes with issues: ${outputData.nodeIssueSummaries.length}`);
        console.log(`  Grade: ${outputData.scoreReport.overall.grade} (${percentage}%)`);
        console.log(`  Calibration tier: ${calibrationTier}`);
        console.log(`\nOutput saved: ${outputPath}`);
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
