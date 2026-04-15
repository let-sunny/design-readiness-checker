#!/usr/bin/env tsx

/**
 * Explicit calibration pipeline orchestrator.
 *
 * Replaces the delegated single-session orchestration
 * with step-by-step CLI + `claude -p` calls. Each step is tracked in
 * index.json for resume-from-failure support.
 *
 * Usage:
 *   npx tsx scripts/calibrate.ts <fixture-path>
 *   npx tsx scripts/calibrate.ts --all
 *   npx tsx scripts/calibrate.ts --resume <run-dir>
 *
 * See: ADR-008, issue #245
 */

import { execSync, spawn, type SpawnSyncReturns } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  copyFileSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { resolve, join, basename } from "node:path";
import { parseArgs } from "node:util";

import {
  CalibrationRunIndexSchema,
  createRunIndex,
  findResumePoint,
  STEP_NAMES,
  type CalibrationRunIndex,
  type StepRecord,
} from "../src/core/contracts/calibration-run.js";
import { extractFixtureName, createCalibrationRunDir, listActiveFixtures } from "../src/agents/run-directory.js";

// ---------------------------------------------------------------------------
// CLI binary resolution
// ---------------------------------------------------------------------------

/** Resolve the canicode CLI command. Uses node + dist path for local dev. */
const CANICODE_CLI = `node ${resolve("dist/cli/index.js")}`;

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    resume: { type: "string" },
    all: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage:
  npx tsx scripts/calibrate.ts <fixture-path>        # Single fixture
  npx tsx scripts/calibrate.ts --all                  # All active fixtures
  npx tsx scripts/calibrate.ts --resume <run-dir>     # Resume a failed run

Options:
  --all               Run calibration for all active fixtures sequentially
  --resume <run-dir>  Resume a failed run from the last incomplete step
  -h, --help          Show this help message`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Index.json helpers
// ---------------------------------------------------------------------------

function loadIndex(runDir: string): CalibrationRunIndex {
  const indexPath = join(runDir, "index.json");
  const raw: unknown = JSON.parse(readFileSync(indexPath, "utf-8"));
  return CalibrationRunIndexSchema.parse(raw);
}

function saveIndex(index: CalibrationRunIndex): void {
  index.updatedAt = new Date().toISOString();
  writeFileSync(join(index.runDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

function getStep(index: CalibrationRunIndex, name: string): StepRecord {
  const step = index.steps.find((s) => s.name === name);
  if (!step) throw new Error(`Step not found: ${name}`);
  return step;
}

function markRunning(index: CalibrationRunIndex, name: string): StepRecord {
  const step = getStep(index, name);
  step.status = "running";
  step.startedAt = new Date().toISOString();
  saveIndex(index);
  return step;
}

function markCompleted(
  index: CalibrationRunIndex,
  name: string,
  opts: { summary?: string; outputs?: string[] } = {},
): void {
  const step = getStep(index, name);
  const start = step.startedAt ? new Date(step.startedAt).getTime() : Date.now();
  step.status = "completed";
  step.completedAt = new Date().toISOString();
  step.durationMs = Date.now() - start;
  if (opts.summary) step.summary = opts.summary;
  if (opts.outputs) step.outputs = opts.outputs;
  saveIndex(index);
}

function markSkipped(index: CalibrationRunIndex, name: string, reason: string): void {
  const step = getStep(index, name);
  step.status = "skipped";
  step.summary = reason;
  saveIndex(index);
}

function markFailed(index: CalibrationRunIndex, name: string, error: string): void {
  const step = getStep(index, name);
  const start = step.startedAt ? new Date(step.startedAt).getTime() : Date.now();
  step.status = "failed";
  step.completedAt = new Date().toISOString();
  step.durationMs = Date.now() - start;
  step.error = error;
  step.retries++;
  index.status = "failed";
  saveIndex(index);
}

// ---------------------------------------------------------------------------
// Execution helpers
// ---------------------------------------------------------------------------

function runCli(command: string, label: string): string {
  console.log(`  [cli] ${label}`);
  try {
    return execSync(command, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
  } catch (err) {
    const execErr = err as SpawnSyncReturns<string>;
    const stderr = execErr.stderr ?? "";
    const stdout = execErr.stdout ?? "";
    throw new Error(`CLI failed: ${label}\n${stderr}\n${stdout}`.trim());
  }
}

function runAgent(agentName: string, prompt: string, label: string): string {
  console.log(`  [agent] ${label}`);
  try {
    return execSync(
      `claude -p --allowedTools "Bash,Read,Write,Glob,Edit,Grep"`,
      { input: prompt, encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, timeout: 600_000 },
    );
  } catch (err) {
    const execErr = err as SpawnSyncReturns<string>;
    const stderr = execErr.stderr ?? "";
    throw new Error(`Agent failed: ${agentName}\n${stderr}`.trim());
  }
}

/** Spawn a `claude -p` process and return its stdout as a promise. Prompt via stdin to avoid CLI arg parsing issues. */
function spawnAgent(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    const proc = spawn("claude", ["-p", "--allowedTools", "Bash,Read,Write,Glob,Edit,Grep"], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 600_000,
    });
    proc.stdin.write(prompt);
    proc.stdin.end();
    proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    proc.stderr.on("data", (chunk: Buffer) => errChunks.push(chunk));
    proc.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8");
      if (code !== 0) {
        const stderr = Buffer.concat(errChunks).toString("utf-8");
        reject(new Error(`Agent exited with code ${code}: ${stderr}`));
      } else {
        resolve(stdout);
      }
    });
    proc.on("error", reject);
  });
}

async function runAgentParallel(
  tasks: Array<{ name: string; prompt: string; label: string }>,
): Promise<Array<{ name: string; output: string; error?: string }>> {
  console.log(`  [agent] Running ${tasks.length} sessions in parallel`);

  const promises = tasks.map(async (task) => {
    console.log(`  [agent] Started: ${task.label}`);
    try {
      const output = await spawnAgent(task.prompt);
      console.log(`  [agent] Done: ${task.label}`);
      return { name: task.name, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  [agent] Failed: ${task.label} — ${msg.slice(0, 200)}`);
      return { name: task.name, output: "", error: msg };
    }
  });

  return Promise.all(promises);
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Read a JSON file and return parsed content. */
function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/** Estimate token count from text (rough: bytes / 4). */
function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, "utf-8") / 4);
}

