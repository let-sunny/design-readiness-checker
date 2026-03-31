/**
 * Ablation Phase 1: Strip experiments.
 *
 * For each selected strip type × N fixtures × M runs:
 *   Strip info from design-tree → implement via API → render → compare → record metrics
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-phase1.ts
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY, ABLATION_FIXTURES, ABLATION_TYPES, ABLATION_RUNS, ABLATION_BASELINE_ONLY
 *
 * Output: data/ablation/phase1/{config-version}/{fixture}/{type}/run-{n}/
 */

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { DESIGN_TREE_INFO_TYPES } from "../../core/design-tree/strip.js";
import type { DesignTreeInfoType } from "../../core/design-tree/strip.js";
import { extractHtml } from "../../core/comparison/html-utils.js";

import {
  PROMPT_PATH, callApi, getResponseText,
  getFixtureScreenshotPath, copyFixtureImages,
  parseFixtures, requireApiKey,
} from "./helpers.js";

// --- CLI helper ---

const CLI_PATH = resolve("dist/cli/index.js");

function execCli(command: string, args: string[]): string {
  return execFileSync(process.execPath, [CLI_PATH, command, ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "inherit"],
  });
}

// --- Config version ---

function computeConfigVersion(): string {
  const coreFiles = [
    resolve("src/core/design-tree/strip.ts"),
    resolve("src/core/design-tree/design-tree.ts"),
    resolve("src/core/comparison/visual-compare.ts"),
    resolve("src/core/comparison/visual-compare-helpers.ts"),
    resolve("src/core/comparison/html-utils.ts"),
    resolve("src/cli/commands/internal/html-postprocess.ts"),
    resolve("src/cli/commands/internal/code-metrics.ts"),
    resolve("src/core/adapters/figma-file-loader.ts"),
    resolve("src/experiments/ablation/helpers.ts"),
    PROMPT_PATH,
  ];
  const hash = createHash("sha256");
  for (const f of coreFiles) {
    if (existsSync(f)) hash.update(readFileSync(f, "utf-8"));
  }
  return hash.digest("hex").slice(0, 12);
}

const CONFIG_VERSION = computeConfigVersion();
const BASE_OUTPUT_DIR = resolve("data/ablation/phase1");

// --- Types ---

interface RunResult {
  fixture: string;
  type: "baseline" | DesignTreeInfoType;
  runIndex: number;
  similarity: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  htmlBytes: number;
  htmlLines: number;
  cssClassCount: number;
  cssVariableCount: number;
  timestamp: string;
  configVersion: string;
}

interface RankingEntry {
  type: DesignTreeInfoType;
  avgDeltaV: number;
  avgDeltaOutputTokens: number;
  avgDeltaHtmlBytes: number;
  avgDeltaCssClasses: number;
  avgDeltaCssVariables: number;
  fixtureCount: number;
  perFixture: Record<string, {
    deltaV: number; deltaOutputTokens: number; deltaHtmlBytes: number;
    deltaCssClasses: number; deltaCssVariables: number;
  }>;
}

// --- Cache ---

function getRunDir(fixture: string, type: string, runIndex: number): string {
  return join(BASE_OUTPUT_DIR, CONFIG_VERSION, fixture, type, `run-${runIndex}`);
}

const REQUIRED_ARTIFACTS = ["result.json", "output.html", "code.png", "figma.png", "diff.png"];

function isCacheValid(fixture: string, type: string, runIndex: number): boolean {
  const runDir = getRunDir(fixture, type, runIndex);
  for (const a of REQUIRED_ARTIFACTS) {
    if (!existsSync(join(runDir, a))) return false;
  }
  try {
    const r = JSON.parse(readFileSync(join(runDir, "result.json"), "utf-8")) as Record<string, unknown>;
    return typeof r["similarity"] === "number" && Number.isFinite(r["similarity"]);
  } catch { return false; }
}

// --- Single run ---

