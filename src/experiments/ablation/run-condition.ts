/**
 * Ablation condition experiments: viewport or data context changes.
 *
 * size-constraints: strip size info → implement → remove root fixed width → render at 1920/768
 * hover-interaction: strip [hover]: → implement → compare hover CSS values with baseline
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-condition.ts --type size-constraints
 *   ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-condition.ts --type hover-interaction
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { generateDesignTree } from "../../core/design-tree/design-tree.js";
import { stripDesignTree } from "../../core/design-tree/strip.js";
import { loadFigmaFileFromJson } from "../../core/adapters/figma-file-loader.js";
import { renderAndCompare } from "../../core/comparison/visual-compare.js";
import { expandRootWidth } from "../../core/comparison/visual-compare-helpers.js";

import {
  PROMPT_PATH, callApi, processHtml, getResponseText,
  getDesignTreeOptions, getFixtureScreenshotPath, copyFixtureImages,
  parseFixtures, requireApiKey,
} from "./helpers.js";

const OUTPUT_DIR = resolve("data/ablation/conditions");

type ConditionType = "size-constraints" | "hover-interaction";

/** @deprecated Use expandRootWidth from visual-compare-helpers.ts instead. */
const removeRootFixedWidth = expandRootWidth;

// --- Size-constraints ---

async function runSizeConstraints(fixture: string, client: Anthropic, prompt: string): Promise<void> {
  const isMobile = fixture.startsWith("mobile-");
  const baseWidth = isMobile ? 375 : 1200;
  const expandedWidth = isMobile ? 768 : 1920;

  const runDir = resolve(OUTPUT_DIR, "size-constraints", fixture);
  mkdirSync(runDir, { recursive: true });

  const expandedScreenshot = getFixtureScreenshotPath(fixture, expandedWidth);
  if (!existsSync(expandedScreenshot)) {
    console.error(`  ERROR: screenshot-${expandedWidth}.png not found`);
    return;
  }

  const file = await loadFigmaFileFromJson(resolve(`fixtures/${fixture}/data.json`));
  const options = getDesignTreeOptions(fixture);
  const baselineTree = generateDesignTree(file, options);
  const strippedTree = stripDesignTree(baselineTree, "size-constraints");

  copyFixtureImages(fixture, runDir);

  // Baseline: reuse HTML from phase1 cache (no API call)
  const phase1Dir = resolve("data/ablation/phase1");
  let baseHtml: string | null = null;
  if (existsSync(phase1Dir)) {
    const versions = readdirSync(phase1Dir).filter((d) =>
      existsSync(join(phase1Dir, d, fixture, "baseline", "run-0", "output.html"))
    );
    if (versions.length > 0) {
      const latest = versions.sort().reverse()[0]!;
      baseHtml = readFileSync(join(phase1Dir, latest, fixture, "baseline", "run-0", "output.html"), "utf-8");
      console.log(`  [baseline] Reusing from phase1 cache (${latest})`);
    }
  }
  if (!baseHtml) {
    console.log(`  [baseline] No cache — calling API...`);
    const baseResponse = await callApi(client, prompt, baselineTree);
    baseHtml = processHtml(getResponseText(baseResponse)).html;
  }
  const baseExpanded = removeRootFixedWidth(baseHtml);
  writeFileSync(join(runDir, "output-baseline.html"), baseHtml);
  writeFileSync(join(runDir, "output-baseline-expanded.html"), baseExpanded);

  console.log(`  [baseline] Rendering at ${expandedWidth}px...`);
  const baseResult = await renderAndCompare(join(runDir, "output-baseline-expanded.html"), expandedScreenshot, runDir, { suffix: `baseline-${expandedWidth}`, sizeMismatch: "crop" });

  // Stripped: no size info → implement → remove root width → render at expanded
  console.log(`  [stripped] API call...`);
  const stripResponse = await callApi(client, prompt, strippedTree);
  const stripHtml = processHtml(getResponseText(stripResponse)).html;
  const stripExpanded = removeRootFixedWidth(stripHtml);
  writeFileSync(join(runDir, "output-stripped.html"), stripHtml);
  writeFileSync(join(runDir, "output-stripped-expanded.html"), stripExpanded);

  console.log(`  [stripped] Rendering at ${expandedWidth}px...`);
  const stripResult = await renderAndCompare(join(runDir, "output-stripped-expanded.html"), expandedScreenshot, runDir, { suffix: `stripped-${expandedWidth}`, sizeMismatch: "crop" });

  const deltaV = baseResult.similarity - stripResult.similarity;
  const result = {
    fixture, type: "size-constraints", baseWidth, expandedWidth,
    baselineSimilarity: baseResult.similarity,
    strippedSimilarity: stripResult.similarity,
    deltaV,
    strippedTokens: { input: stripResponse.usage.input_tokens, output: stripResponse.usage.output_tokens },
    timestamp: new Date().toISOString(),
  };

  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`  ✓ baseline@${expandedWidth}=${baseResult.similarity.toFixed(1)}% stripped@${expandedWidth}=${stripResult.similarity.toFixed(1)}% ΔV=${deltaV.toFixed(1)}%`);
}

