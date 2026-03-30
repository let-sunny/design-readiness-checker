import { existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";

import { loadFile, isJsonFile } from "../../core/engine/loader.js";

export function registerDesignTree(cli: CAC): void {
  cli
    .command(
      "design-tree <input>",
      "Generate a DOM-like design tree from a Figma file or fixture"
    )
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--output <path>", "Output file path (default: stdout)")
    .option("--vector-dir <path>", "Directory with SVG files for VECTOR nodes (auto-detected from fixture path)")
    .option("--image-dir <path>", "Directory with image PNGs for IMAGE fill nodes (auto-detected from fixture path)")
    .example("  canicode design-tree ./fixtures/my-design")
    .example("  canicode design-tree https://www.figma.com/design/ABC/File?node-id=1-234 --output tree.txt")
    .action(async (input: string, options: { token?: string; output?: string; vectorDir?: string; imageDir?: string }) => {
      try {
        const { file } = await loadFile(input, options.token);

        const fixtureBase = isJsonFile(input) ? dirname(resolve(input)) : resolve(input);

        // Auto-detect vector dir from fixture path
        let vectorDir = options.vectorDir;
        if (!vectorDir) {
          const autoDir = resolve(fixtureBase, "vectors");
          if (existsSync(autoDir)) vectorDir = autoDir;
        }

        // Auto-detect image dir from fixture path
        let imageDir = options.imageDir;
        if (!imageDir) {
          const autoDir = resolve(fixtureBase, "images");
          if (existsSync(autoDir)) imageDir = autoDir;
        }

        const { generateDesignTreeWithStats } = await import("../../core/design-tree/design-tree.js");
        const treeOptions = {
          ...(vectorDir ? { vectorDir } : {}),
          ...(imageDir ? { imageDir } : {}),
        };
        const stats = generateDesignTreeWithStats(file, treeOptions);

        if (options.output) {
          const outputDir = dirname(resolve(options.output));
          if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
          const { writeFile: writeFileAsync } = await import("node:fs/promises");
          await writeFileAsync(resolve(options.output), stats.tree, "utf-8");
          console.log(`Design tree saved: ${resolve(options.output)} (${Math.round(stats.bytes / 1024)}KB, ~${stats.estimatedTokens} tokens)`);
        } else {
          console.log(stats.tree);
        }
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
