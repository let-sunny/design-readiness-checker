import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CAC } from "cac";
import { z } from "zod";

import { parseFigmaUrl } from "../../../core/adapters/figma-url-parser.js";
import { loadFile, isFigmaUrl } from "../../../core/engine/loader.js";
import { getFigmaToken } from "../../../core/engine/config-store.js";
import { collectVectorNodes, collectImageNodes, sanitizeFilename, countNodes } from "../../helpers.js";

const SaveFixtureOptionsSchema = z.object({
  output: z.string().optional(),
  api: z.boolean().optional(),
  token: z.string().optional(),
  imageScale: z.string().optional(),
  name: z.string().optional(),
});


export function registerCalibrateSaveFixture(cli: CAC): void {
  cli
    .command(
      "calibrate-save-fixture <input>",
      "Save Figma design as a fixture directory for calibration"
    )
    .option("--output <path>", "Output directory (default: fixtures/<name>/)")
    .option("--name <name>", "Fixture name (default: extracted from URL)")
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--image-scale <n>", "Image export scale: 2 for PC (default), 3 for mobile")
    .example("  canicode calibrate-save-fixture https://www.figma.com/design/ABC123/MyDesign?node-id=1-234")
    .example("  canicode calibrate-save-fixture https://www.figma.com/design/ABC123/MyDesign?node-id=1-234 --image-scale 3")
    .action(async (input: string, rawOptions: Record<string, unknown>) => {
      try {
        const parseResult = SaveFixtureOptionsSchema.safeParse(rawOptions);
        if (!parseResult.success) {
          const msg = parseResult.error.issues.map(i => `--${i.path.join(".")}: ${i.message}`).join("\n");
          console.error(`\nInvalid options:\n${msg}`);
          process.exit(1);
        }
        const options = parseResult.data;

        if (!isFigmaUrl(input)) {
          throw new Error("calibrate-save-fixture requires a Figma URL as input.");
        }

        // Validate --image-scale early (before any file I/O)
        if (options.imageScale !== undefined) {
          const scale = Number(options.imageScale);
          if (!Number.isFinite(scale) || scale < 1 || scale > 4) {
            console.error("Error: --image-scale must be 1-4 (2 for PC, 3 for mobile)");
            process.exit(1);
          }
        }

        if (!parseFigmaUrl(input).nodeId) {
          console.warn("\nWarning: No node-id specified. Saving entire file as fixture.");
          console.warn("Tip: Add ?node-id=XXX to save a specific section.\n");
        }

        const { file } = await loadFile(input, options.token);
        file.sourceUrl = input;

        const fixtureName = options.name ?? file.fileKey;
        const fixtureDir = resolve(options.output ?? `fixtures/${fixtureName}`);
        mkdirSync(fixtureDir, { recursive: true });

        // 0. Resolve component master node trees
        const figmaTokenForComponents = options.token ?? getFigmaToken();
        if (figmaTokenForComponents) {
          const { FigmaClient: FC } = await import("../../../core/adapters/figma-client.js");
          const { resolveComponentDefinitions, resolveInteractionDestinations } = await import("../../../core/adapters/component-resolver.js");
          const componentClient = new FC({ token: figmaTokenForComponents });
          try {
            const definitions = await resolveComponentDefinitions(componentClient, file.fileKey, file.document);
            const count = Object.keys(definitions).length;
            if (count > 0) {
              file.componentDefinitions = definitions;
              console.log(`Resolved ${count} component master node tree(s)`);
            }
            // Resolve interaction destinations (hover variants, etc.)
            const interactionDests = await resolveInteractionDestinations(componentClient, file.fileKey, file.document, file.componentDefinitions);
            const destCount = Object.keys(interactionDests).length;
            if (destCount > 0) {
              file.interactionDestinations = interactionDests;
              console.log(`Resolved ${destCount} interaction destination(s)`);
            }
          } catch {
            console.warn("Warning: failed to resolve component definitions (continuing)");
          }
        }

        // 1. Save data.json
        const dataPath = resolve(fixtureDir, "data.json");
        await writeFile(dataPath, JSON.stringify(file, null, 2), "utf-8");
        console.log(`Fixture saved: ${fixtureDir}/`);
        console.log(`  data.json: ${file.name} (${countNodes(file.document)} nodes)`);

        // 2. Download screenshot
        const figmaToken = options.token ?? getFigmaToken();
        if (figmaToken) {
          const { FigmaClient } = await import("../../../core/adapters/figma-client.js");
          const client = new FigmaClient({ token: figmaToken });
          const { nodeId } = parseFigmaUrl(input);
          const rootNodeId = nodeId?.replace(/-/g, ":") ?? file.document.id;

          try {
            const imageUrls = await client.getNodeImages(file.fileKey, [rootNodeId], { format: "png", scale: 2 });
            const url = imageUrls[rootNodeId];
            if (url) {
              const resp = await fetch(url);
              if (resp.ok) {
                const buffer = Buffer.from(await resp.arrayBuffer());
                const { writeFile: writeFileSync } = await import("node:fs/promises");
                await writeFileSync(resolve(fixtureDir, "screenshot.png"), buffer);
                console.log(`  screenshot.png: saved`);
              }
            }
          } catch {
            console.warn("  screenshot.png: failed to download (continuing)");
          }

          // 3. Download SVGs for VECTOR nodes
          const vectorNodes = collectVectorNodes(file.document);
          if (vectorNodes.length > 0) {
            const vectorDir = resolve(fixtureDir, "vectors");
            mkdirSync(vectorDir, { recursive: true });

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
                  await writeFile(resolve(vectorDir, filename), svg, "utf-8");
                  downloaded++;
                }
              } catch {
                // Skip failed downloads
              }
            }
            await writeFile(resolve(vectorDir, "mapping.json"), JSON.stringify(mapping, null, 2), "utf-8");

            console.log(`  vectors/: ${downloaded}/${vectorNodes.length} SVGs`);
          }

          // 4. Download PNGs for IMAGE fill nodes
          const imageNodes = collectImageNodes(file.document);
          if (imageNodes.length > 0) {
            const imgScale = options.imageScale !== undefined ? Number(options.imageScale) : 2;

            const imageDir = resolve(fixtureDir, "images");
            mkdirSync(imageDir, { recursive: true });

            // Use image fills API to get original images (not node renders which include children)
            const imageFills = await client.getImageFills(file.fileKey);

            const usedNames = new Map<string, number>();
            const mapping: Record<string, string> = {};
            let imgDownloaded = 0;
            for (const { id, name, imageRef } of imageNodes) {
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
                  await writeFile(resolve(imageDir, filename), buf);
                  imgDownloaded++;
                }
              } catch {
                // Skip failed downloads
              }
            }
            await writeFile(
              resolve(imageDir, "mapping.json"),
              JSON.stringify(mapping, null, 2),
              "utf-8"
            );

            console.log(`  images/: ${imgDownloaded}/${imageNodes.length} PNGs (@${imgScale}x)`);
          }
        }
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
