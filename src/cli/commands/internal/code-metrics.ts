import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CAC } from "cac";

import { computeCodeMetrics } from "../../../core/comparison/visual-compare-helpers.js";

export function registerCodeMetrics(cli: CAC): void {
  cli
    .command(
      "code-metrics <input>",
      "[internal] Compute code metrics for an HTML file"
    )
    .action((input: string) => {
      try {
        const inputPath = resolve(input);
        if (!existsSync(inputPath)) {
          console.error(`Error: Input file not found: ${inputPath}`);
          process.exitCode = 1;
          return;
        }

        const html = readFileSync(inputPath, "utf-8");
        const metrics = computeCodeMetrics(html);

        console.log(JSON.stringify(metrics));
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
