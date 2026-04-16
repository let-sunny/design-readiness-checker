import { resolve } from "node:path";
import type { CAC } from "cac";

import { parseFigmaUrl } from "../../core/adapters/figma-url-parser.js";
import { getFigmaToken } from "../../core/engine/config-store.js";
import { VisualCompareCliOptionsSchema } from "../../core/contracts/visual-compare.js";


export function registerVisualCompare(cli: CAC): void {
  cli
    .command(
      "visual-compare <codePath>",
      "Compare rendered code against Figma screenshot (pixel-level similarity)"
    )
    .option("--figma-url <url>", "Figma URL with node-id (required for API fetch)")
    .option("--figma-screenshot <path>", "Local Figma screenshot file (skips API fetch)")
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--output <dir>", "Output directory for screenshots and diff (default: /tmp/canicode-visual-compare)")
    .option("--width <px>", "Logical viewport width in CSS px (default: infer from Figma PNG ÷ export scale)")
    .option("--height <px>", "Logical viewport height in CSS px (default: infer from Figma PNG ÷ export scale)")
    .option("--figma-scale <n>", "Figma export scale (default: 2, matches calibrate-save-fixture / @2x PNGs)")
    .option("--expand-root", "Replace root element's fixed width with 100% before rendering (for responsive comparison)")
    .example("  canicode visual-compare ./generated/index.html --figma-url 'https://www.figma.com/design/ABC/File?node-id=1-234'")
    .action(async (codePath: string, rawOptions: Record<string, unknown>) => {
      try {
        const parseResult = VisualCompareCliOptionsSchema.safeParse(rawOptions);
        if (!parseResult.success) {
          const msg = parseResult.error.issues.map(i => `--${i.path.join(".")}: ${i.message}`).join("\n");
          console.error(`\nInvalid options:\n${msg}`);
          process.exit(1);
        }
        const options = parseResult.data;

        if (!options.figmaUrl && !options.figmaScreenshot) {
          console.error("Error: --figma-url or --figma-screenshot is required");
          process.exitCode = 1; return;
        }

        // When using --figma-screenshot, --figma-url is still needed for URL parsing
        // but token is not required (no API fetch)
        if (options.figmaUrl && !parseFigmaUrl(options.figmaUrl).nodeId) {
          console.warn("Warning: --figma-url has no node-id. Results may be inaccurate for full files.");
          console.warn("Tip: Add ?node-id=XXX to target a specific section.\n");
        }

        const token = options.token ?? getFigmaToken();
        if (!token && !options.figmaScreenshot) {
          console.error("Error: Figma token required. Use --token or set FIGMA_TOKEN env var (or use --figma-screenshot for local files).");
          process.exitCode = 1; return;
        }

        const { visualCompare } = await import("../../core/comparison/visual-compare.js");

        const hasViewportOverride = options.width !== undefined || options.height !== undefined;

        // Progress to stderr so stdout contains only valid JSON
        console.error("Comparing...");
        const result = await visualCompare({
          figmaUrl: options.figmaUrl ?? "https://www.figma.com/design/local/file?node-id=0-0",
          figmaToken: token ?? "",
          codePath: resolve(codePath),
          outputDir: options.output,
          ...(options.figmaScale !== undefined ? { figmaExportScale: options.figmaScale } : {}),
          ...(options.figmaScreenshot ? { figmaScreenshotPath: resolve(options.figmaScreenshot) } : {}),
          ...(hasViewportOverride
            ? {
                viewport: {
                  ...(options.width !== undefined ? { width: options.width } : {}),
                  ...(options.height !== undefined ? { height: options.height } : {}),
                },
              }
            : {}),
          ...(options.expandRoot ? { expandRoot: true } : {}),
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
        process.exitCode = 1;
      }
    });
}
