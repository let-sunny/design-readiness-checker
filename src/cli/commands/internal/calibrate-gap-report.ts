import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";

import { generateGapRuleReport } from "../../../agents/gap-rule-report.js";

interface CalibrateGapReportOptions {
  calibrationDir?: string;
  output?: string;
  minRepeat?: string;
  json?: boolean;
}

export function registerCalibrateGapReport(cli: CAC): void {
  cli
    .command(
      "calibrate-gap-report",
      "Aggregate gap data and calibration runs into a rule review report"
    )
    .option("--calibration-dir <path>", "Calibration runs directory", {
      default: "logs/calibration",
    })
    .option("--output <path>", "Markdown report path", {
      default: "logs/calibration/REPORT.md",
    })
    .option("--min-repeat <n>", "Minimum distinct fixtures to treat as a repeating pattern", {
      default: "2",
    })
    .option("--json", "Print JSON summary to stdout")
    .action(async (options: CalibrateGapReportOptions) => {
      try {
        // In --json mode, send progress messages to stderr so stdout contains only valid JSON
        const log = options.json ? console.error.bind(console) : console.log.bind(console);

        const minRepeat = Math.max(1, parseInt(options.minRepeat ?? "2", 10) || 2);
        const result = generateGapRuleReport({
          calibrationDir: resolve(options.calibrationDir ?? "logs/calibration"),
          minPatternRepeat: minRepeat,
        });

        const outPath = resolve(options.output ?? "logs/calibration/REPORT.md");
        const outDir = dirname(outPath);
        if (!existsSync(outDir)) {
          mkdirSync(outDir, { recursive: true });
        }

        // Backup existing report with timestamp before overwriting
        if (existsSync(outPath)) {
          const { readFile: readFileAsync } = await import("node:fs/promises");
          const existing = await readFileAsync(outPath, "utf-8");
          // Extract timestamp from the "Generated:" line
          const match = existing.match(/Generated:\s*(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
          if (match?.[1]) {
            const ts = match[1].replace(/[:.]/g, "-").replace("T", "-").replace("Z", "");
            const backupPath = outPath.replace(/\.md$/, `--${ts}.md`);
            await writeFile(backupPath, existing, "utf-8");
            log(`  Previous report backed up: ${backupPath}`);
          }
        }

        await writeFile(outPath, result.markdown, "utf-8");

        log("Gap rule review report written.");
        log(`  Runs with gaps: ${result.gapRunCount}`);
        log(`  Runs with snapshots: ${result.runCount}`);
        log(`  Output: ${outPath}`);

        if (options.json) {
          console.log(
            JSON.stringify(
              {
                gapRunCount: result.gapRunCount,
                runCount: result.runCount,
                outputPath: outPath,
              },
              null,
              2
            )
          );
        }
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
