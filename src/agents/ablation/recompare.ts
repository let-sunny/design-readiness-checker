/**
 * Re-render and re-compare existing baseline HTML against Figma screenshots.
 * No API calls — only local rendering and pixel comparison.
 *
 * Usage:
 *   npx tsx src/agents/ablation/recompare.ts
 *   ABLATION_FIXTURES=desktop-product-detail npx tsx src/agents/ablation/recompare.ts
 */

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { renderAndCompare, getFixtureScreenshotPath, DEFAULT_FIXTURES } from "./helpers.js";

const BASE_OUTPUT_DIR = resolve("data/ablation/phase1");

async function main(): Promise<void> {
  const fixtures = process.env["ABLATION_FIXTURES"]
    ? process.env["ABLATION_FIXTURES"].split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FIXTURES;

  // Find all config versions
  if (!existsSync(BASE_OUTPUT_DIR)) {
    console.error("No ablation results found");
    process.exit(1);
  }

  const versions = readdirSync(BASE_OUTPUT_DIR).filter((d) =>
    existsSync(join(BASE_OUTPUT_DIR, d))
  );

  for (const version of versions) {
    console.log(`\nConfig version: ${version}\n`);

    for (const fixture of fixtures) {
      const typeDirs = join(BASE_OUTPUT_DIR, version, fixture);
      if (!existsSync(typeDirs)) continue;

      const figmaPath = getFixtureScreenshotPath(fixture);
      if (!existsSync(figmaPath)) {
        console.log(`  SKIP ${fixture}: no screenshot`);
        continue;
      }

      const types = readdirSync(typeDirs);
      for (const type of types) {
        const runDir = join(typeDirs, type, "run-0");
        const htmlPath = join(runDir, "output.html");
        if (!existsSync(htmlPath)) continue;

        console.log(`  ${fixture}/${type}...`);
        const result = await renderAndCompare(htmlPath, figmaPath, runDir, "base");

        // Update result.json
        const resultPath = join(runDir, "result.json");
        if (existsSync(resultPath)) {
          const r = JSON.parse(readFileSync(resultPath, "utf-8")) as Record<string, unknown>;
          r["similarity"] = result.similarity;
          writeFileSync(resultPath, JSON.stringify(r, null, 2));
        }

        console.log(`    ✓ sim=${result.similarity.toFixed(1)}%`);
      }
    }
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