async function runSingle(
  client: Anthropic,
  prompt: string,
  fixture: string,
  type: "baseline" | DesignTreeInfoType,
  designTree: string,
  runIndex: number,
): Promise<RunResult> {
  const runDir = getRunDir(fixture, type, runIndex);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "design-tree.txt"), designTree);

  console.log(`    Calling Claude API (run ${runIndex + 1})...`);
  const response = await callApi(client, prompt, designTree);
  const responseText = getResponseText(response);
  writeFileSync(join(runDir, "response.txt"), responseText);

  // Step 3: Extract HTML from API response (Ablation-specific)
  const { html: rawHtml } = extractHtml(responseText);
  if (!rawHtml) console.warn("    WARNING: No HTML found in response");
  const htmlPath = join(runDir, "output.html");
  writeFileSync(htmlPath, rawHtml);
  copyFixtureImages(fixture, runDir);

  // Step 4: HTML post-processing (shared CLI)
  execCli("html-postprocess", [htmlPath]);

  // Step 5: Render + compare (shared CLI)
  console.log(`    Rendering + comparing...`);
  const figmaPath = getFixtureScreenshotPath(fixture);
  const compareJson = execCli("visual-compare", [htmlPath, "--figma-screenshot", figmaPath, "--output", runDir]);
  const comparison = JSON.parse(compareJson) as { similarity: number };

  // Step 6: Code metrics (shared CLI)
  const metricsJson = execCli("code-metrics", [htmlPath]);
  const metrics = JSON.parse(metricsJson) as { htmlBytes: number; htmlLines: number; cssClassCount: number; cssVariableCount: number };

  const result: RunResult = {
    fixture, type, runIndex,
    similarity: comparison.similarity,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    htmlBytes: metrics.htmlBytes,
    htmlLines: metrics.htmlLines,
    cssClassCount: metrics.cssClassCount,
    cssVariableCount: metrics.cssVariableCount,
    timestamp: new Date().toISOString(),
    configVersion: CONFIG_VERSION,
  };

  writeFileSync(join(runDir, "result.json"), JSON.stringify(result, null, 2));
  console.log(`    ✓ sim=${comparison.similarity.toFixed(1)}% out=${response.usage.output_tokens} html=${result.htmlBytes}B cls=${result.cssClassCount} vars=${result.cssVariableCount}`);
  return result;
}

// --- Rankings ---

