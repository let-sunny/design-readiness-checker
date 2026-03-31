import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CAC } from "cac";

import { sanitizeHtml, injectLocalFont } from "../../../core/comparison/html-utils.js";

export function registerHtmlPostprocess(cli: CAC): void {
  cli
    .command(
      "html-postprocess <input>",
      "[internal] Sanitize HTML and inject local fonts"
    )
    .option("--output <path>", "Output path (default: overwrite input)")
    .action(async (input: string, options: { output?: string }) => {
      try {
        const inputPath = resolve(input);
        if (!existsSync(inputPath)) {
          console.error(`Error: Input file not found: ${inputPath}`);
          process.exitCode = 1;
          return;
        }

        const raw = readFileSync(inputPath, "utf-8");
        const html = injectLocalFont(sanitizeHtml(raw));

        const outputPath = options.output ? resolve(options.output) : inputPath;
        await writeFile(outputPath, html, "utf-8");

        console.log(JSON.stringify({
          inputPath,
          outputPath,
          inputBytes: Buffer.byteLength(raw, "utf-8"),
          outputBytes: Buffer.byteLength(html, "utf-8"),
        }));
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
