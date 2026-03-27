/**
 * Ablation Phase 1: Priority ranking.
 *
 * For each of 12 information types × N fixtures × M runs:
 *   1. Generate design-tree (baseline or stripped)
 *   2. Send to Claude API with PROMPT.md
 *   3. Parse HTML + interpretations from response
 *   4. Render HTML → screenshot via Playwright
 *   5. Compare screenshot vs Figma screenshot → similarity
 *   6. Record ΔV, ΔI, ΔT
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx src/agents/ablation/run-phase1.ts
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY  — required
 *   ABLATION_FIXTURES  — comma-separated fixture names (default: 3 desktop fixtures)
 *   ABLATION_RUNS      — runs per condition (default: 1 for Phase 1, set 3 for Phase 2)
 *
 * Output: logs/ablation/phase1/
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { generateDesignTree } from "../../core/engine/design-tree.js";
import { stripDesignTree, DESIGN_TREE_INFO_TYPES } from "../../core/engine/design-tree-strip.js";
import type { DesignTreeInfoType } from "../../core/engine/design-tree-strip.js";
import { loadFigmaFileFromJson } from "../../core/adapters/figma-file-loader.js";
import { renderCodeScreenshot } from "../../core/engine/visual-compare.js";
import { compareScreenshots } from "../../core/engine/visual-compare-helpers.js";

// --- Configuration ---

const MODEL = "claude-sonnet-4-20250514";
const TEMPERATURE = 0;
const MAX_TOKENS = 16000;

const DEFAULT_FIXTURES = [
  "desktop-product-detail",
  "desktop-landing-page",
  "desktop-ai-chat",
];

const OUTPUT_DIR = resolve("logs/ablation/phase1");
const PROMPT_PATH = resolve(".claude/skills/design-to-code/PROMPT.md");

// --- Types ---

interface CacheKey {
  model: string;
  temperature: number;
  maxTokens: number;
  promptHash: string;
  configVersion: string;
}

interface RunResult {
  fixture: string;
  type: "baseline" | DesignTreeInfoType;
  runIndex: number;
  similarity: number;
  interpretationsCount: number;
  interpretationsParseFailed?: boolean;
  parseWarnings?: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  htmlPath: string;
  codePngPath: string;
  timestamp: string;
  cacheKey: CacheKey;
}

interface Phase1Summary {
  startedAt: string;
  completedAt: string;
  model: string;
  temperature: number;
  runsPerCondition: number;
  fixtures: string[];
  results: RunResult[];
  rankings: RankingEntry[];
}

interface RankingEntry {
  type: DesignTreeInfoType;
  avgDeltaV: number;
  avgDeltaI: number;
  avgDeltaT: number;
  perFixture: Record<string, { deltaV: number; deltaI: number; deltaT: number }>;
}

// --- Cache validation ---

/** Auto-computed from core source files that affect experiment results. */
function computeConfigVersion(): string {
  const coreFiles = [
    resolve("src/core/engine/design-tree-strip.ts"),
    resolve("src/core/engine/design-tree.ts"),
    resolve("src/core/engine/visual-compare.ts"),
    resolve("src/core/engine/visual-compare-helpers.ts"),
  ];
  const hash = createHash("sha256");
  for (const f of coreFiles) {
    if (existsSync(f)) hash.update(readFileSync(f, "utf-8"));
  }
  return hash.digest("hex").slice(0, 12);
}
const CONFIG_VERSION = computeConfigVersion();

function computePromptHash(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

function buildCacheKey(prompt: string): CacheKey {
  return {
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    promptHash: computePromptHash(prompt),
    configVersion: CONFIG_VERSION,
  };
}

/** Required artifacts for a valid cached run. */
const REQUIRED_ARTIFACTS = ["result.json", "output.html", "code.png", "figma.png", "diff.png"];

function isCacheValid(fixture: string, type: string, runIndex: number, currentKey: CacheKey): boolean {
  const runDir = getRunDir(fixture, type, runIndex);
  const resultPath = join(runDir, "result.json");
  if (!existsSync(resultPath)) return false;

  // Check all required artifacts exist
  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!existsSync(join(runDir, artifact))) return false;
  }

  try {
    const result = JSON.parse(readFileSync(resultPath, "utf-8")) as RunResult;
    if (!result.cacheKey) return false;
    return (
      result.cacheKey.model === currentKey.model &&
      result.cacheKey.temperature === currentKey.temperature &&
      result.cacheKey.maxTokens === currentKey.maxTokens &&
      result.cacheKey.promptHash === currentKey.promptHash &&
      result.cacheKey.configVersion === currentKey.configVersion
    );
  } catch {
    return false;
  }
}

