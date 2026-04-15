import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";

import { runCalibrationEvaluate } from "../../../agents/calibration-compute.js";

interface CalibrateEvaluateOptions {
  output?: string;
  runDir?: string;
}

export function registerCalibrateEvaluate(cli: CAC): void {
  cli
    .command(
      "calibrate-evaluate [analysisJson] [conversionJson]",
      "Evaluate conversion results and generate calibration report"
    )
    .option("--output <path>", "Report output path")
    .option("--run-dir <path>", "Run directory (reads analysis.json + conversion.json, writes summary.md)")
    .action(async (analysisJsonPath: string, conversionJsonPath: string, options: CalibrateEvaluateOptions) => {
      try {
        console.log("Running calibration evaluation...");

        const analysisPath = options.runDir
          ? resolve(options.runDir, "analysis.json")
          : resolve(analysisJsonPath);
        const conversionPath = options.runDir
          ? resolve(options.runDir, "conversion.json")
          : resolve(conversionJsonPath);

        if (!existsSync(analysisPath)) {
          throw new Error(`Analysis file not found: ${analysisPath}`);
        }
        if (!existsSync(conversionPath)) {
          throw new Error(`Conversion file not found: ${conversionPath}`);
        }

        const { readFile } = await import("node:fs/promises");
        const analysisData = JSON.parse(await readFile(analysisPath, "utf-8"));
        const conversionData = JSON.parse(await readFile(conversionPath, "utf-8"));

        // Derive fixture name from run-dir: <fixture-name>--<timestamp>
        let fixtureName: string | undefined;
        if (options.runDir) {
          const dirName = resolve(options.runDir).split(/[/\\]/).pop() ?? "";
          const idx = dirName.lastIndexOf("--");
          fixtureName = idx === -1 ? dirName : dirName.slice(0, idx);
        }

        const { evaluationOutput, tuningOutput, report } = runCalibrationEvaluate(
          analysisData,
          conversionData,
          analysisData.ruleScores,
          { collectEvidence: !!options.runDir, ...(fixtureName ? { fixtureName } : {}) }
        );

        let outputPath: string;
        if (options.runDir) {
          outputPath = resolve(options.runDir, "summary.md");
        } else if (options.output) {
          outputPath = resolve(options.output);
        } else {
          const calNow = new Date();
          const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
          outputPath = resolve(`logs/calibration/calibration-${calTs}.md`);
        }
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

        // Write proposed ruleIds for deterministic evidence gathering
        if (options.runDir && tuningOutput.adjustments.length > 0) {
          const proposedIds = tuningOutput.adjustments.map(
            (a: { ruleId: string }) => a.ruleId
          );
          const proposedPath = resolve(options.runDir, "proposed-rules.json");
          await writeFile(proposedPath, JSON.stringify(proposedIds) + "\n", "utf-8");
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
        process.exitCode = 1;
      }
    });
}
