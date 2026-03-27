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
  fixtureHash: string;
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
  context?: {
    screenshotPath: string;
    logicalViewport: { width: number; height: number };
    exportScale: number;
    htmlExtractMethod: string;
    designTreeTokens: number;
  };
  cacheKey: CacheKey;
}

interface Phase1Summary {
  startedAt: string;
  completedAt: string;
  model: string;
  temperature: number;
  runsPerCondition: number;
  fixtures: string[];
  skippedFixtures: Array<{ fixture: string; reason: string }>;
  cacheStats: { hits: number; newCalls: number };
  parseFailureCount: number;
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
    resolve("src/core/adapters/figma-file-loader.ts"),
    resolve("src/agents/ablation/run-phase1.ts"),
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

function buildCacheKey(prompt: string, fixtureHash: string): CacheKey {
  return {
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    promptHash: computePromptHash(prompt),
    configVersion: CONFIG_VERSION,
    fixtureHash,
  };
}

/** Required artifacts for a valid cached run. */
const REQUIRED_ARTIFACTS = ["result.json", "output.html", "code.png", "figma.png", "diff.png"];

/** Compute hash of fixture inputs (data.json + screenshot). */
function computeFixtureHash(fixture: string): string {
  const hash = createHash("sha256");
  const dataPath = resolve(`fixtures/${fixture}/data.json`);
  if (existsSync(dataPath)) hash.update(readFileSync(dataPath));
  const ssPath = getFixtureScreenshotPath(fixture);
  if (existsSync(ssPath)) hash.update(readFileSync(ssPath));
  return hash.digest("hex").slice(0, 12);
}

/** Validate that a parsed object has required RunResult numeric fields. */
function isValidRunResult(obj: unknown): obj is RunResult {
  if (!obj || typeof obj !== "object") return false;
  const r = obj as Record<string, unknown>;
  return (
    typeof r["similarity"] === "number" && Number.isFinite(r["similarity"]) &&
    typeof r["inputTokens"] === "number" && Number.isFinite(r["inputTokens"]) &&
    typeof r["outputTokens"] === "number" && Number.isFinite(r["outputTokens"]) &&
    typeof r["totalTokens"] === "number" && Number.isFinite(r["totalTokens"]) &&
    r["cacheKey"] !== undefined && typeof r["cacheKey"] === "object"
  );
}

function isCacheValid(fixture: string, type: string, runIndex: number, currentKey: CacheKey, fixtureHash: string): boolean {
  const runDir = getRunDir(fixture, type, runIndex);
  const resultPath = join(runDir, "result.json");
  if (!existsSync(resultPath)) return false;

  // Check all required artifacts exist
  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!existsSync(join(runDir, artifact))) return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(resultPath, "utf-8")) as unknown;
    if (!isValidRunResult(parsed)) return false;
    const result = parsed;
    const ck = result.cacheKey as CacheKey & { fixtureHash?: string };
    return (
      ck.model === currentKey.model &&
      ck.temperature === currentKey.temperature &&
      ck.maxTokens === currentKey.maxTokens &&
      ck.promptHash === currentKey.promptHash &&
      ck.configVersion === currentKey.configVersion &&
      ck.fixtureHash === fixtureHash
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
    .filter((block) => block.includes("<") && block.length > 50);

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

  // Call Claude API with retry on transient errors (429, 529)
  console.log(`    Calling Claude API (run ${runIndex + 1})...`);
  const MAX_RETRIES = 3;
  let response: Anthropic.Message | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: prompt,
        messages: [{ role: "user", content: designTree }],
      });
      break;
    } catch (err) {
      const status = (err as { status?: number }).status;
      if ((status === 429 || status === 529) && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
        console.warn(`    ⚠ ${status} error, retrying in ${delay / 1000}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  if (!response) throw new Error("API call failed after retries");

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

  // Clean up and sanitize HTML output
  const fontPath = resolve("assets/fonts/Inter.var.woff2");
  const localFontCSS = `@font-face { font-family: "Inter"; src: url("file://${fontPath}") format("woff2"); font-weight: 100 900; }`;
  let finalHtml = html;
  // Remove "// filename: ..." line if present at the start
  finalHtml = finalHtml.replace(/^\/\/\s*filename:.*\n/i, "");
  // Sanitize untrusted model HTML (rendered in Chromium via Playwright)
  finalHtml = finalHtml.replace(/<script[\s\S]*?<\/script>/gi, "");
  finalHtml = finalHtml.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");   // onclick="..." etc.
  finalHtml = finalHtml.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");   // onclick='...' etc.
  finalHtml = finalHtml.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  finalHtml = finalHtml.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
  // Remove Google Fonts <link> tags
  finalHtml = finalHtml.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, "");
  finalHtml = finalHtml.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, "");
  // Inject local @font-face at the start of <style> or before </head>
  if (finalHtml.includes("<style>")) {
    finalHtml = finalHtml.replace("<style>", `<style>\n${localFontCSS}\n`);
  } else if (finalHtml.includes("</head>")) {
    finalHtml = finalHtml.replace("</head>", `<style>${localFontCSS}</style>\n</head>`);
  }

  const htmlPath = join(runDir, "output.html");
  writeFileSync(htmlPath, finalHtml);
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

  // Copy Figma screenshot to run dir first (before any cropping)
  const figmaCopyPath = join(runDir, "figma.png");
  copyFileSync(figmaScreenshotPath, figmaCopyPath);

  // Crop both to matching dimensions for fair comparison
  const codeImage = PNG.sync.read(readFileSync(codePngPath));
  const figmaCopy = PNG.sync.read(readFileSync(figmaCopyPath));
  const cropW = Math.min(codeImage.width, figmaCopy.width);
  const cropH = Math.min(codeImage.height, figmaCopy.height);

  if (codeImage.width !== cropW || codeImage.height !== cropH) {
    const cropped = new PNG({ width: cropW, height: cropH });
    for (let y = 0; y < cropH; y++) {
      codeImage.data.copy(cropped.data, y * cropW * 4, y * codeImage.width * 4, y * codeImage.width * 4 + cropW * 4);
    }
    writeFileSync(codePngPath, PNG.sync.write(cropped));
    console.log(`    Cropped code.png: ${codeImage.width}x${codeImage.height} → ${cropW}x${cropH}`);
  }
  if (figmaCopy.width !== cropW || figmaCopy.height !== cropH) {
    const cropped = new PNG({ width: cropW, height: cropH });
    for (let y = 0; y < cropH; y++) {
      figmaCopy.data.copy(cropped.data, y * cropW * 4, y * figmaCopy.width * 4, y * figmaCopy.width * 4 + cropW * 4);
    }
    writeFileSync(figmaCopyPath, PNG.sync.write(cropped));
    console.log(`    Cropped figma.png: ${figmaCopy.width}x${figmaCopy.height} → ${cropW}x${cropH}`);
  }

  // Compare
  console.log(`    Comparing screenshots...`);
  const diffPath = join(runDir, "diff.png");
  const comparison = compareScreenshots(figmaCopyPath, codePngPath, diffPath);

  // Track how HTML was selected for debugging
  const htmlExtractMethod = html.match(/^<!doctype/i) ? "doctype" : html.match(/<body/i) ? "body" : html ? "largest" : "none";

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
    context: {
      screenshotPath: figmaScreenshotPath,
      logicalViewport: { width: logicalW, height: logicalH },
      exportScale,
      htmlExtractMethod,
      designTreeTokens: Math.ceil(designTree.length / 4),
    },
  };

  // Save result
  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));

  const interpDisplay = interpretationsParseFailed ? "PARSE_FAIL" : String(interpretations.length);
  console.log(`    ✓ similarity=${comparison.similarity.toFixed(1)}% interp=${interpDisplay} tokens=${result.totalTokens}`);

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
    // ΔT: positive = ablation used fewer tokens (good for efficiency)
    deltas.deltaT.push(baseline.totalTokens - r.totalTokens);
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

  // Sort: primary=ΔV, tie-break=ΔI, then ΔT
  rankings.sort((a, b) =>
    b.avgDeltaV - a.avgDeltaV
    || b.avgDeltaI - a.avgDeltaI
    || b.avgDeltaT - a.avgDeltaT
  );
  return rankings;
}

function printRankings(rankings: RankingEntry[]): void {
  console.log("\n=== ABLATION PHASE 1 RANKINGS ===\n");
  console.log("  Rank  Type                          avg ΔV      avg ΔI    avg ΔT");
  console.log("  ----  ----------------------------  ----------  --------  --------");
  let rank = 1;
  for (const r of rankings) {
    const dv = r.avgDeltaV.toFixed(2).padStart(8) + "%";
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
  if (fixtures.length === 0) {
    console.error("Error: No fixtures specified. Set ABLATION_FIXTURES or use defaults.");
    process.exit(1);
  }
  // Validate fixture names — prevent path traversal
  const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
  for (const f of fixtures) {
    if (!SAFE_NAME.test(f)) {
      console.error(`Error: Invalid fixture name "${f}". Only lowercase alphanumeric, hyphens, underscores allowed.`);
      process.exit(1);
    }
  }
  const rawRuns = process.env["ABLATION_RUNS"];
  let runsPerCondition = 1;
  if (rawRuns) {
    if (!/^\d+$/.test(rawRuns) || Number(rawRuns) < 1) {
      console.error(`Error: ABLATION_RUNS must be a positive integer (got: "${rawRuns}")`);
      process.exit(1);
    }
    runsPerCondition = Number(rawRuns);
  }

  const prompt = readFileSync(PROMPT_PATH, "utf-8");
  const promptHash = computePromptHash(prompt);
  const client = new Anthropic({ apiKey });

  mkdirSync(OUTPUT_DIR, { recursive: true });

  console.log(`Model: ${MODEL}`);
  console.log(`Fixtures: ${fixtures.join(", ")}`);
  console.log(`Runs per condition: ${runsPerCondition}`);
  console.log(`Prompt hash: ${promptHash}`);
  console.log(`Config version: ${CONFIG_VERSION}`);
  console.log("");

  const startedAt = new Date().toISOString();
  const allResults: RunResult[] = [];
  const newResults: RunResult[] = [];  // Only this session (for cost tracking)
  const skippedFixtures: Array<{ fixture: string; reason: string }> = [];
  let cacheHits = 0;

  for (const fixture of fixtures) {
    console.log(`\n=== ${fixture} ===\n`);

    // Validate fixture exists
    const fixturePath = resolve(`fixtures/${fixture}/data.json`);
    if (!existsSync(fixturePath)) {
      console.error(`  ERROR: Fixture not found: ${fixturePath}`);
      skippedFixtures.push({ fixture, reason: `data.json not found: ${fixturePath}` });
      continue;
    }

    const screenshotPath = getFixtureScreenshotPath(fixture);
    if (!existsSync(screenshotPath)) {
      console.error(`  ERROR: Screenshot not found: ${screenshotPath}`);
      skippedFixtures.push({ fixture, reason: `screenshot not found: ${screenshotPath}` });
      continue;
    }

    // Build per-fixture cache key (includes fixture data hash)
    const fixtureHash = computeFixtureHash(fixture);
    const cacheKey = buildCacheKey(prompt, fixtureHash);

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
        try {
          // Check cache with key + artifact validation
          if (isCacheValid(fixture, type, run, cacheKey, fixtureHash)) {
            const cached = JSON.parse(readFileSync(getResultPath(fixture, type, run), "utf-8")) as RunResult;
            allResults.push(cached);
            cacheHits++;
            console.log(`  [cached] ${type} run ${run + 1} → similarity=${cached.similarity.toFixed(1)}%`);
            continue;
          }

          console.log(`  [${type}] run ${run + 1}/${runsPerCondition}`);
          const tree = type === "baseline" ? baselineTree : stripDesignTree(baselineTree, type);
          const result = await runSingle(client, prompt, fixture, type, tree, run, cacheKey);
          allResults.push(result);
          newResults.push(result);
        } catch (err) {
          console.error(`  ERROR [${fixture}/${type}/run-${run}]: ${err instanceof Error ? err.message : String(err)}`);
          skippedFixtures.push({ fixture, reason: `${type}/run-${run} failed: ${err instanceof Error ? err.message : String(err)}` });
        }
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
    skippedFixtures,
    cacheStats: { hits: cacheHits, newCalls: newResults.length },
    parseFailureCount: allResults.filter((r) => r.interpretationsParseFailed).length,
    results: allResults,
    rankings,
  };

  writeFileSync(join(OUTPUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(`Summary saved to ${join(OUTPUT_DIR, "summary.json")}`);

  // Print cost estimate (Sonnet pricing: $3/MTok input, $15/MTok output)
  const sessionInputTokens = newResults.reduce((s, r) => s + r.inputTokens, 0);
  const sessionOutputTokens = newResults.reduce((s, r) => s + r.outputTokens, 0);
  const sessionCost = (sessionInputTokens * 3 / 1_000_000) + (sessionOutputTokens * 15 / 1_000_000);
  console.log(`\nThis session: ${newResults.length} new calls, ${cacheHits} cached`);
  console.log(`Session tokens: ${sessionInputTokens} input + ${sessionOutputTokens} output`);
  console.log(`Session cost: ~$${sessionCost.toFixed(2)}`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
