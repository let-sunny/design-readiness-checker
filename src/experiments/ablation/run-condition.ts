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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { extractHtml } from "../../core/comparison/html-utils.js";

import {
  PROMPT_PATH, callApi, getResponseText,
  getFixtureScreenshotPath, copyFixtureImages,
  parseFixtures, requireApiKey,
} from "./helpers.js";

const OUTPUT_DIR = resolve("data/ablation/conditions");
const CLI_PATH = resolve("dist/cli/index.js");

type ConditionType = "size-constraints" | "hover-interaction";

function execCli(command: string, args: string[]): string {
  return execFileSync(process.execPath, [CLI_PATH, command, ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

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

  // Step 1: Generate design tree (shared CLI)
  const fixturePath = resolve(`fixtures/${fixture}`);
  const baselineTreePath = join(runDir, "design-tree.txt");
  execCli("design-tree", [fixturePath, "--output", baselineTreePath]);
  const baselineTree = readFileSync(baselineTreePath, "utf-8");

  // Step 2: Strip design tree (shared CLI)
  const strippedDir = join(runDir, "stripped");
  execCli("design-tree-strip", [baselineTreePath, "--output-dir", strippedDir, "--types", "size-constraints"]);
  const strippedTree = readFileSync(join(strippedDir, "size-constraints.txt"), "utf-8");

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
    baseHtml = extractHtml(getResponseText(baseResponse)).html;
    writeFileSync(join(runDir, "output-baseline.html"), baseHtml);
    execCli("html-postprocess", [join(runDir, "output-baseline.html")]);
    baseHtml = readFileSync(join(runDir, "output-baseline.html"), "utf-8");
  } else {
    writeFileSync(join(runDir, "output-baseline.html"), baseHtml);
  }

  // Render baseline at expanded viewport
  const baseExpandedDir = join(runDir, "baseline-expanded");
  mkdirSync(baseExpandedDir, { recursive: true });
  writeFileSync(join(baseExpandedDir, "output.html"), baseHtml);
  copyFixtureImages(fixture, baseExpandedDir);
  console.log(`  [baseline] Rendering at ${expandedWidth}px...`);
  const baseResultJson = execCli("visual-compare", [
    join(baseExpandedDir, "output.html"), "--figma-screenshot", expandedScreenshot,
    "--width", String(expandedWidth), "--expand-root", "--output", baseExpandedDir,
  ]);
  const baseResult = JSON.parse(baseResultJson) as { similarity: number };

  // Stripped: no size info → implement → render at expanded
  console.log(`  [stripped] API call...`);
  const stripResponse = await callApi(client, prompt, strippedTree);
  const stripHtml = extractHtml(getResponseText(stripResponse)).html;
  const stripExpandedDir = join(runDir, "stripped-expanded");
  mkdirSync(stripExpandedDir, { recursive: true });
  writeFileSync(join(stripExpandedDir, "output.html"), stripHtml);
  execCli("html-postprocess", [join(stripExpandedDir, "output.html")]);
  copyFixtureImages(fixture, stripExpandedDir);
  writeFileSync(join(runDir, "output-stripped.html"), readFileSync(join(stripExpandedDir, "output.html")));

  console.log(`  [stripped] Rendering at ${expandedWidth}px...`);
  const stripResultJson = execCli("visual-compare", [
    join(stripExpandedDir, "output.html"), "--figma-screenshot", expandedScreenshot,
    "--width", String(expandedWidth), "--expand-root", "--output", stripExpandedDir,
  ]);
  const stripResult = JSON.parse(stripResultJson) as { similarity: number };

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

  // Step 1: Generate design tree (shared CLI)
  const fixturePath = resolve(`fixtures/${fixture}`);
  const fullTreePath = join(runDir, "design-tree.txt");
  execCli("design-tree", [fixturePath, "--output", fullTreePath]);
  const fullTree = readFileSync(fullTreePath, "utf-8");

  // Step 2: Strip hover data (shared CLI)
  const strippedDir = join(runDir, "stripped");
  execCli("design-tree-strip", [fullTreePath, "--output-dir", strippedDir, "--types", "hover-interaction-states"]);
  const strippedTree = readFileSync(join(strippedDir, "hover-interaction-states.txt"), "utf-8");

  const hoverCount = (fullTree.match(/\[hover\]:/g) ?? []).length;
  if (hoverCount === 0) { console.log(`  No [hover]: data — skipping`); return; }
  console.log(`  ${hoverCount} [hover]: blocks in original`);

  copyFixtureImages(fixture, runDir);

  // With hover data
  console.log(`  [with hover] API call...`);
  const baseResponse = await callApi(client, prompt, fullTree);
  const baseRawHtml = extractHtml(getResponseText(baseResponse)).html;
  writeFileSync(join(runDir, "output-with-hover.html"), baseRawHtml);
  execCli("html-postprocess", [join(runDir, "output-with-hover.html")]);
  const baseHtml = readFileSync(join(runDir, "output-with-hover.html"), "utf-8");

  // Without hover data
  console.log(`  [without hover] API call...`);
  const stripResponse = await callApi(client, prompt, strippedTree);
  const stripRawHtml = extractHtml(getResponseText(stripResponse)).html;
  writeFileSync(join(runDir, "output-without-hover.html"), stripRawHtml);
  execCli("html-postprocess", [join(runDir, "output-without-hover.html")]);
  const stripHtml = readFileSync(join(runDir, "output-without-hover.html"), "utf-8");

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