// ---------------------------------------------------------------------------
// Strip types
// ---------------------------------------------------------------------------

const STRIP_TYPES = [
  "layout-direction-spacing",
  "size-constraints",
  "component-references",
  "node-names-hierarchy",
  "variable-references",
  "style-references",
] as const;

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

/** Run a single fixture from start to finish. Returns the run directory and whether it succeeded. */
async function runSingle(fixturePath: string): Promise<{ runDir: string; passed: boolean }> {
  const resolved = resolve(fixturePath);
  if (!existsSync(resolved)) {
    console.error(`Error: Fixture not found: ${resolved}`);
    return { runDir: "", passed: false };
  }
  const fixtureName = extractFixtureName(resolved);
  const runDir = createCalibrationRunDir(fixtureName);
  const index = createRunIndex(fixtureName, resolved, runDir);
  saveIndex(index);
  console.log(`Starting calibration for: ${fixtureName}`);
  console.log(`  Fixture: ${resolved}`);
  console.log(`  Run directory: ${runDir}`);

  try {
    await runPipeline(index);
    index.status = "completed";
    saveIndex(index);
    console.log("\nCalibration complete.");
    console.log(`  Run directory: ${runDir}`);
    return { runDir, passed: true };
  } catch (err) {
    console.error("\nCalibration failed:", err instanceof Error ? err.message : String(err));
    return { runDir, passed: false };
  }
}

// ---------------------------------------------------------------------------
// --all mode: run all active fixtures sequentially, then post-process
// ---------------------------------------------------------------------------

interface CompletedRun {
  fixturePath: string;
  runDir: string;
  passed: boolean;
}

