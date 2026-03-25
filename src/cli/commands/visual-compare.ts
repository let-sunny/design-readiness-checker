import { resolve } from "node:path";
import type { CAC } from "cac";

import { getFigmaToken } from "../../core/engine/config-store.js";

interface VisualCompareOptions {
  figmaUrl: string;
  token?: string;
  output?: string;
  width?: number;
  height?: number;
  figmaScale?: string;
}

export function registerVisualCompare(cli: CAC): void {
  cli
    .command(
      "visual-compare <codePath>",
      "Compare rendered code against Figma screenshot (pixel-level similarity)"
    )
    .option("--figma-url <url>", "Figma URL with node-id (required)")
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--output <dir>", "Output directory for screenshots and diff (default: /tmp/canicode-visual-compare)")
    .option("--width <px>", "Logical viewport width in CSS px (default: infer from Figma PNG ÷ export scale)")
    .option("--height <px>", "Logical viewport height in CSS px (default: infer from Figma PNG ÷ export scale)")
    .option("--figma-scale <n>", "Figma export scale (default: 2, matches save-fixture / @2x PNGs)")
    .example("  canicode visual-compare ./generated/index.html --figma-url 'https://www.figma.com/design/ABC/File?node-id=1-234'")
    .action(async (codePath: string, options: VisualCompareOptions) => {
      try {
        if (!options.figmaUrl) {
          console.error("Error: --figma-url is required");
          process.exit(1);
        }

        const token = options.token ?? getFigmaToken();
        if (!token) {
          console.error("Error: Figma token required. Use --token or set FIGMA_TOKEN env var.");
          process.exit(1);
        }

        const { visualCompare } = await import("../../core/engine/visual-compare.js");

        const exportScale =
          options.figmaScale !== undefined ? Number(options.figmaScale) : undefined;
        if (exportScale !== undefined && (!Number.isFinite(exportScale) || exportScale < 1)) {
          console.error("Error: --figma-scale must be a number >= 1");
          process.exit(1);
        }

        // CAC passes option values as strings — coerce to numbers before validation
        const width = options.width !== undefined ? Number(options.width) : undefined;
        const height = options.height !== undefined ? Number(options.height) : undefined;

        if (width !== undefined && (!Number.isFinite(width) || width <= 0)) {
          console.error("Error: --width must be a positive number");
          process.exit(1);
        }
        if (height !== undefined && (!Number.isFinite(height) || height <= 0)) {
          console.error("Error: --height must be a positive number");
          process.exit(1);
        }

        const hasViewportOverride = width !== undefined || height !== undefined;

        // Progress to stderr so stdout contains only valid JSON
        console.error("Comparing...");
        const result = await visualCompare({
          figmaUrl: options.figmaUrl,
          figmaToken: token,
          codePath: resolve(codePath),
          outputDir: options.output,
          ...(exportScale !== undefined ? { figmaExportScale: exportScale } : {}),
          ...(hasViewportOverride
            ? {
                viewport: {
                  ...(width !== undefined ? { width } : {}),
                  ...(height !== undefined ? { height } : {}),
                },
              }
            : {}),
        });

        // JSON output for programmatic use
        console.log(JSON.stringify({
          similarity: result.similarity,
          diffPixels: result.diffPixels,
          totalPixels: result.totalPixels,
          width: result.width,
          height: result.height,
          figmaScreenshot: result.figmaScreenshotPath,
          codeScreenshot: result.codeScreenshotPath,
          diff: result.diffPath,
        }, null, 2));

      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