function computeRankings(results: RunResult[]): RankingEntry[] {
  const baselineIndex = new Map<string, RunResult>();
  for (const r of results) {
    if (r.type === "baseline") baselineIndex.set(`${r.fixture}:${r.runIndex}`, r);
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  const deltas = new Map<DesignTreeInfoType, Map<string, {
    dV: number[]; dOT: number[]; dH: number[]; dC: number[]; dVa: number[];
  }>>();

  for (const r of results) {
    if (r.type === "baseline") continue;
    const b = baselineIndex.get(`${r.fixture}:${r.runIndex}`);
    if (!b) continue;
    const type = r.type as DesignTreeInfoType;
    if (!deltas.has(type)) deltas.set(type, new Map());
    const fd = deltas.get(type)!;
    if (!fd.has(r.fixture)) fd.set(r.fixture, { dV: [], dOT: [], dH: [], dC: [], dVa: [] });
    const d = fd.get(r.fixture)!;
    d.dV.push(b.similarity - r.similarity);
    d.dOT.push(r.outputTokens - b.outputTokens);
    d.dH.push(r.htmlBytes - b.htmlBytes);
    d.dC.push(r.cssClassCount - b.cssClassCount);
    d.dVa.push(r.cssVariableCount - b.cssVariableCount);
  }

  const rankings: RankingEntry[] = [];
  for (const [type, fixtures] of deltas) {
    const pf: RankingEntry["perFixture"] = {};
    let sV = 0, sOT = 0, sH = 0, sC = 0, sVa = 0, n = 0;
    for (const [fn, d] of fixtures) {
      const dv = avg(d.dV), dot = avg(d.dOT), dh = avg(d.dH), dc = avg(d.dC), dva = avg(d.dVa);
      pf[fn] = { deltaV: dv, deltaOutputTokens: dot, deltaHtmlBytes: dh, deltaCssClasses: dc, deltaCssVariables: dva };
      sV += dv; sOT += dot; sH += dh; sC += dc; sVa += dva; n++;
    }
    rankings.push({
      type,
      avgDeltaV: n > 0 ? sV / n : 0,
      avgDeltaOutputTokens: n > 0 ? sOT / n : 0,
      avgDeltaHtmlBytes: n > 0 ? sH / n : 0,
      avgDeltaCssClasses: n > 0 ? sC / n : 0,
      avgDeltaCssVariables: n > 0 ? sVa / n : 0,
      fixtureCount: n,
      perFixture: pf,
    });
  }
  rankings.sort((a, b) => b.avgDeltaV - a.avgDeltaV || b.avgDeltaOutputTokens - a.avgDeltaOutputTokens);
  return rankings;
}

function printRankings(rankings: RankingEntry[]): void {
  console.log("\n=== ABLATION RANKINGS ===\n");
  console.log("  Rank  Type                          ΔV%     ΔOutTok  ΔHTML(B)  ΔClass  ΔVars  N");
  console.log("  ----  ----------------------------  ------  -------  --------  ------  -----  -");
  let rank = 1;
  for (const r of rankings) {
    console.log(`  ${String(rank++).padStart(4)}  ${r.type.padEnd(28)}  ${r.avgDeltaV.toFixed(1).padStart(6)}%  ${((r.avgDeltaOutputTokens > 0 ? "+" : "") + r.avgDeltaOutputTokens.toFixed(0)).padStart(7)}  ${((r.avgDeltaHtmlBytes > 0 ? "+" : "") + r.avgDeltaHtmlBytes.toFixed(0)).padStart(8)}  ${((r.avgDeltaCssClasses > 0 ? "+" : "") + r.avgDeltaCssClasses.toFixed(0)).padStart(6)}  ${((r.avgDeltaCssVariables > 0 ? "+" : "") + r.avgDeltaCssVariables.toFixed(0)).padStart(5)}  ${r.fixtureCount}`);
  }
  console.log("");
}

// --- Main ---

async function main(): Promise<void> {
  const apiKey = requireApiKey();
  if (!existsSync(PROMPT_PATH)) { console.error(`Error: PROMPT.md not found at ${PROMPT_PATH}`); process.exit(1); }

  const fixtures = parseFixtures();
  const rawRuns = process.env["ABLATION_RUNS"];
  let runsPerCondition = 1;
  if (rawRuns) {
    if (!/^\d+$/.test(rawRuns) || Number(rawRuns) < 1) { console.error(`Error: ABLATION_RUNS invalid: "${rawRuns}"`); process.exit(1); }
    runsPerCondition = Number(rawRuns);
  }

  const requestedTypes: DesignTreeInfoType[] | null = process.env["ABLATION_TYPES"]
    ? (() => {
        const raw = process.env["ABLATION_TYPES"]!.split(",").map((s) => s.trim()).filter(Boolean);
        const valid = new Set<string>(DESIGN_TREE_INFO_TYPES);
        const invalid = raw.filter((t) => !valid.has(t));
        if (invalid.length > 0) {
          console.error(`Error: Invalid ABLATION_TYPES: ${invalid.join(", ")}`);
          console.error(`Valid types: ${DESIGN_TREE_INFO_TYPES.join(", ")}`);
          process.exit(1);
        }
        return raw as DesignTreeInfoType[];
      })()
    : null;

  const prompt = readFileSync(PROMPT_PATH, "utf-8");
  const client = new Anthropic({ apiKey });
  const outputDir = join(BASE_OUTPUT_DIR, CONFIG_VERSION);
  mkdirSync(outputDir, { recursive: true });

  console.log(`Config: ${CONFIG_VERSION} | Model: sonnet | Runs: ${runsPerCondition}`);
  console.log(`Fixtures: ${fixtures.join(", ")}`);
  const baselineOnly = process.env["ABLATION_BASELINE_ONLY"] === "true";
  console.log(`Types: ${baselineOnly ? "baseline only" : requestedTypes ? requestedTypes.join(", ") : "all"}\n`);

  const allResults: RunResult[] = [];
  const newResults: RunResult[] = [];
  let cacheHits = 0;

  for (const fixture of fixtures) {
    console.log(`\n=== ${fixture} ===\n`);
    const fixturePath = resolve(`fixtures/${fixture}`);
    if (!existsSync(join(fixturePath, "data.json"))) { console.error(`  SKIP: ${fixturePath}/data.json not found`); continue; }
    if (!existsSync(getFixtureScreenshotPath(fixture))) { console.error(`  SKIP: screenshot not found`); continue; }

    const typesToRun = requestedTypes ?? [...DESIGN_TREE_INFO_TYPES];
    let baselineTree = "";
    let strippedDir = "";
    try {
      // Step 1: Generate design tree (shared CLI)
      const fixtureOutputDir = join(BASE_OUTPUT_DIR, CONFIG_VERSION, fixture);
      mkdirSync(fixtureOutputDir, { recursive: true });
      const baselineTreePath = join(fixtureOutputDir, "design-tree.txt");
      execCli("design-tree", [fixturePath, "--output", baselineTreePath]);
      baselineTree = readFileSync(baselineTreePath, "utf-8");

      // Step 2: Strip design tree (shared CLI)
      strippedDir = join(fixtureOutputDir, "stripped");
      execCli("design-tree-strip", [baselineTreePath, "--output-dir", strippedDir, "--types", typesToRun.join(",")]);
    } catch (err) {
      console.error(`  SKIP [${fixture}]: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    // Detect no-op strips by comparing file content
    const skipTypes = new Set(typesToRun.filter((t) => {
      const strippedPath = join(strippedDir, `${t}.txt`);
      return existsSync(strippedPath) && readFileSync(strippedPath, "utf-8") === baselineTree;
    }));
    if (skipTypes.size > 0) console.log(`  Skipping no-op: ${[...skipTypes].join(", ")}`);

    const conditions: Array<"baseline" | DesignTreeInfoType> = baselineOnly
      ? ["baseline"]
      : ["baseline", ...typesToRun.filter((t) => !skipTypes.has(t))];

    for (const type of conditions) {
      for (let run = 0; run < runsPerCondition; run++) {
        try {
          if (isCacheValid(fixture, type, run)) {
            const cached = JSON.parse(readFileSync(join(getRunDir(fixture, type, run), "result.json"), "utf-8")) as RunResult;
            allResults.push(cached);
            cacheHits++;
            console.log(`  [cached] ${type} run ${run + 1} → sim=${cached.similarity.toFixed(1)}%`);
            continue;
          }
          console.log(`  [${type}] run ${run + 1}/${runsPerCondition}`);
          const tree = type === "baseline" ? baselineTree : readFileSync(join(strippedDir, `${type}.txt`), "utf-8");
          const result = await runSingle(client, prompt, fixture, type, tree, run);
          allResults.push(result);
          newResults.push(result);
        } catch (err) {
          console.error(`  ERROR [${fixture}/${type}/run-${run}]: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }

  const rankings = computeRankings(allResults);
  printRankings(rankings);

  writeFileSync(join(outputDir, "summary.json"), JSON.stringify({
    configVersion: CONFIG_VERSION, model: "sonnet", runsPerCondition,
    fixtures, results: allResults, rankings,
  }, null, 2));

  const si = newResults.reduce((s, r) => s + r.inputTokens, 0);
  const so = newResults.reduce((s, r) => s + r.outputTokens, 0);
  console.log(`Session: ${newResults.length} new, ${cacheHits} cached | Cost: ~$${((si * 3 + so * 15) / 1_000_000).toFixed(2)}`);
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
