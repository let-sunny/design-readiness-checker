import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";
import { z } from "zod";

import { parseFigmaUrl } from "../../../core/adapters/figma-url-parser.js";
import { analyzeFile } from "../../../core/engine/rule-engine.js";
import { loadFile, isFigmaUrl, isJsonFile, isFixtureDir } from "../../../core/engine/loader.js";
import { getFigmaToken } from "../../../core/engine/config-store.js";
import { calculateScores, buildResultJson } from "../../../core/engine/scoring.js";
import { collectVectorNodes, collectImageNodes, sanitizeFilename } from "../../helpers.js";

const ImplementOptionsSchema = z.object({
  token: z.string().optional(),
  output: z.string().optional(),
  prompt: z.string().optional(),
  imageScale: z.string().optional(),
});


export function registerCalibrateImplement(cli: CAC): void {
  cli
    .command(
      "calibrate-implement <input>",
      "Prepare design-to-code package for calibration: analysis + design tree + assets + prompt"
    )
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--output <dir>", "Output directory (default: ./canicode-implement/)")
    .option("--prompt <path>", "Custom prompt file (default: built-in HTML+CSS prompt)")
    .option("--image-scale <n>", "Image export scale: 2 for PC (default), 3 for mobile")
    .example("  canicode calibrate-implement ./fixtures/my-design")
    .example("  canicode calibrate-implement ./fixtures/my-design --prompt ./my-react-prompt.md --image-scale 3")
    .action(async (input: string, rawOptions: Record<string, unknown>) => {
      try {
        const parseResult = ImplementOptionsSchema.safeParse(rawOptions);
        if (!parseResult.success) {
          const msg = parseResult.error.issues.map(i => `--${i.path.join(".")}: ${i.message}`).join("\n");
          console.error(`\nInvalid options:\n${msg}`);
          process.exit(1);
        }
        const options = parseResult.data;

        // Validate --image-scale early
        if (options.imageScale !== undefined) {
          const scale = Number(options.imageScale);
          if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
            console.error("Error: --image-scale must be 1-4 (2 for PC, 3 for mobile)");
            process.exit(1);
          }
        }

        // Warn for unscoped Figma URL
        if (isFigmaUrl(input) && !parseFigmaUrl(input).nodeId) {
          console.warn("Warning: No node-id in Figma URL. Implementation package will cover the entire file.");
          console.warn("Tip: Add ?node-id=XXX to target a specific section.\n");
        }

        const outputDir = resolve(options.output ?? "canicode-implement");
        mkdirSync(outputDir, { recursive: true });

        console.log("\nPreparing implementation package...\n");

        // 1. Load file
        const { file } = await loadFile(input, options.token);
        console.log(`Design: ${file.name}`);

        // 2. Analysis
        const result = analyzeFile(file);
        const scores = calculateScores(result);
        const resultJson = buildResultJson(file.name, result, scores, { fileKey: file.fileKey });
        await writeFile(resolve(outputDir, "analysis.json"), JSON.stringify(resultJson, null, 2), "utf-8");
        console.log(`  analysis.json: ${result.issues.length} issues, grade ${scores.overall.grade}`);

        // 3. Prepare assets (before design tree, so tree can reference image paths)
        const fixtureBase = (isJsonFile(input) || isFixtureDir(input))
          ? (isJsonFile(input) ? dirname(resolve(input)) : resolve(input))
          : undefined;

        let vectorDir = fixtureBase ? resolve(fixtureBase, "vectors") : undefined;
        let imageDir = fixtureBase ? resolve(fixtureBase, "images") : undefined;

        // Copy fixture assets to output
        if (vectorDir && existsSync(vectorDir)) {
          const vecOutputDir = resolve(outputDir, "vectors");
          mkdirSync(vecOutputDir, { recursive: true });
          const { readdirSync, copyFileSync } = await import("node:fs");
          const vecFiles = readdirSync(vectorDir).filter(f => f.endsWith(".svg") || f === "mapping.json");
          for (const f of vecFiles) {
            copyFileSync(resolve(vectorDir, f), resolve(vecOutputDir, f));
          }
          vectorDir = vecOutputDir;
          console.log(`  vectors/: ${vecFiles.length} SVGs copied`);
        }

        if (imageDir && existsSync(imageDir)) {
          const imgOutputDir = resolve(outputDir, "images");
          mkdirSync(imgOutputDir, { recursive: true });
          const { readdirSync, copyFileSync } = await import("node:fs");
          const imgFiles = readdirSync(imageDir).filter(f => f.endsWith(".png") || f.endsWith(".jpg") || f.endsWith(".json"));
          for (const f of imgFiles) {
            copyFileSync(resolve(imageDir, f), resolve(imgOutputDir, f));
          }
          imageDir = imgOutputDir;
          const pngCount = imgFiles.filter(f => f.endsWith(".png")).length;
          console.log(`  images/: ${pngCount} assets copied`);
        }

        // Download assets from Figma API for live URLs
        if (isFigmaUrl(input) && !fixtureBase) {
          const figmaToken = options.token ?? getFigmaToken();
          if (figmaToken) {
            const imgScale = options.imageScale !== undefined ? Number(options.imageScale) : 2;

            const { FigmaClient } = await import("../../../core/adapters/figma-client.js");
            const client = new FigmaClient({ token: figmaToken });

            // Download screenshot
            const { nodeId } = parseFigmaUrl(input);
            const rootNodeId = nodeId?.replace(/-/g, ":") ?? file.document.id;
            try {
              const screenshotUrls = await client.getNodeImages(file.fileKey, [rootNodeId], { format: "png", scale: 2 });
              const screenshotUrl = screenshotUrls[rootNodeId];
              if (screenshotUrl) {
                const resp = await fetch(screenshotUrl);
                if (resp.ok) {
                  const buf = Buffer.from(await resp.arrayBuffer());
                  await writeFile(resolve(outputDir, "screenshot.png"), buf);
                  console.log(`  screenshot.png: saved`);
                }
              }
            } catch {
              console.warn("  screenshot.png: failed to download (continuing)");
            }

            // Download vector SVGs
            const vectorNodes = collectVectorNodes(file.document);
            if (vectorNodes.length > 0) {
              const vecOutDir = resolve(outputDir, "vectors");
              mkdirSync(vecOutDir, { recursive: true });
              try {
                const svgUrls = await client.getNodeImages(
                  file.fileKey,
                  vectorNodes.map(n => n.id),
                  { format: "svg" },
                );
                // Build mapping + download in a single pass to keep filenames consistent
                const mapping: Record<string, string> = {};
                const usedNames = new Map<string, number>();
                let downloaded = 0;
                for (const { id, name } of vectorNodes) {
                  let base = sanitizeFilename(name);
                  const count = usedNames.get(base) ?? 0;
                  usedNames.set(base, count + 1);
                  if (count > 0) base = `${base}-${count + 1}`;
                  const filename = `${base}.svg`;
                  mapping[id] = filename;
                  const svgUrl = svgUrls[id];
                  if (!svgUrl) continue;
                  try {
                    const resp = await fetch(svgUrl);
                    if (resp.ok) {
                      const svg = await resp.text();
                      await writeFile(resolve(vecOutDir, filename), svg, "utf-8");
                      downloaded++;
                    }
                  } catch { /* skip */ }
                }
                await writeFile(resolve(vecOutDir, "mapping.json"), JSON.stringify(mapping, null, 2), "utf-8");

                console.log(`  vectors/: ${downloaded}/${vectorNodes.length} SVGs`);
              } catch {
                console.warn("  vectors/: failed to download (continuing)");
              }
            }

            // Download image PNGs
            const imgNodes = collectImageNodes(file.document);
            if (imgNodes.length > 0) {
              const imgOutDir = resolve(outputDir, "images");
              mkdirSync(imgOutDir, { recursive: true });
              try {
                // Use image fills API to get original images (not node renders which include children)
                const imageFills = await client.getImageFills(file.fileKey);
                const mapping: Record<string, string> = {};
                const usedNames = new Map<string, number>();
                let downloaded = 0;
                for (const { id, name, imageRef } of imgNodes) {
                  let base = sanitizeFilename(name);
                  const count = usedNames.get(base) ?? 0;
                  usedNames.set(base, count + 1);
                  if (count > 0) base = `${base}-${count + 1}`;
                  const filename = `${base}@${imgScale}x.png`;
                  mapping[id] = filename;
                  if (!imageRef) continue;
                  const imgUrl = imageFills[imageRef];
                  if (!imgUrl) continue;
                  try {
                    const resp = await fetch(imgUrl);
                    if (resp.ok) {
                      const buf = Buffer.from(await resp.arrayBuffer());
                      await writeFile(resolve(imgOutDir, filename), buf);
                      downloaded++;
                    }
                  } catch { /* skip */ }
                }
                await writeFile(resolve(imgOutDir, "mapping.json"), JSON.stringify(mapping, null, 2), "utf-8");

                imageDir = imgOutDir;
                console.log(`  images/: ${downloaded}/${imgNodes.length} PNGs (@${imgScale}x)`);
              } catch {
                console.warn("  images/: failed to download (continuing)");
              }
            }

            // Update vectorDir to point to downloaded assets
            const vecOutCheck = resolve(outputDir, "vectors");
            if (existsSync(vecOutCheck)) vectorDir = vecOutCheck;
          }
        }

        // 4. Design tree (after assets so image paths are available)
        const { generateDesignTreeWithStats } = await import("../../../core/design-tree/design-tree.js");
        const treeOptions = {
          ...(vectorDir && existsSync(vectorDir) ? { vectorDir } : {}),
          ...(imageDir && existsSync(imageDir) ? { imageDir } : {}),
        };
        const stats = generateDesignTreeWithStats(file, treeOptions);
        await writeFile(resolve(outputDir, "design-tree.txt"), stats.tree, "utf-8");
        console.log(`  design-tree.txt: ~${stats.estimatedTokens} tokens`);

        // 5. Assemble prompt
        if (options.prompt) {
          // Custom prompt: copy user's file
          const { readFile: rf } = await import("node:fs/promises");
          const customPrompt = await rf(resolve(options.prompt), "utf-8");
          await writeFile(resolve(outputDir, "PROMPT.md"), customPrompt, "utf-8");
          console.log(`  PROMPT.md: custom (${options.prompt})`);
        } else {
          // Default: built-in HTML+CSS prompt
          const { readFile: rf } = await import("node:fs/promises");
          const { dirname: dirnameFn, resolve: resolveFn } = await import("node:path");
          const { fileURLToPath } = await import("node:url");
          const cliDir = dirnameFn(fileURLToPath(import.meta.url));
          const projectRoot = resolveFn(cliDir, "../../..");
          const altRoot = resolveFn(cliDir, "../..");

          let prompt = "";
          for (const root of [projectRoot, altRoot]) {
            const p = resolveFn(root, ".claude/skills/design-to-code/PROMPT.md");
            try {
              prompt = await rf(p, "utf-8");
              break;
            } catch { /* try next */ }
          }

          if (prompt) {
            await writeFile(resolve(outputDir, "PROMPT.md"), prompt, "utf-8");
            console.log(`  PROMPT.md: default (html-css)`);
          } else {
            console.warn("  PROMPT.md: built-in prompt not found (skipped)");
          }
        }

        // Summary
        console.log(`\n${"=".repeat(50)}`);
        console.log(`Implementation package ready: ${outputDir}/`);
        console.log(`  Grade: ${scores.overall.grade} (${scores.overall.percentage}%)`);
        console.log(`  Issues: ${result.issues.length}`);
        console.log(`  Design tree: ~${stats.estimatedTokens} tokens`);
        console.log(`${"=".repeat(50)}`);
        console.log(`\nNext: Feed design-tree.txt + PROMPT.md to your AI assistant.`);
      } catch (error) {
        console.error("\nError:", error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      }
    });
}
