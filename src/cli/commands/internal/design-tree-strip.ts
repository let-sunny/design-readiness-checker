import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { CAC } from "cac";

import { stripDesignTree, DESIGN_TREE_INFO_TYPES, ALL_STRIP_TYPES } from "../../../core/design-tree/strip.js";
import type { DesignTreeStripType } from "../../../core/design-tree/strip.js";

const VALID_TYPES = new Set<string>(ALL_STRIP_TYPES);

export function registerDesignTreeStrip(cli: CAC): void {
  cli
    .command(
      "design-tree-strip <input>",
      "[internal] Generate stripped design-tree variants for ablation"
    )
    .option("--types <types>", `Comma-separated strip types (default: all DESIGN_TREE_INFO_TYPES)`)
    .option("--output-dir <dir>", "Output directory for stripped files (required)")
    .action(async (input: string, options: { types?: string; outputDir?: string }) => {
      try {
        if (!options.outputDir) {
          console.error("Error: --output-dir is required");
          process.exitCode = 1;
          return;
        }

        const inputPath = resolve(input);
        if (!existsSync(inputPath)) {
          console.error(`Error: Input file not found: ${inputPath}`);
          process.exitCode = 1;
          return;
        }

        const designTree = readFileSync(inputPath, "utf-8");

        let types: DesignTreeStripType[];
        if (options.types) {
          const tokens = options.types.split(",").map(t => t.trim());
          const invalid = tokens.filter(t => !VALID_TYPES.has(t));
          if (invalid.length > 0) {
            console.error(`Error: Unknown strip type(s): ${invalid.join(", ")}`);
            console.error(`Valid types: ${ALL_STRIP_TYPES.join(", ")}`);
            process.exitCode = 1;
            return;
          }
          types = tokens as DesignTreeStripType[];
        } else {
          types = [...DESIGN_TREE_INFO_TYPES];
        }

        const outputDir = resolve(options.outputDir);
        mkdirSync(outputDir, { recursive: true });

        for (const type of types) {
          const stripped = stripDesignTree(designTree, type);
          const outputPath = join(outputDir, `${type}.txt`);
          await writeFile(outputPath, stripped, "utf-8");
          console.log(`  ${type}.txt (${Math.round(Buffer.byteLength(stripped) / 1024)}KB)`);
        }

        console.log(`Stripped ${types.length} design-tree variants → ${outputDir}`);
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
