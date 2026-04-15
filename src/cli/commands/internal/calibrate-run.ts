import type { CAC } from "cac";

import { parseFigmaUrl } from "../../../core/adapters/figma-url-parser.js";
import { isFigmaUrl } from "../../../core/engine/loader.js";
import { getFigmaToken } from "../../../core/engine/config-store.js";
import { runCalibrationAnalyze } from "../../../agents/calibration-compute.js";

interface CalibrateRunOptions {
  token?: string;
  maxNodes?: number;
  sampling?: string;
}

export function registerCalibrateRun(cli: CAC): void {
  cli
    .command(
      "calibrate-run <input>",
      "Run full calibration pipeline (analysis-only, conversion via /calibrate)"
    )
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
        console.log("");

        const { analysisOutput } = await runCalibrationAnalyze({
          input,
          maxConversionNodes: options.maxNodes ?? 5,
          samplingStrategy: (options.sampling as "all" | "top-issues" | "random") ?? "top-issues",
          ...(figmaToken && { token: figmaToken }),
        });

        console.log("\nCalibration complete (analysis-only).");
        console.log(`  Grade: ${analysisOutput.scoreReport.overall.grade} (${analysisOutput.scoreReport.overall.percentage}%)`);
        console.log(`  Nodes with issues: ${analysisOutput.nodeIssueSummaries.length}`);
        console.log("  Note: Use /calibrate in Claude Code for full pipeline with visual comparison.");
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