async function runAll(): Promise<{ failed: number }> {
  const fixtures = listActiveFixtures("fixtures");
  if (fixtures.length === 0) {
    console.log("No active fixtures found. All may have converged (moved to fixtures/done/).");
    return { failed: 0 };
  }

  console.log(`Running calibration for ${fixtures.length} active fixture(s)...\n`);

  const completedRuns: CompletedRun[] = [];
  let passed = 0;
  let failed = 0;

  for (let i = 0; i < fixtures.length; i++) {
    const fixturePath = fixtures[i]!;
    const fixtureName = extractFixtureName(fixturePath);
    const idx = i + 1;

    console.log(`\n[${ idx }/${ fixtures.length }] ${fixturePath}`);
    const result = await runSingle(fixturePath);
    completedRuns.push({ fixturePath, runDir: result.runDir, passed: result.passed });

    if (result.passed) {
      passed++;

      // Convergence check: run fixture-done
      try {
        runCli(
          `${CANICODE_CLI} fixture-done ${shellEscape(fixturePath)} --run-dir ${shellEscape(result.runDir)}`,
          "fixture-done (convergence check)",
        );
        console.log(`  [${idx}/${fixtures.length}] ${fixtureName} — Complete (converged)`);
      } catch {
        // Not converged is expected — just log and continue
        // Extract applied count from debate.json for the summary
        const debatePath = join(result.runDir, "debate.json");
        let appliedInfo = "";
        if (existsSync(debatePath)) {
          try {
            const debate = readJson<Record<string, unknown>>(debatePath);
            const arb = debate["arbitrator"] as Record<string, unknown> | null;
            if (arb) {
              const decisions = arb["decisions"] as Array<Record<string, string>> | undefined;
              const appliedCount = decisions?.filter((d) => d["decision"]?.toLowerCase() === "applied" || d["decision"]?.toLowerCase() === "revised").length ?? 0;
              appliedInfo = `applied=${appliedCount}`;
            }
          } catch { /* ignore parse errors */ }
        }
        console.log(`  [${idx}/${fixtures.length}] ${fixtureName} — Complete (${appliedInfo || "not converged"})`);
      }
    } else {
      failed++;
      console.log(`  [${idx}/${fixtures.length}] ${fixtureName} — Failed`);
    }
  }

  // --- Regression check ---
  console.log("\nRegression check...");
  const successfulRuns = completedRuns.filter((r) => r.passed && r.runDir);
  for (const run of successfulRuns) {
    try {
      runCli(
        `${CANICODE_CLI} calibrate-evaluate _ _ --run-dir ${shellEscape(run.runDir)}`,
        `calibrate-evaluate (regression: ${extractFixtureName(run.fixturePath)})`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  Warning: Regression check failed for ${extractFixtureName(run.fixturePath)}: ${msg.slice(0, 200)}`);
    }
  }

  // --- Build and generate aggregate report ---
  console.log("\nGenerating aggregate report...");
  try {
    runCli("pnpm build", "pnpm build");
    runCli(
      `${CANICODE_CLI} calibrate-gap-report --output logs/calibration/REPORT.md`,
      "calibrate-gap-report",
    );
    console.log("  Report: logs/calibration/REPORT.md");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`  Warning: Report generation failed: ${msg.slice(0, 200)}`);
  }

  // --- Summary ---
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Calibration summary: ${passed} passed, ${failed} failed out of ${fixtures.length} fixtures`);
  for (const run of completedRuns) {
    const name = extractFixtureName(run.fixturePath);
    console.log(`  ${run.passed ? "✓" : "✗"} ${name}`);
  }

  return { failed };
}

async function main(): Promise<void> {
  if (values.all) {
    // --all mode: run all active fixtures
    try {
      const { failed } = await runAll();
      if (failed > 0) {
        process.exitCode = 1;
      }
    } catch (err) {
      console.error("Fatal:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

  if (values.resume) {
    // Resume existing run
    const runDir = resolve(values.resume);
    if (!existsSync(join(runDir, "index.json"))) {
      console.error(`Error: No index.json found in ${runDir}`);
      process.exit(1);
    }
    const index = loadIndex(runDir);
    const resumeFrom = findResumePoint(index);
    if (!resumeFrom) {
      console.log("All steps completed. Nothing to resume.");
      return;
    }
    index.status = "running";
    saveIndex(index);
    console.log(`Resuming calibration from step: ${resumeFrom}`);
    console.log(`  Run directory: ${runDir}`);

    try {
      await runPipeline(index);
      index.status = "completed";
      saveIndex(index);
      console.log("\nCalibration complete.");
      console.log(`  Run directory: ${runDir}`);
    } catch (err) {
      console.error("\nCalibration failed:", err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
    return;
  }

  // Single fixture mode
  const fixturePath = positionals[0];
  if (!fixturePath) {
    console.error(`Error: No fixture path or --all flag provided.

Usage:
  npx tsx scripts/calibrate.ts <fixture-path>        # Single fixture
  npx tsx scripts/calibrate.ts --all                  # All active fixtures
  npx tsx scripts/calibrate.ts --resume <run-dir>     # Resume a failed run`);
    process.exit(1);
  }

  const result = await runSingle(fixturePath);
  if (!result.passed) {
    process.exitCode = 1;
  }
}

async function runPipeline(index: CalibrationRunIndex): Promise<void> {
  const { runDir, fixturePath } = index;
  const resumeFrom = findResumePoint(index);
  if (!resumeFrom) return;

  // Helper: should we run this step?
  const shouldRun = (name: string): boolean => {
    const step = getStep(index, name);
    return step.status !== "completed" && step.status !== "skipped";
  };

  // ─── Step 1: Analyze ────────────────────────────────────────────────
  if (shouldRun(STEP_NAMES.ANALYZE)) {
    markRunning(index, STEP_NAMES.ANALYZE);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-analyze ${shellEscape(fixturePath)} --run-dir ${shellEscape(runDir)}`,
        "calibrate-analyze",
      );
      const analysis = readJson<Record<string, unknown>>(join(runDir, "analysis.json"));
      const issueCount = analysis["issueCount"] as number;
      const tier = analysis["calibrationTier"] as string;
      const grade = (analysis["scoreReport"] as Record<string, Record<string, unknown>>)?.["overall"]?.["grade"] ?? "?";
      const pct = (analysis["scoreReport"] as Record<string, Record<string, unknown>>)?.["overall"]?.["percentage"] ?? "?";

      markCompleted(index, STEP_NAMES.ANALYZE, {
        summary: `issues=${issueCount} grade=${grade} (${pct}%) tier=${tier}`,
        outputs: ["analysis.json"],
      });

      if (issueCount === 0) {
        console.log("  No issues found — calibration not needed.");
        // Skip remaining steps
        for (const step of index.steps) {
          if (step.status === "pending") {
            step.status = "skipped";
            step.summary = "No issues — calibration not needed";
          }
        }
        return;
      }
    } catch (err) {
      markFailed(index, STEP_NAMES.ANALYZE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 2: Generate design tree ───────────────────────────────────
  if (shouldRun(STEP_NAMES.DESIGN_TREE)) {
    markRunning(index, STEP_NAMES.DESIGN_TREE);
    try {
      runCli(
        `${CANICODE_CLI} design-tree ${shellEscape(fixturePath)} --output ${shellEscape(join(runDir, "design-tree.txt"))}`,
        "design-tree",
      );
      markCompleted(index, STEP_NAMES.DESIGN_TREE, {
        summary: "Design tree generated",
        outputs: ["design-tree.txt"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.DESIGN_TREE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // Copy fixture screenshot to run directory
  // Fixtures use either screenshot.png or screenshot-<width>.png (smallest = base)
  const screenshotDest = join(runDir, "figma.png");
  if (!existsSync(screenshotDest)) {
    const baseScreenshot = findBaseScreenshot(fixturePath);
    if (baseScreenshot) {
      copyFileSync(baseScreenshot, screenshotDest);
    }
  }

  // ─── Step 3: Strip design trees ─────────────────────────────────────
  if (shouldRun(STEP_NAMES.STRIP_DESIGN_TREE)) {
    markRunning(index, STEP_NAMES.STRIP_DESIGN_TREE);
    try {
      const strippedDir = join(runDir, "stripped");
      mkdirSync(strippedDir, { recursive: true });
      runCli(
        `${CANICODE_CLI} design-tree-strip ${shellEscape(join(runDir, "design-tree.txt"))} --output-dir ${shellEscape(strippedDir)}`,
        "design-tree-strip",
      );
      markCompleted(index, STEP_NAMES.STRIP_DESIGN_TREE, {
        summary: `${STRIP_TYPES.length} strip variants generated`,
        outputs: STRIP_TYPES.map((t) => `stripped/${t}.txt`),
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.STRIP_DESIGN_TREE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 4: Convert (agent — 7 parallel sessions) ──────────────────
  if (shouldRun(STEP_NAMES.CONVERT)) {
    markRunning(index, STEP_NAMES.CONVERT);
    try {
      const analysis = readJson<Record<string, unknown>>(join(runDir, "analysis.json"));
      const fileKey = analysis["fileKey"] as string;
      // Determine root node ID from analysis summaries
      const summaries = analysis["nodeIssueSummaries"] as Array<Record<string, string>> | undefined;
      const rootNodeId = summaries?.[0]?.["nodeId"] ?? "root";

      const agentDef = readFileSync(resolve(".claude/agents/calibration/converter.md"), "utf-8");

      // Build parallel tasks: 1 baseline + 6 strips
      const tasks: Array<{ name: string; prompt: string; label: string }> = [];

      // Baseline converter: full assessment + output.html
      tasks.push({
        name: "baseline",
        label: "Converter (baseline)",
        prompt: `${agentDef}

## Context (injected by orchestration script)

Run directory: ${runDir}
Fixture directory: ${fixturePath}
fileKey: ${fileKey}
Root nodeId: ${rootNodeId}

This is the BASELINE session. Your job:
1. Read ${join(runDir, "design-tree.txt")}
2. Implement the design as a single standalone HTML+CSS page
3. Save to ${join(runDir, "output.html")}
4. Write converter-assessment.json with ruleImpactAssessment + uncoveredStruggles

Do NOT implement stripped variants — other sessions handle those.
Do NOT run visual-compare, html-postprocess, or code-metrics.`,
      });

      // Strip converter sessions: one per strip type
      for (const stripType of STRIP_TYPES) {
        tasks.push({
          name: stripType,
          label: `Converter (${stripType})`,
          prompt: `${agentDef}

## Context (injected by orchestration script)

Run directory: ${runDir}
Fixture directory: ${fixturePath}
fileKey: ${fileKey}
Root nodeId: ${rootNodeId}

This is a STRIP ABLATION session for type: ${stripType}
1. Read ${join(runDir, "stripped", `${stripType}.txt`)}
2. Implement the stripped design-tree as a single standalone HTML+CSS page
3. Save to ${join(runDir, "stripped", `${stripType}.html`)}

Do NOT write converter-assessment.json — the baseline session handles that.
Do NOT implement other strip types or the baseline.
Do NOT run visual-compare, html-postprocess, or code-metrics.`,
        });
      }

      // Run all 7 sessions in parallel
      const results = await runAgentParallel(tasks);
      const failures = results.filter((r) => r.error);
      if (failures.length > 0) {
        console.warn(`  Warning: ${failures.length} converter session(s) failed: ${failures.map((f) => f.name).join(", ")}`);
      }

      // Verify outputs — baseline + assessment are required
      const requiredFiles = [
        join(runDir, "output.html"),
        join(runDir, "converter-assessment.json"),
      ];
      const missingRequired = requiredFiles.filter((f) => !existsSync(f));
      if (missingRequired.length > 0) {
        throw new Error(`Required converter outputs missing: ${missingRequired.map((f) => basename(f)).join(", ")}. ${failures.length}/${results.length} sessions failed.`);
      }

      const expectedFiles = [
        ...requiredFiles,
        ...STRIP_TYPES.map((t) => join(runDir, "stripped", `${t}.html`)),
      ];
      const missing = expectedFiles.filter((f) => !existsSync(f));
      if (missing.length > 0) {
        console.warn(`  Warning: Missing strip outputs: ${missing.map((f) => basename(f)).join(", ")}`);
      }

      markCompleted(index, STEP_NAMES.CONVERT, {
        summary: `${results.length - failures.length}/${results.length} sessions ok, missing=${missing.length}`,
        outputs: expectedFiles.filter((f) => existsSync(f)).map((f) => f.replace(runDir + "/", "")),
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.CONVERT, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 5: Measure (CLI — no LLM) ────────────────────────────────
  if (shouldRun(STEP_NAMES.MEASURE)) {
    markRunning(index, STEP_NAMES.MEASURE);
    try {
      const measurements = runMeasurements(runDir, fixturePath);
      markCompleted(index, STEP_NAMES.MEASURE, {
        summary: `similarity=${measurements.similarity}% strips=${measurements.stripsOk}/${STRIP_TYPES.length}`,
        outputs: ["conversion.json"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.MEASURE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 6: Gap Analyze (agent, conditional) ───────────────────────
  const analysis = readJson<Record<string, unknown>>(join(runDir, "analysis.json"));
  const calibrationTier = analysis["calibrationTier"] as string;

  if (shouldRun(STEP_NAMES.GAP_ANALYZE)) {
    if (calibrationTier !== "full" || !existsSync(join(runDir, "figma.png"))) {
      markSkipped(index, STEP_NAMES.GAP_ANALYZE,
        calibrationTier !== "full"
          ? `tier=${calibrationTier}, gap analysis only for full tier`
          : "figma.png not found");
    } else {
      markRunning(index, STEP_NAMES.GAP_ANALYZE);
      try {
        const agentDef = readFileSync(resolve(".claude/agents/calibration/gap-analyzer.md"), "utf-8");
        const conversion = readJson<Record<string, unknown>>(join(runDir, "conversion.json"));
        const similarity = conversion["similarity"] as number;

        // Load Converter interpretations for gap classification
        const assessment = readJson<Record<string, unknown>>(join(runDir, "converter-assessment.json"));
        const interpretations = Array.isArray(assessment["interpretations"])
          ? (assessment["interpretations"] as string[]).join("\n- ")
          : "none";

        const gapPrompt = `${agentDef}

## Context (injected by orchestration script)

Run directory: ${runDir}
Figma screenshot: ${join(runDir, "figma.png")}
Code screenshot: ${join(runDir, "code.png")}
Diff image: ${join(runDir, "diff.png")}
Similarity: ${similarity}%
HTML path: ${join(runDir, "output.html")}
Fixture: ${fixturePath}
Analysis: ${join(runDir, "analysis.json")}

### Converter interpretations (values that were guessed, not from data)
- ${interpretations}

Return the gap analysis as JSON. Do NOT write any files — print the JSON to stdout.`;

        const gapOutput = runAgent("calibration-gap-analyzer", gapPrompt, "Gap Analyzer");

        // Extract JSON from agent output — fail if not found
        const gapJson = gapOutput.match(/\{[\s\S]*\}/);
        if (!gapJson) {
          throw new Error("Gap Analyzer returned no JSON. Raw output saved to gaps-raw.txt");
        }
        writeFileSync(join(runDir, "gaps.json"), gapJson[0] + "\n");

        markCompleted(index, STEP_NAMES.GAP_ANALYZE, {
          summary: "Gap analysis complete",
          outputs: ["gaps.json"],
        });
      } catch (err) {
        markFailed(index, STEP_NAMES.GAP_ANALYZE, err instanceof Error ? err.message : String(err));
        throw err;
      }
    }
  }

  // ─── Step 7: Evaluate (CLI) ─────────────────────────────────────────
  if (shouldRun(STEP_NAMES.EVALUATE)) {
    markRunning(index, STEP_NAMES.EVALUATE);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-evaluate _ _ --run-dir ${shellEscape(runDir)}`,
        "calibrate-evaluate",
      );

      // Check if proposals exist
      const proposedPath = join(runDir, "proposed-rules.json");
      const hasProposals = existsSync(proposedPath);
      const proposalCount = hasProposals
        ? (readJson<string[]>(proposedPath)).length
        : 0;

      markCompleted(index, STEP_NAMES.EVALUATE, {
        summary: `proposals=${proposalCount}`,
        outputs: ["summary.md", ...(hasProposals ? ["proposed-rules.json"] : [])],
      });

      if (proposalCount === 0) {
        // Write skip debate.json and skip remaining debate steps
        writeFileSync(
          join(runDir, "debate.json"),
          JSON.stringify({ critic: null, arbitrator: null, skipped: "zero proposals from evaluation" }, null, 2) + "\n",
        );
        markSkipped(index, STEP_NAMES.GATHER_EVIDENCE, "No proposals");
        markSkipped(index, STEP_NAMES.CRITIC, "No proposals");
        markSkipped(index, STEP_NAMES.FINALIZE_DEBATE, "No proposals");
        markSkipped(index, STEP_NAMES.ARBITRATOR, "No proposals");
        markSkipped(index, STEP_NAMES.ENRICH_EVIDENCE, "No proposals");
        markSkipped(index, STEP_NAMES.PRUNE_EVIDENCE, "No proposals");
      }
    } catch (err) {
      markFailed(index, STEP_NAMES.EVALUATE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 8: Gather Evidence (CLI) ──────────────────────────────────
  if (shouldRun(STEP_NAMES.GATHER_EVIDENCE)) {
    markRunning(index, STEP_NAMES.GATHER_EVIDENCE);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-gather-evidence ${shellEscape(runDir)}`,
        "calibrate-gather-evidence",
      );
      markCompleted(index, STEP_NAMES.GATHER_EVIDENCE, {
        summary: "Evidence gathered",
        outputs: ["critic-evidence.json"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.GATHER_EVIDENCE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 9: Critic (agent) ─────────────────────────────────────────
  if (shouldRun(STEP_NAMES.CRITIC)) {
    markRunning(index, STEP_NAMES.CRITIC);
    try {
      const agentDef = readFileSync(resolve(".claude/agents/calibration/critic.md"), "utf-8");
      const summary = readFileSync(join(runDir, "summary.md"), "utf-8");
      const evidence = readFileSync(join(runDir, "critic-evidence.json"), "utf-8");
      const conversion = readJson<Record<string, unknown>>(join(runDir, "conversion.json"));
      const stripDeltas = JSON.stringify(conversion["stripDeltas"] ?? []);

      const criticPrompt = `${agentDef}

## Context (injected by orchestration script)

Run directory: ${runDir}

### Proposals (from summary.md)
${summary}

### Evidence (from critic-evidence.json)
${evidence}

### Strip Deltas
${stripDeltas}

Return your critique as JSON. Do NOT write any files — print the JSON to stdout.`;

      const criticOutput = runAgent("calibration-critic", criticPrompt, "Critic");

      // Extract JSON and write debate.json — fail if not found
      const criticJson = criticOutput.match(/\{[\s\S]*\}/);
      if (!criticJson) {
        throw new Error("Critic returned no JSON");
      }
      const criticData = JSON.parse(criticJson[0]) as Record<string, unknown>;
      writeFileSync(
        join(runDir, "debate.json"),
        JSON.stringify({ critic: criticData }, null, 2) + "\n",
      );

      markCompleted(index, STEP_NAMES.CRITIC, {
        summary: "Critic review complete",
        outputs: ["debate.json"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.CRITIC, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 10: Finalize Debate — early-stop check (CLI) ─────────────
  let earlyStop = false;
  if (shouldRun(STEP_NAMES.FINALIZE_DEBATE)) {
    markRunning(index, STEP_NAMES.FINALIZE_DEBATE);
    try {
      const output = runCli(
        `${CANICODE_CLI} calibrate-finalize-debate ${shellEscape(runDir)}`,
        "calibrate-finalize-debate (early-stop check)",
      );
      const result = JSON.parse(output.trim()) as { action: string; stoppingReason?: string };
      earlyStop = result.action === "early-stop";

      if (earlyStop) {
        markCompleted(index, STEP_NAMES.FINALIZE_DEBATE, {
          summary: `early-stop: ${result.stoppingReason}`,
        });
        markSkipped(index, STEP_NAMES.ARBITRATOR, `early-stop: ${result.stoppingReason}`);
      } else {
        markCompleted(index, STEP_NAMES.FINALIZE_DEBATE, { summary: "continue" });
      }
    } catch (err) {
      markFailed(index, STEP_NAMES.FINALIZE_DEBATE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 11: Arbitrator (agent) ────────────────────────────────────
  if (shouldRun(STEP_NAMES.ARBITRATOR)) {
    markRunning(index, STEP_NAMES.ARBITRATOR);
    try {
      const agentDef = readFileSync(resolve(".claude/agents/calibration/arbitrator.md"), "utf-8");
      const debate = readFileSync(join(runDir, "debate.json"), "utf-8");

      const arbitratorPrompt = `${agentDef}

## Context (injected by orchestration script)

Run directory: ${runDir}
Fixture: ${fixturePath}

### Debate (proposals + critic reviews)
${debate}

Return your decisions as JSON. Only edit rule-config.ts if applying changes. Do NOT write to logs.`;

      const arbOutput = runAgent("calibration-arbitrator", arbitratorPrompt, "Arbitrator");

      // Extract JSON and update debate.json — fail if not found
      const arbJson = arbOutput.match(/\{[\s\S]*\}/);
      if (!arbJson) {
        throw new Error("Arbitrator returned no JSON");
      }
      const arbData = JSON.parse(arbJson[0]) as Record<string, unknown>;
      const debateData = readJson<Record<string, unknown>>(join(runDir, "debate.json"));
      debateData["arbitrator"] = arbData;
      writeFileSync(join(runDir, "debate.json"), JSON.stringify(debateData, null, 2) + "\n");

      // Finalize debate after arbitrator
      runCli(
        `${CANICODE_CLI} calibrate-finalize-debate ${shellEscape(runDir)}`,
        "calibrate-finalize-debate (post-arbitrator)",
      );

      markCompleted(index, STEP_NAMES.ARBITRATOR, {
        summary: "Arbitrator decisions applied",
        outputs: ["debate.json"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.ARBITRATOR, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 12: Enrich Evidence (CLI) ─────────────────────────────────
  if (shouldRun(STEP_NAMES.ENRICH_EVIDENCE)) {
    markRunning(index, STEP_NAMES.ENRICH_EVIDENCE);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-enrich-evidence ${shellEscape(runDir)}`,
        "calibrate-enrich-evidence",
      );
      markCompleted(index, STEP_NAMES.ENRICH_EVIDENCE, { summary: "Evidence enriched" });
    } catch (err) {
      markFailed(index, STEP_NAMES.ENRICH_EVIDENCE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 13: Prune Evidence (CLI) ──────────────────────────────────
  if (shouldRun(STEP_NAMES.PRUNE_EVIDENCE)) {
    markRunning(index, STEP_NAMES.PRUNE_EVIDENCE);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-prune-evidence ${shellEscape(runDir)}`,
        "calibrate-prune-evidence",
      );
      markCompleted(index, STEP_NAMES.PRUNE_EVIDENCE, { summary: "Evidence pruned" });
    } catch (err) {
      markFailed(index, STEP_NAMES.PRUNE_EVIDENCE, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 14: Gap Report (CLI) ──────────────────────────────────────
  if (shouldRun(STEP_NAMES.GAP_REPORT)) {
    markRunning(index, STEP_NAMES.GAP_REPORT);
    try {
      runCli(
        `${CANICODE_CLI} calibrate-gap-report --output logs/calibration/REPORT.md`,
        "calibrate-gap-report",
      );
      markCompleted(index, STEP_NAMES.GAP_REPORT, {
        summary: "Report generated",
        outputs: ["logs/calibration/REPORT.md"],
      });
    } catch (err) {
      markFailed(index, STEP_NAMES.GAP_REPORT, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Measurement pipeline (Step 5)
// ---------------------------------------------------------------------------

interface MeasurementResult {
  similarity: number;
  stripsOk: number;
}

function runMeasurements(runDir: string, fixturePath: string): MeasurementResult {
  const outputHtml = join(runDir, "output.html");
  const figmaPng = join(runDir, "figma.png");

  // Post-process baseline HTML
  runCli(`${CANICODE_CLI} html-postprocess ${shellEscape(outputHtml)}`, "html-postprocess (baseline)");

  // Baseline visual comparison
  const vcOutput = runCli(
    `${CANICODE_CLI} visual-compare ${shellEscape(outputHtml)} --figma-screenshot ${shellEscape(figmaPng)} --output ${shellEscape(runDir)}`,
    "visual-compare (baseline)",
  );
  const vcJson = parseJsonFromOutput(vcOutput);
  const similarity = (vcJson?.["similarity"] as number) ?? 0;

  // Baseline code metrics
  const cmOutput = runCli(
    `${CANICODE_CLI} code-metrics ${shellEscape(outputHtml)}`,
    "code-metrics (baseline)",
  );
  const cmJson = parseJsonFromOutput(cmOutput);

  // Responsive comparison (if expanded screenshot exists)
  let responsiveSimilarity: number | null = null;
  let responsiveDelta: number | null = null;
  let responsiveViewport: number | null = null;

  const expandedScreenshots = findExpandedScreenshots(fixturePath);
  if (expandedScreenshots) {
    const rvOutput = runCli(
      `${CANICODE_CLI} visual-compare ${shellEscape(outputHtml)} --figma-screenshot ${shellEscape(expandedScreenshots.path)} --width ${expandedScreenshots.width} --expand-root --output ${shellEscape(join(runDir, "responsive"))}`,
      "visual-compare (responsive)",
    );
    const rvJson = parseJsonFromOutput(rvOutput);
    responsiveSimilarity = (rvJson?.["similarity"] as number) ?? null;
    responsiveViewport = expandedScreenshots.width;
    if (responsiveSimilarity !== null) {
      responsiveDelta = similarity - responsiveSimilarity;
    }
  }

  // Strip measurements
  const stripDeltas: Array<Record<string, unknown>> = [];
  let stripsOk = 0;

  const baselineTokens = estimateTokens(readFileSync(join(runDir, "design-tree.txt"), "utf-8"));

  for (const stripType of STRIP_TYPES) {
    const stripHtml = join(runDir, "stripped", `${stripType}.html`);
    if (!existsSync(stripHtml)) {
      console.warn(`  Warning: Missing strip HTML: ${stripType}.html`);
      continue;
    }

    // Post-process
    runCli(`${CANICODE_CLI} html-postprocess ${shellEscape(stripHtml)}`, `html-postprocess (${stripType})`);

    // Visual compare
    const stripVcOutput = runCli(
      `${CANICODE_CLI} visual-compare ${shellEscape(stripHtml)} --figma-screenshot ${shellEscape(figmaPng)} --output ${shellEscape(join(runDir, "stripped", stripType))}`,
      `visual-compare (${stripType})`,
    );
    const stripVcJson = parseJsonFromOutput(stripVcOutput);
    const strippedSimilarity = (stripVcJson?.["similarity"] as number) ?? 0;

    // Code metrics
    const stripCmOutput = runCli(
      `${CANICODE_CLI} code-metrics ${shellEscape(stripHtml)}`,
      `code-metrics (${stripType})`,
    );
    const stripCmJson = parseJsonFromOutput(stripCmOutput);

    // Input tokens for stripped design tree
    const strippedTreePath = join(runDir, "stripped", `${stripType}.txt`);
    const strippedTokens = existsSync(strippedTreePath)
      ? estimateTokens(readFileSync(strippedTreePath, "utf-8"))
      : null;

    const delta = similarity - strippedSimilarity;

    // Responsive for size-constraints strip
    let stripResponseDelta: number | null = null;
    if (stripType === "size-constraints" && expandedScreenshots) {
      const stripRvOutput = runCli(
        `${CANICODE_CLI} visual-compare ${shellEscape(stripHtml)} --figma-screenshot ${shellEscape(expandedScreenshots.path)} --width ${expandedScreenshots.width} --expand-root --output ${shellEscape(join(runDir, "stripped", "size-constraints-responsive"))}`,
        "visual-compare (size-constraints responsive)",
      );
      const stripRvJson = parseJsonFromOutput(stripRvOutput);
      const stripRespSim = (stripRvJson?.["similarity"] as number) ?? null;
      if (stripRespSim !== null && responsiveSimilarity !== null) {
        stripResponseDelta = responsiveSimilarity - stripRespSim;
      }
    }

    stripDeltas.push({
      stripType,
      baselineSimilarity: similarity,
      strippedSimilarity,
      delta,
      deltaDifficulty: computeDeltaDifficulty(stripType, delta, stripResponseDelta, baselineTokens, strippedTokens),
      responsiveDelta: stripResponseDelta,
      baselineInputTokens: baselineTokens,
      strippedInputTokens: strippedTokens,
      htmlMetrics: stripCmJson,
    });
    stripsOk++;
  }

  // Load converter assessment
  const assessmentPath = join(runDir, "converter-assessment.json");
  const assessment = existsSync(assessmentPath)
    ? readJson<Record<string, unknown>>(assessmentPath)
    : {};

  // Assemble conversion.json
  const conversionData = {
    rootNodeId: assessment["rootNodeId"] ?? "root",
    similarity,
    difficulty: similarityToDifficulty(similarity),
    responsiveSimilarity,
    responsiveDelta,
    responsiveViewport,
    htmlBytes: cmJson?.["htmlBytes"] ?? null,
    htmlLines: cmJson?.["htmlLines"] ?? null,
    cssClassCount: cmJson?.["cssClassCount"] ?? null,
    cssVariableCount: cmJson?.["cssVariableCount"] ?? null,
    ruleImpactAssessment: assessment["ruleImpactAssessment"] ?? [],
    uncoveredStruggles: assessment["uncoveredStruggles"] ?? [],
    stripDeltas,
  };
  writeFileSync(join(runDir, "conversion.json"), JSON.stringify(conversionData, null, 2) + "\n");

  return { similarity, stripsOk };
}

// ---------------------------------------------------------------------------
// Measurement helpers
// ---------------------------------------------------------------------------

function parseJsonFromOutput(output: string): Record<string, unknown> | null {
  // CLI commands print JSON to stdout; find the last JSON object in output
  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (line.startsWith("{")) {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch { /* try previous line */ }
    }
  }
  // Try finding any JSON object in the full output
  const match = output.match(/\{[^{}]*\}/g);
  if (match) {
    for (let i = match.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(match[i]!) as Record<string, unknown>;
      } catch { /* continue */ }
    }
  }
  return null;
}

/**
 * Find the base screenshot for a fixture.
 * Prefers screenshot.png, falls back to smallest screenshot-<width>.png.
 */
function findBaseScreenshot(fixturePath: string): string | null {
  const plain = join(fixturePath, "screenshot.png");
  if (existsSync(plain)) return plain;

  const numbered = existsSync(fixturePath)
    ? readdirSync(fixturePath).filter((f) => /^screenshot-\d+\.png$/.test(f))
    : [];
  if (numbered.length === 0) return null;

  const parsed = numbered
    .map((f) => {
      const match = f.match(/screenshot-(\d+)\.png$/);
      return { file: f, width: match ? parseInt(match[1]!, 10) : 0 };
    })
    .filter((p) => p.width > 0);
  parsed.sort((a, b) => a.width - b.width);

  const smallest = parsed[0];
  return smallest ? join(fixturePath, smallest.file) : null;
}

function findExpandedScreenshots(fixturePath: string): { path: string; width: number } | null {
  const files = existsSync(fixturePath)
    ? readdirSync(fixturePath).filter((f) => /^screenshot-\d+\.png$/.test(f))
    : [];
  if (files.length < 2) return null;

  const parsed = files.map((f) => {
    const match = f.match(/screenshot-(\d+)\.png$/);
    return { file: f, width: match ? parseInt(match[1]!, 10) : 0 };
  }).filter((p) => p.width > 0);
  parsed.sort((a, b) => a.width - b.width);

  const largest = parsed[parsed.length - 1];
  if (!largest) return null;
  return { path: join(fixturePath, largest.file), width: largest.width };
}

/** Similarity → difficulty mapping (matches calibration-compute.ts thresholds) */
function similarityToDifficulty(similarity: number): string {
  if (similarity >= 90) return "easy";
  if (similarity >= 70) return "moderate";
  if (similarity >= 50) return "hard";
  return "failed";
}

/** Strip delta → difficulty (matches evaluation-agent.ts logic) */
function stripDeltaToDifficulty(delta: number): string {
  if (delta <= 5) return "easy";
  if (delta <= 15) return "moderate";
  if (delta <= 30) return "hard";
  return "failed";
}

/** Token delta → difficulty (matches evaluation-agent.ts logic) */
function tokenDeltaToDifficulty(baseTokens: number, strippedTokens: number): string {
  if (baseTokens === 0) return "easy";
  const ratio = ((baseTokens - strippedTokens) / baseTokens) * 100;
  if (ratio <= 5) return "easy";
  if (ratio <= 20) return "moderate";
  if (ratio <= 40) return "hard";
  return "failed";
}

function computeDeltaDifficulty(
  stripType: string,
  delta: number,
  responsiveDelta: number | null,
  baselineTokens: number,
  strippedTokens: number | null,
): string {
  switch (stripType) {
    case "layout-direction-spacing":
      return stripDeltaToDifficulty(delta);
    case "size-constraints":
      if (responsiveDelta !== null && isFinite(responsiveDelta)) {
        return stripDeltaToDifficulty(responsiveDelta);
      }
      return stripDeltaToDifficulty(delta);
    case "component-references":
    case "node-names-hierarchy":
    case "variable-references":
    case "style-references":
      if (strippedTokens !== null && baselineTokens > 0) {
        return tokenDeltaToDifficulty(baselineTokens, strippedTokens);
      }
      return stripDeltaToDifficulty(delta);
    default:
      return stripDeltaToDifficulty(delta);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
