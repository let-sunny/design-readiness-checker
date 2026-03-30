/**
 * Responsive comparison: reuse existing HTML from strip experiments.
 * No API calls — only local rendering at expanded viewports.
 *
 * Takes baseline + size-constraints stripped HTML → removes root fixed width
 * → renders at 1920px (desktop) or 768px (mobile) → compares vs expanded screenshot.
 *
 * Usage:
 *   npx tsx src/experiments/ablation/run-responsive.ts
 *   ABLATION_FIXTURES=mobile-product-detail npx tsx src/experiments/ablation/run-responsive.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

import { renderAndCompare } from "../../core/engine/visual-compare.js";
import { getFixtureScreenshotPath, copyFixtureImages, DEFAULT_FIXTURES } from "./helpers.js";

const PHASE1_DIR = resolve("data/ablation/phase1");
const OUTPUT_DIR = resolve("data/ablation/conditions/size-constraints");

function removeRootFixedWidth(html: string): string {
  return html
    .replace(/width:\s*1200px/g, "width: 100%")
    .replace(/width:\s*375px/g, "width: 100%")
    .replace(/min-width:\s*1200px/g, "min-width: 0")
    .replace(/min-width:\s*375px/g, "min-width: 0");
}

function findLatestHtml(fixture: string, type: string): string | null {
  if (!existsSync(PHASE1_DIR)) return null;
  const versions = readdirSync(PHASE1_DIR).filter((d) => {
    const htmlPath = join(PHASE1_DIR, d, fixture, type, "run-0", "output.html");
    return existsSync(htmlPath);
  });
  if (versions.length === 0) return null;
  const latest = versions.sort().reverse()[0]!;
  return join(PHASE1_DIR, latest, fixture, type, "run-0", "output.html");
}

async function main(): Promise<void> {
  const fixtures = process.env["ABLATION_FIXTURES"]
    ? process.env["ABLATION_FIXTURES"].split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FIXTURES;

  console.log(`Responsive comparison (no API calls)\n`);

  for (const fixture of fixtures) {
    const isMobile = fixture.startsWith("mobile-");
    const expandedWidth = isMobile ? 768 : 1920;

    console.log(`=== ${fixture} (→ ${expandedWidth}px) ===`);

    const expandedScreenshot = getFixtureScreenshotPath(fixture, expandedWidth);
    if (!existsSync(expandedScreenshot)) {
      console.log(`  SKIP: screenshot-${expandedWidth}.png not found`);
      continue;
    }

    const runDir = resolve(OUTPUT_DIR, fixture);
    mkdirSync(runDir, { recursive: true });
    copyFixtureImages(fixture, runDir);

    // Baseline HTML → expanded viewport
    const baselineHtmlPath = findLatestHtml(fixture, "baseline");
    if (!baselineHtmlPath) {
      console.log(`  SKIP: no baseline HTML found`);
      continue;
    }

    const baselineHtml = readFileSync(baselineHtmlPath, "utf-8");
    const baselineExpanded = removeRootFixedWidth(baselineHtml);
    writeFileSync(join(runDir, "output-baseline-expanded.html"), baselineExpanded);

    console.log(`  [baseline] Rendering at ${expandedWidth}px...`);
    const baseResult = await renderAndCompare(
      join(runDir, "output-baseline-expanded.html"),
      expandedScreenshot, runDir, { suffix: `baseline-${expandedWidth}`, sizeMismatch: "crop" },
    );

    // Size-constraints stripped HTML → expanded viewport
    const strippedHtmlPath = findLatestHtml(fixture, "size-constraints");
    let stripResult: { similarity: number } | null = null;

    if (strippedHtmlPath) {
      const strippedHtml = readFileSync(strippedHtmlPath, "utf-8");
      const strippedExpanded = removeRootFixedWidth(strippedHtml);
      writeFileSync(join(runDir, "output-stripped-expanded.html"), strippedExpanded);

      console.log(`  [stripped] Rendering at ${expandedWidth}px...`);
      stripResult = await renderAndCompare(
        join(runDir, "output-stripped-expanded.html"),
        expandedScreenshot, runDir, { suffix: `stripped-${expandedWidth}`, sizeMismatch: "crop" },
      );
    } else {
      console.log(`  SKIP: no size-constraints stripped HTML found`);
    }

    const deltaV = stripResult ? baseResult.similarity - stripResult.similarity : null;

    const result = {
      fixture,
      expandedWidth,
      baselineSimilarity: baseResult.similarity,
      strippedSimilarity: stripResult?.similarity ?? null,
      deltaV,
      timestamp: new Date().toISOString(),
    };

    writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));
    console.log(`  ✓ baseline@${expandedWidth}=${baseResult.similarity.toFixed(1)}%${stripResult ? ` stripped@${expandedWidth}=${stripResult.similarity.toFixed(1)}% ΔV=${deltaV?.toFixed(1)}%` : ""}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