// --- Hover-interaction ---

async function runHoverInteraction(fixture: string, client: Anthropic, prompt: string): Promise<void> {
  const runDir = resolve(OUTPUT_DIR, "hover-interaction", fixture);
  mkdirSync(runDir, { recursive: true });

  const file = await loadFigmaFileFromJson(resolve(`fixtures/${fixture}/data.json`));
  const options = getDesignTreeOptions(fixture);
  const fullTree = generateDesignTree(file, options);
  const strippedTree = stripDesignTree(fullTree, "hover-interaction-states");

  const hoverCount = (fullTree.match(/\[hover\]:/g) ?? []).length;
  if (hoverCount === 0) { console.log(`  No [hover]: data — skipping`); return; }
  console.log(`  ${hoverCount} [hover]: blocks in original`);

  copyFixtureImages(fixture, runDir);

  // With hover data
  console.log(`  [with hover] API call...`);
  const baseResponse = await callApi(client, prompt, fullTree);
  const baseHtml = processHtml(getResponseText(baseResponse)).html;
  writeFileSync(join(runDir, "output-with-hover.html"), baseHtml);

  // Without hover data
  console.log(`  [without hover] API call...`);
  const stripResponse = await callApi(client, prompt, strippedTree);
  const stripHtml = processHtml(getResponseText(stripResponse)).html;
  writeFileSync(join(runDir, "output-without-hover.html"), stripHtml);

  // Extract :hover rules
  const baseHoverRules = baseHtml.match(/[^}]*:hover\s*\{[^}]*\}/g) ?? [];
  const stripHoverRules = stripHtml.match(/[^}]*:hover\s*\{[^}]*\}/g) ?? [];

  const result = {
    fixture, type: "hover-interaction", hoverBlocksInDesignTree: hoverCount,
    withHoverData: {
      hoverCssRules: baseHoverRules.length,
      hoverCssContent: baseHoverRules,
      tokens: { input: baseResponse.usage.input_tokens, output: baseResponse.usage.output_tokens },
      htmlBytes: Buffer.byteLength(baseHtml, "utf-8"),
    },
    withoutHoverData: {
      hoverCssRules: stripHoverRules.length,
      hoverCssContent: stripHoverRules,
      tokens: { input: stripResponse.usage.input_tokens, output: stripResponse.usage.output_tokens },
      htmlBytes: Buffer.byteLength(stripHtml, "utf-8"),
    },
    timestamp: new Date().toISOString(),
  };

  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`  ✓ with=${baseHoverRules.length} rules, without=${stripHoverRules.length} rules`);
  for (const rule of baseHoverRules) console.log(`    [with]    ${rule.trim().slice(0, 100)}`);
  for (const rule of stripHoverRules) console.log(`    [without] ${rule.trim().slice(0, 100)}`);
}

// --- Main ---

async function main(): Promise<void> {
  const typeArg = process.argv.indexOf("--type");
  const type = typeArg !== -1 ? process.argv[typeArg + 1] as ConditionType | undefined : undefined;
  if (!type || !["size-constraints", "hover-interaction"].includes(type)) {
    console.error("Usage: npx tsx run-condition.ts --type <size-constraints|hover-interaction>");
    process.exit(1);
  }

  const apiKey = requireApiKey();
  const prompt = readFileSync(PROMPT_PATH, "utf-8");
  const client = new Anthropic({ apiKey });
  const fixtures = parseFixtures();

  console.log(`Condition: ${type} | Fixtures: ${fixtures.join(", ")}\n`);

  for (const fixture of fixtures) {
    console.log(`=== ${fixture} ===`);
    try {
      if (type === "size-constraints") await runSizeConstraints(fixture, client, prompt);
      else await runHoverInteraction(fixture, client, prompt);
    } catch (err) {
      console.error(`  ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log("");
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