// --- Helpers ---

function getRunDir(fixture: string, type: string, runIndex: number): string {
  return resolve(OUTPUT_DIR, fixture, type, `run-${runIndex}`);
}

function getResultPath(fixture: string, type: string, runIndex: number): string {
  return join(getRunDir(fixture, type, runIndex), "result.json");
}

/** Detect no-op strip types by comparing output. */
function isStripNoOp(baselineTree: string, type: DesignTreeInfoType): boolean {
  const stripped = stripDesignTree(baselineTree, type);
  return stripped === baselineTree;
}

/** Extract HTML code block and interpretations from LLM response. */
function parseResponse(text: string): { html: string; interpretations: string[]; parseWarnings: string[]; interpretationsParseFailed?: boolean } {
  const warnings: string[] = [];

  // Extract HTML from fenced code block — prioritize by content, not position
  let html = "";
  const allBlocks = [...text.matchAll(/```(?:html|css|[a-z]*)?\s*\n([\s\S]*?)```/g)]
    .map((m) => m[1]?.trim() ?? "")
    .filter((block) => block.includes("<") && block.length > 100);

  if (allBlocks.length > 0) {
    // Priority 1: block starting with <!doctype or <html (full document)
    const fullDoc = allBlocks.find((b) => /^<!doctype|^<html/i.test(b));
    // Priority 2: block containing <body (partial document)
    const hasBody = fullDoc ? undefined : allBlocks.find((b) => /<body/i.test(b));
    // Fallback: largest block
    html = fullDoc ?? hasBody ?? allBlocks.reduce((a, b) => (a.length >= b.length ? a : b));
  }
  if (!html) warnings.push("No HTML code block found in response");

  // Extract interpretations — multiple patterns for robustness
  const patterns = [
    /\/\/\s*interpretations:\s*([\s\S]*?)(?:```|$)/i,           // // interpretations:
    /#{1,3}\s*interpretations\s*\n([\s\S]*?)(?:```|#{1,3}|$)/i, // ### Interpretations
    /\*\*interpretations?\*\*[:\s]*([\s\S]*?)(?:```|$)/i,       // **Interpretations**:
  ];

  let interpText: string | null = null;
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      interpText = match[1];
      break;
    }
  }

  if (interpText === null) {
    warnings.push("No interpretations section found — marking as parse failure (-1)");
    return { html, interpretations: [], parseWarnings: warnings, interpretationsParseFailed: true };
  }

  if (interpText.trim().toLowerCase() === "none") {
    return { html, interpretations: [], parseWarnings: warnings };
  }

  const interpretations = interpText
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);

  return { html, interpretations, parseWarnings: warnings };
}

/** Get fixture screenshot path (Figma ground truth). */
function getFixtureScreenshotPath(fixture: string): string {
  const width = fixture.startsWith("mobile-") ? 375 : 1200;
  return resolve(`fixtures/${fixture}/screenshot-${width}.png`);
}

/** Get design-tree options for a fixture (vectorDir, imageDir). */
function getDesignTreeOptions(fixture: string) {
  const fixtureDir = resolve(`fixtures/${fixture}`);
  const vectorDir = join(fixtureDir, "vectors");
  const imageDir = join(fixtureDir, "images");
  return {
    ...(existsSync(vectorDir) ? { vectorDir } : {}),
    ...(existsSync(imageDir) ? { imageDir } : {}),
  };
}

// --- Main execution ---

async function runSingle(
  client: Anthropic,
  prompt: string,
  fixture: string,
  type: "baseline" | DesignTreeInfoType,
  designTree: string,
  runIndex: number,
  cacheKey: CacheKey,
): Promise<RunResult> {
  const runDir = getRunDir(fixture, type, runIndex);
  mkdirSync(runDir, { recursive: true });

  // Save design-tree for reference
  writeFileSync(join(runDir, "design-tree.txt"), designTree);

  // Call Claude API
  console.log(`    Calling Claude API (run ${runIndex + 1})...`);
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: TEMPERATURE,
    system: prompt,
    messages: [{ role: "user", content: designTree }],
  });

  const responseText = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  // Save raw response
  writeFileSync(join(runDir, "response.txt"), responseText);

  // Parse HTML and interpretations
  const { html, interpretations, parseWarnings, interpretationsParseFailed } = parseResponse(responseText);
  if (parseWarnings.length > 0) {
    for (const w of parseWarnings) console.warn(`    WARNING: ${w}`);
  }

  const htmlPath = join(runDir, "output.html");
  writeFileSync(htmlPath, html);
  writeFileSync(join(runDir, "interpretations.json"), JSON.stringify(interpretations, null, 2));

  // Copy fixture images to run dir so HTML can reference them
  const fixtureImagesDir = resolve(`fixtures/${fixture}/images`);
  if (existsSync(fixtureImagesDir)) {
    const runImagesDir = join(runDir, "images");
    mkdirSync(runImagesDir, { recursive: true });
    for (const f of readdirSync(fixtureImagesDir)) {
      copyFileSync(join(fixtureImagesDir, f), join(runImagesDir, f));
    }
  }

  // Render HTML to screenshot
  console.log(`    Rendering screenshot...`);
  const codePngPath = join(runDir, "code.png");
  const figmaScreenshotPath = getFixtureScreenshotPath(fixture);
  const figmaPng = readFileSync(figmaScreenshotPath);
  const { PNG } = await import("pngjs");
  const figmaImage = PNG.sync.read(figmaPng);
  const exportScale = 2;
  const logicalW = Math.max(1, Math.round(figmaImage.width / exportScale));
  const logicalH = Math.max(1, Math.round(figmaImage.height / exportScale));

  await renderCodeScreenshot(htmlPath, codePngPath, { width: logicalW, height: logicalH }, exportScale);

  // Copy Figma screenshot to run dir
  const figmaCopyPath = join(runDir, "figma.png");
  copyFileSync(figmaScreenshotPath, figmaCopyPath);

  // Compare
  console.log(`    Comparing screenshots...`);
  const diffPath = join(runDir, "diff.png");
  const comparison = compareScreenshots(figmaCopyPath, codePngPath, diffPath);

  const result: RunResult = {
    fixture,
    type,
    runIndex,
    similarity: comparison.similarity,
    interpretationsCount: interpretationsParseFailed ? -1 : interpretations.length,
    ...(interpretationsParseFailed ? { interpretationsParseFailed: true } : {}),
    ...(parseWarnings.length > 0 ? { parseWarnings } : {}),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    htmlPath,
    codePngPath,
    timestamp: new Date().toISOString(),
    cacheKey,
  };

  // Save result
  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));

  console.log(`    ✓ similarity=${(comparison.similarity * 100).toFixed(1)}% interp=${interpretations.length} tokens=${result.totalTokens}`);

  return result;
}

function computeRankings(results: RunResult[]): RankingEntry[] {
  // Index baselines by fixture + runIndex for paired comparison
  const baselineIndex = new Map<string, RunResult>(); // "fixture:runIndex" → result
  for (const r of results) {
    if (r.type === "baseline") {
      baselineIndex.set(`${r.fixture}:${r.runIndex}`, r);
    }
  }

  // Compute paired deltas: same fixture + same runIndex
  // This removes covariance (noise that affects both baseline and ablation in the same run)
  const pairedDeltas = new Map<DesignTreeInfoType, Map<string, { deltaV: number[]; deltaI: number[]; deltaT: number[] }>>();

  for (const r of results) {
    if (r.type === "baseline") continue;
    const type = r.type as DesignTreeInfoType;
    const baseline = baselineIndex.get(`${r.fixture}:${r.runIndex}`);
    if (!baseline) continue;

    if (!pairedDeltas.has(type)) pairedDeltas.set(type, new Map());
    const fixtureDeltas = pairedDeltas.get(type)!;
    if (!fixtureDeltas.has(r.fixture)) fixtureDeltas.set(r.fixture, { deltaV: [], deltaI: [], deltaT: [] });
    const deltas = fixtureDeltas.get(r.fixture)!;

    deltas.deltaV.push(baseline.similarity - r.similarity);
    // Skip ΔI if either side had parse failure (-1)
    if (baseline.interpretationsCount >= 0 && r.interpretationsCount >= 0) {
      deltas.deltaI.push(r.interpretationsCount - baseline.interpretationsCount);
    }
    deltas.deltaT.push(r.totalTokens - baseline.totalTokens);
  }

  // Average paired deltas per fixture, then across fixtures
  const rankings: RankingEntry[] = [];
  for (const [type, fixtures] of pairedDeltas) {
    const perFixture: Record<string, { deltaV: number; deltaI: number; deltaT: number }> = {};
    let sumDV = 0, sumDI = 0, sumDT = 0;
    let count = 0;
    for (const [fixtureName, deltas] of fixtures) {
      const avgDV = deltas.deltaV.length > 0 ? deltas.deltaV.reduce((a, b) => a + b, 0) / deltas.deltaV.length : 0;
      const avgDI = deltas.deltaI.length > 0 ? deltas.deltaI.reduce((a, b) => a + b, 0) / deltas.deltaI.length : 0;
      const avgDT = deltas.deltaT.length > 0 ? deltas.deltaT.reduce((a, b) => a + b, 0) / deltas.deltaT.length : 0;
      perFixture[fixtureName] = { deltaV: avgDV, deltaI: avgDI, deltaT: avgDT };
      sumDV += avgDV;
      sumDI += avgDI;
      sumDT += avgDT;
      count++;
    }
    rankings.push({
      type,
      avgDeltaV: count > 0 ? sumDV / count : 0,
      avgDeltaI: count > 0 ? sumDI / count : 0,
      avgDeltaT: count > 0 ? sumDT / count : 0,
      perFixture,
    });
  }

  rankings.sort((a, b) => b.avgDeltaV - a.avgDeltaV);
  return rankings;
}

function printRankings(rankings: RankingEntry[]): void {
  console.log("\n=== ABLATION PHASE 1 RANKINGS ===\n");
  console.log("  Rank  Type                          avg ΔV      avg ΔI    avg ΔT");
  console.log("  ----  ----------------------------  ----------  --------  --------");
  let rank = 1;
  for (const r of rankings) {
    const dv = (r.avgDeltaV * 100).toFixed(2).padStart(8) + "%";
    const di = (r.avgDeltaI > 0 ? "+" : "") + r.avgDeltaI.toFixed(1);
    const dt = (r.avgDeltaT > 0 ? "+" : "") + r.avgDeltaT.toFixed(0);
    console.log(`  ${String(rank).padStart(4)}  ${r.type.padEnd(28)}  ${dv}  ${di.padStart(8)}  ${dt.padStart(8)}`);
    rank++;
  }
  console.log("");
}

async function main(): Promise<void> {
  // Validate environment
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }

  if (!existsSync(PROMPT_PATH)) {
    console.error(`Error: PROMPT.md not found at ${PROMPT_PATH}`);
    process.exit(1);
  }

  // Configuration from environment
  const fixtures = process.env["ABLATION_FIXTURES"]
    ? process.env["ABLATION_FIXTURES"].split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FIXTURES;
  const rawRuns = process.env["ABLATION_RUNS"];
  const runsPerCondition = rawRuns ? parseInt(rawRuns, 10) : 1;
  if (!Number.isFinite(runsPerCondition) || runsPerCondition < 1) {
    console.error(`Error: ABLATION_RUNS must be a positive integer (got: ${rawRuns})`);
    process.exit(1);
  }

  const prompt = readFileSync(PROMPT_PATH, "utf-8");
  const cacheKey = buildCacheKey(prompt);
  const client = new Anthropic({ apiKey });

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Model: ${MODEL}`);
  console.log(`Fixtures: ${fixtures.join(", ")}`);
  console.log(`Runs per condition: ${runsPerCondition}`);
  console.log(`Prompt hash: ${cacheKey.promptHash}`);
  console.log(`Config version: ${cacheKey.configVersion}`);
  console.log("");

  const startedAt = new Date().toISOString();
  const allResults: RunResult[] = [];
  const newResults: RunResult[] = [];  // Only this session (for cost tracking)

  for (const fixture of fixtures) {
    console.log(`\n=== ${fixture} ===\n`);

    // Validate fixture exists
    const fixturePath = resolve(`fixtures/${fixture}/data.json`);
    if (!existsSync(fixturePath)) {
      console.error(`  ERROR: Fixture not found: ${fixturePath}`);
      continue;
    }

    const screenshotPath = getFixtureScreenshotPath(fixture);
    if (!existsSync(screenshotPath)) {
      console.error(`  ERROR: Screenshot not found: ${screenshotPath}`);
      continue;
    }

    // Load fixture and generate design-tree
    const file = await loadFigmaFileFromJson(fixturePath);
    const options = getDesignTreeOptions(fixture);
    const baselineTree = generateDesignTree(file, options);

    // Detect no-op strip types for this fixture
    const skipTypes = new Set<DesignTreeInfoType>();
    for (const type of DESIGN_TREE_INFO_TYPES) {
      if (isStripNoOp(baselineTree, type)) {
        skipTypes.add(type);
      }
    }
    if (skipTypes.size > 0) {
      console.log(`  Skipping no-op types: ${[...skipTypes].join(", ")}`);
    }

    // All conditions: baseline + non-skipped types
    const conditions: Array<"baseline" | DesignTreeInfoType> = [
      "baseline",
      ...DESIGN_TREE_INFO_TYPES.filter((t) => !skipTypes.has(t)),
    ];

    for (const type of conditions) {
      for (let run = 0; run < runsPerCondition; run++) {
        // Check cache with key + artifact validation
        if (isCacheValid(fixture, type, run, cacheKey)) {
          const cached = JSON.parse(readFileSync(getResultPath(fixture, type, run), "utf-8")) as RunResult;
          allResults.push(cached);
          console.log(`  [cached] ${type} run ${run + 1} → similarity=${(cached.similarity * 100).toFixed(1)}%`);
          continue;
        }

        console.log(`  [${type}] run ${run + 1}/${runsPerCondition}`);
        const tree = type === "baseline" ? baselineTree : stripDesignTree(baselineTree, type);
        const result = await runSingle(client, prompt, fixture, type, tree, run, cacheKey);
        allResults.push(result);
        newResults.push(result);
      }
    }
  }

  // Compute rankings
  const rankings = computeRankings(allResults);
  printRankings(rankings);

  // Save summary
  const summary: Phase1Summary = {
    startedAt,
    completedAt: new Date().toISOString(),
    model: MODEL,
    temperature: TEMPERATURE,
    runsPerCondition,
    fixtures: [...fixtures],
    results: allResults,
    rankings,
  };

  writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`Summary saved to ${join(OUTPUT_DIR, "summary.json")}`);

  // Print cost estimate (Sonnet pricing: $3/MTok input, $15/MTok output)
  const sessionInputTokens = newResults.reduce((s, r) => s + r.inputTokens, 0);
  const sessionOutputTokens = newResults.reduce((s, r) => s + r.outputTokens, 0);
  const sessionCost = (sessionInputTokens * 3 / 1_000_000) + (sessionOutputTokens * 15 / 1_000_000);
  const cachedCount = allResults.length - newResults.length;
  console.log(`\nThis session: ${newResults.length} new calls, ${cachedCount} cached`);
  console.log(`Session tokens: ${sessionInputTokens} input + ${sessionOutputTokens} output`);
  console.log(`Session cost: ~$${sessionCost.toFixed(2)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
