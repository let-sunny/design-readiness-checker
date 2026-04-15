#!/usr/bin/env tsx

/**
 * Automated development pipeline orchestrator.
 *
 * Same pattern as scripts/calibrate.ts: CLI for deterministic steps,
 * `claude -p` for judgment steps. State tracked in index.json for
 * resume-from-failure support.
 *
 * Usage:
 *   npx tsx scripts/develop.ts <issue-number>
 *   npx tsx scripts/develop.ts --resume <run-dir>
 *
 * See: issue #247
 */

import { execSync, type SpawnSyncReturns } from "node:child_process";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

import {
  DevelopRunIndexSchema,
  createDevRunIndex,
  findDevResumePoint,
  DEV_STEP_NAMES,
  DEV_STEP_ORDER,
  type DevelopRunIndex,
  type StepRecord,
} from "../src/core/contracts/develop-run.js";
import { createDevelopRunDir } from "../src/agents/run-directory.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FIX_ROUNDS = 3;
const AGENT_TIMEOUT = 600_000; // 10 minutes
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    resume: { type: "string" },
    from: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage:
  npx tsx scripts/develop.ts <issue-number>
  npx tsx scripts/develop.ts --resume <run-dir> [--from <step>]

Steps: plan(1) implement(2) test(3) review(4) fix(5) verify(6) pr(7)

Options:
  --resume <run-dir>  Resume a failed run
  --from <step>       Start from a specific step (name or number, requires --resume)
  -h, --help          Show this help message`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Index.json helpers
// ---------------------------------------------------------------------------

function loadIndex(runDir: string): DevelopRunIndex {
  const indexPath = join(runDir, "index.json");
  const raw: unknown = JSON.parse(readFileSync(indexPath, "utf-8"));
  return DevelopRunIndexSchema.parse(raw);
}

function saveIndex(index: DevelopRunIndex): void {
  index.updatedAt = new Date().toISOString();
  writeFileSync(join(index.runDir, "index.json"), JSON.stringify(index, null, 2) + "\n");
}

function getStep(index: DevelopRunIndex, name: string): StepRecord {
  const step = index.steps.find((s) => s.name === name);
  if (!step) throw new Error(`Step not found: ${name}`);
  return step;
}

function markRunning(index: DevelopRunIndex, name: string): StepRecord {
  const step = getStep(index, name);
  step.status = "running";
  step.startedAt = new Date().toISOString();
  saveIndex(index);
  return step;
}

function markCompleted(
  index: DevelopRunIndex,
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

function markSkipped(index: DevelopRunIndex, name: string, reason: string): void {
  const step = getStep(index, name);
  step.status = "skipped";
  step.summary = reason;
  saveIndex(index);
}

function markFailed(index: DevelopRunIndex, name: string, error: string): void {
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
    return execSync(command, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, cwd: PROJECT_ROOT });
  } catch (err) {
    const execErr = err as SpawnSyncReturns<string>;
    const stderr = execErr.stderr ?? "";
    const stdout = execErr.stdout ?? "";
    throw new Error(`CLI failed: ${label}\n${stderr}\n${stdout}`.trim());
  }
}

/** Run a `claude -p` agent with prompt via stdin. Returns stdout. */
function runAgent(prompt: string, label: string): string {
  console.log(`  [agent] ${label}`);
  try {
    return execSync(
      `claude -p --allowedTools "Bash,Read,Write,Glob,Edit,Grep"`,
      {
        input: prompt,
        encoding: "utf-8",
        maxBuffer: 50 * 1024 * 1024,
        timeout: AGENT_TIMEOUT,
        cwd: PROJECT_ROOT,
      },
    );
  } catch (err) {
    const execErr = err as SpawnSyncReturns<string>;
    const stderr = execErr.stderr ?? "";
    throw new Error(`Agent failed: ${label}\n${stderr}`.trim());
  }
}

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/** Read a JSON file and return parsed content. */
function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

/** Resolve --from value (name or 1-based number) to step name. */
function resolveFromStep(from: string): string {
  const num = parseInt(from, 10);
  if (!isNaN(num) && num >= 1 && num <= DEV_STEP_ORDER.length) {
    return DEV_STEP_ORDER[num - 1]!;
  }
  if (DEV_STEP_ORDER.includes(from)) return from;
  console.error(`Error: Unknown step '${from}'. Valid: ${DEV_STEP_ORDER.join(", ")} or 1-${DEV_STEP_ORDER.length}`);
  process.exit(1);
}

/** Artifacts produced by each step — deleted on resetFrom to avoid stale state. */
const STEP_ARTIFACTS: Record<string, string[]> = {
  [DEV_STEP_NAMES.PLAN]: ["plan.json"],
  [DEV_STEP_NAMES.IMPLEMENT]: ["implement-log.json", "implement-output.txt"],
  [DEV_STEP_NAMES.TEST]: ["test-result.json"],
  [DEV_STEP_NAMES.REVIEW]: ["review.json", "review-raw.txt"],
  [DEV_STEP_NAMES.FIX]: ["fix-log.json"],
  [DEV_STEP_NAMES.VERIFY]: ["circuit.json"],
  [DEV_STEP_NAMES.PR]: ["pr-url.txt"],
};

/** Reset a step and all subsequent steps to pending, removing stale artifacts. */
function resetFrom(index: DevelopRunIndex, fromStep: string): void {
  let found = false;
  for (const step of index.steps) {
    if (step.name === fromStep) found = true;
    if (found) {
      step.status = "pending";
      step.error = undefined;
      step.summary = undefined;
      step.completedAt = undefined;
      step.durationMs = undefined;

      // Delete artifacts produced by this step
      const artifacts = STEP_ARTIFACTS[step.name];
      if (artifacts) {
        for (const file of artifacts) {
          const filePath = join(index.runDir, file);
          if (existsSync(filePath)) unlinkSync(filePath);
        }
      }
    }
  }
  saveIndex(index);
}

/** Abort if the working tree has staged or unstaged changes. */
function ensureCleanWorktree(): void {
  const status = execSync("git status --porcelain", { encoding: "utf-8", cwd: PROJECT_ROOT }).trim();
  if (status) {
    console.error("Error: Working tree is not clean. Commit or stash your changes first.");
    console.error(status);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker
// ---------------------------------------------------------------------------

interface CircuitState {
  state: "closed" | "half-open" | "open";
  errorCount: number;
  previousErrorCount: number | null;
  attempt: number;
  replanAttempted: boolean;
}

function loadCircuit(runDir: string): CircuitState {
  const path = join(runDir, "circuit.json");
  if (existsSync(path)) return readJson<CircuitState>(path);
  return { state: "closed", errorCount: 0, previousErrorCount: null, attempt: 0, replanAttempted: false };
}

function saveCircuit(runDir: string, circuit: CircuitState): void {
  writeFileSync(join(runDir, "circuit.json"), JSON.stringify(circuit, null, 2) + "\n");
}

/** Count error-severity findings in review.json */
function countReviewErrors(runDir: string): number {
  if (!existsSync(join(runDir, "review.json"))) return 0;
  const review = readJson<{ findings: Array<{ severity: string }> }>(join(runDir, "review.json"));
  return review.findings.filter((f) => f.severity === "error").length;
}

/** Decide what to do after a verify failure */
function circuitDecision(circuit: CircuitState): "fix-retry" | "re-plan" | "give-up" {
  if (circuit.replanAttempted) return "give-up";
  if (circuit.attempt >= MAX_FIX_ROUNDS) return "re-plan";
  if (circuit.previousErrorCount !== null && circuit.errorCount >= circuit.previousErrorCount) {
    // No progress — errors not decreasing
    return "re-plan";
  }
  return "fix-retry";
}

// ---------------------------------------------------------------------------
// Issue fetching
// ---------------------------------------------------------------------------

interface IssueData {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

function fetchIssue(issueNumber: number): IssueData {
  console.log(`  [cli] Fetching issue #${issueNumber}...`);
  const raw = execSync(
    `gh issue view ${issueNumber} --json number,title,body,labels`,
    { encoding: "utf-8", cwd: PROJECT_ROOT },
  );
  const data = JSON.parse(raw) as { number: number; title: string; body: string; labels: Array<{ name: string }> };
  return {
    number: data.number,
    title: data.title,
    body: data.body,
    labels: data.labels.map((l) => l.name),
  };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

function loadClaudeMd(): string {
  const path = join(PROJECT_ROOT, "CLAUDE.md");
  return existsSync(path) ? readFileSync(path, "utf-8") : "";
}

/** Load an agent definition file from .claude/agents/develop/ */
function loadAgent(name: string): string {
  const path = resolve(PROJECT_ROOT, `.claude/agents/develop/${name}.md`);
  return readFileSync(path, "utf-8");
}

/** Build the context block injected after the agent definition */
function buildContext(issue: IssueData, runDir: string, extras: Record<string, string> = {}): string {
  const sections = [
    `Run directory: ${runDir}`,
    `Issue: #${issue.number} — ${issue.title}\n\n${issue.body}`,
    `CLAUDE.md:\n\n${loadClaudeMd()}`,
  ];
  for (const [label, content] of Object.entries(extras)) {
    sections.push(`${label}:\n\n${content}`);
  }
  return `## Context (injected by orchestration script)\n\n${sections.join("\n\n---\n\n")}`;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let index: DevelopRunIndex;
  let runDir: string;
  let issue: IssueData;

  ensureCleanWorktree();

  if (values.resume) {
    // Resume existing run
    runDir = resolve(values.resume);
    if (!existsSync(join(runDir, "index.json"))) {
      console.error(`Error: No index.json found in ${runDir}`);
      process.exit(1);
    }
    index = loadIndex(runDir);
    issue = fetchIssue(index.issue);
    const resumeFrom = findDevResumePoint(index);
    if (!resumeFrom) {
      console.log("All steps completed. Nothing to resume.");
      return;
    }

    // Apply --from override: reset from specified step
    if (values.from) {
      const fromStep = resolveFromStep(values.from);
      resetFrom(index, fromStep);
      console.log(`  Resetting from step: ${fromStep}`);
    }

    // Ensure we're on the correct branch
    const currentBranch = execSync("git branch --show-current", { encoding: "utf-8", cwd: PROJECT_ROOT }).trim();
    if (currentBranch !== index.branch) {
      console.log(`  Switching to branch: ${index.branch}`);
      execSync(`git checkout ${shellEscape(index.branch)}`, { encoding: "utf-8", cwd: PROJECT_ROOT });
    }

    const actualResume = findDevResumePoint(index);
    if (!actualResume) {
      console.log("All steps completed. Nothing to resume.");
      return;
    }

    index.status = "running";
    saveIndex(index);
    console.log(`Resuming development from step: ${actualResume}`);
    console.log(`  Run directory: ${runDir}`);
  } else {
    // New run
    const issueNum = parseInt(positionals[0] ?? "", 10);
    if (isNaN(issueNum)) {
      console.error("Error: issue number required. Usage: npx tsx scripts/develop.ts <issue-number>");
      process.exit(1);
    }

    issue = fetchIssue(issueNum);
    console.log(`\nStarting development pipeline for: #${issue.number} ${issue.title}`);

    // Create branch — fail if it already exists (use --resume for existing runs)
    const branchName = `develop/${issue.number}`;
    try {
      execSync(`git checkout -b ${shellEscape(branchName)} main`, { encoding: "utf-8", cwd: PROJECT_ROOT });
    } catch {
      console.error(`Error: Branch '${branchName}' already exists.`);
      console.error(`  To resume a previous run: npx tsx scripts/develop.ts --resume <run-dir>`);
      console.error(`  To start fresh: git branch -D ${branchName}`);
      process.exit(1);
    }

    runDir = createDevelopRunDir(issue.number);
    index = createDevRunIndex(issue.number, issue.title, branchName, runDir);
    saveIndex(index);

    console.log(`  Branch: ${branchName}`);
    console.log(`  Run directory: ${runDir}`);
  }

  try {
    await runPipeline(index, issue);
    index.status = "completed";
    saveIndex(index);
    console.log("\nDevelopment pipeline complete.");
    console.log(`  Run directory: ${runDir}`);
  } catch (err) {
    console.error("\nPipeline failed:", err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}

async function runPipeline(index: DevelopRunIndex, issue: IssueData): Promise<void> {
  const { runDir } = index;
  const resumeFrom = findDevResumePoint(index);
  if (!resumeFrom) return;

  const shouldRun = (name: string): boolean => {
    const step = getStep(index, name);
    return step.status !== "completed" && step.status !== "skipped";
  };

  // ─── Step 1: Plan (agent) ──────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.PLAN)) {
    markRunning(index, DEV_STEP_NAMES.PLAN);
    try {
      const agentDef = loadAgent("planner");
      const context = buildContext(issue, runDir);
      const planPrompt = `${agentDef}\n\n${context}`;

      const planOutput = runAgent(planPrompt, "Planner");

      if (!existsSync(join(runDir, "plan.json"))) {
        // Agent may have printed JSON instead of writing — try to extract
        const jsonMatch = planOutput.match(/\{[\s\S]*"tasks"[\s\S]*\}/);
        if (jsonMatch) {
          writeFileSync(join(runDir, "plan.json"), jsonMatch[0] + "\n");
        } else {
          throw new Error("Planner did not produce plan.json");
        }
      }

      const plan = readJson<{ tasks: unknown[]; split?: boolean; remainingDescription?: string }>(join(runDir, "plan.json"));

      // Handle issue splitting
      if (plan.split && plan.remainingDescription) {
        console.log(`  [split] Issue too large — creating follow-up issue...`);
        try {
          const followUpBody = `## Follow-up from #${issue.number}\n\n${plan.remainingDescription}\n\n---\nAuto-created by \`scripts/develop.ts\` (issue splitting)`;
          const ghOutput = execSync(
            `gh issue create --title ${shellEscape(`feat: ${issue.title} (part 2)`)} --body ${shellEscape(followUpBody)}`,
            { encoding: "utf-8", cwd: PROJECT_ROOT },
          ).trim();
          console.log(`  [split] Follow-up issue: ${ghOutput}`);
        } catch {
          console.warn(`  [split] Failed to create follow-up issue — continuing with current plan`);
        }
      }

      markCompleted(index, DEV_STEP_NAMES.PLAN, {
        summary: `${plan.tasks.length} tasks planned${plan.split ? " (split)" : ""}`,
        outputs: ["plan.json"],
      });
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.PLAN, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 2: Implement (agent) ─────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.IMPLEMENT)) {
    markRunning(index, DEV_STEP_NAMES.IMPLEMENT);
    try {
      const plan = readFileSync(join(runDir, "plan.json"), "utf-8");
      const agentDef = loadAgent("implementer");
      const context = buildContext(issue, runDir, { "plan.json": plan });
      const implementPrompt = `${agentDef}\n\n${context}`;

      // Capture HEAD before run to detect new commits (avoids false positive on resume)
      const headBefore = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      }).trim();

      const implOutput = runAgent(implementPrompt, "Implementer");

      // Check that the implementer created new commits this round
      const headAfter = execSync("git rev-parse HEAD", {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      }).trim();
      if (headAfter === headBefore) {
        throw new Error("Implementer did not create any commits");
      }
      const diffStat = execSync(`git diff --stat ${headBefore}..HEAD`, {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      }).trim();

      writeFileSync(join(runDir, "implement-output.txt"), implOutput);

      // Ensure implement-log.json exists (agent may have skipped it)
      if (!existsSync(join(runDir, "implement-log.json"))) {
        writeFileSync(join(runDir, "implement-log.json"), JSON.stringify({
          filesChanged: [],
          commits: [],
          decisions: ["(implement-log.json not written by agent)"],
          knownRisks: [],
        }, null, 2) + "\n");
      }

      markCompleted(index, DEV_STEP_NAMES.IMPLEMENT, {
        summary: diffStat.split("\n").pop() ?? "Changes committed",
        outputs: ["implement-output.txt", "implement-log.json"],
      });
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.IMPLEMENT, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 3: Test (CLI, non-blocking) ───────────────────────────────
  // Test failures don't kill the pipeline — Review diagnoses them.
  if (shouldRun(DEV_STEP_NAMES.TEST)) {
    markRunning(index, DEV_STEP_NAMES.TEST);
    try {
      runCli("pnpm lint", "Type check");
      runCli("pnpm test:run", "Tests");
      writeFileSync(join(runDir, "test-result.json"), JSON.stringify({
        passed: true,
      }, null, 2) + "\n");
      markCompleted(index, DEV_STEP_NAMES.TEST, {
        summary: "Lint + tests passed",
        outputs: ["test-result.json"],
      });
    } catch (err) {
      const testError = err instanceof Error ? err.message : String(err);
      console.warn(`  [test] Failed — continuing to Review for diagnosis`);
      writeFileSync(join(runDir, "test-result.json"), JSON.stringify({
        passed: false,
        errors: testError.slice(0, 5000),
      }, null, 2) + "\n");
      markCompleted(index, DEV_STEP_NAMES.TEST, {
        summary: "FAILED — forwarded to Review",
        outputs: ["test-result.json"],
      });
    }
  }

  // ─── Step 4: Review (agent) ────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.REVIEW)) {
    markRunning(index, DEV_STEP_NAMES.REVIEW);
    try {
      const diff = execSync("git diff main...HEAD", { encoding: "utf-8", cwd: PROJECT_ROOT });

      if (!diff.trim()) {
        markSkipped(index, DEV_STEP_NAMES.REVIEW, "No changes to review");
        markSkipped(index, DEV_STEP_NAMES.FIX, "No review findings");
      } else {
        // Truncate diff if too large for agent context
        const maxDiffLen = 50_000;
        const truncatedDiff = diff.length > maxDiffLen
          ? diff.slice(0, maxDiffLen) + `\n\n... (truncated, ${diff.length - maxDiffLen} chars omitted)`
          : diff;

        const planJson = existsSync(join(runDir, "plan.json"))
          ? readFileSync(join(runDir, "plan.json"), "utf-8")
          : "{}";
        const implLog = existsSync(join(runDir, "implement-log.json"))
          ? readFileSync(join(runDir, "implement-log.json"), "utf-8")
          : "{}";

        // Include test results if tests failed — reviewer diagnoses
        const extras: Record<string, string> = {
          "plan.json": planJson,
          "implement-log.json": implLog,
          "git diff main...HEAD": truncatedDiff,
        };
        const testResult = existsSync(join(runDir, "test-result.json"))
          ? readJson<{ passed: boolean; errors?: string }>(join(runDir, "test-result.json"))
          : null;
        if (testResult && !testResult.passed) {
          extras["test-result.json (TESTS FAILED — diagnose this)"] = testResult.errors ?? "unknown error";
        }

        const reviewerDef = loadAgent("reviewer");
        const reviewContext = buildContext(issue, runDir, extras);
        const reviewPrompt = `${reviewerDef}\n\n${reviewContext}`;

        const reviewOutput = runAgent(reviewPrompt, "Reviewer");

        if (!existsSync(join(runDir, "review.json"))) {
          const jsonMatch = reviewOutput.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
          if (jsonMatch) {
            writeFileSync(join(runDir, "review.json"), jsonMatch[0] + "\n");
          } else {
            // Save raw output for debugging, then fail
            writeFileSync(join(runDir, "review-raw.txt"), reviewOutput);
            throw new Error("Reviewer did not produce structured review.json. Raw output saved to review-raw.txt");
          }
        }

        const review = readJson<{ verdict: string; findings: unknown[] }>(join(runDir, "review.json"));
        const findings = review.findings as Array<{ severity: string }>;
        const errorCount = findings.filter((f) => f.severity === "error").length;
        const warningCount = findings.filter((f) => f.severity === "warning").length;
        const actionableCount = errorCount + warningCount;

        markCompleted(index, DEV_STEP_NAMES.REVIEW, {
          summary: `verdict=${review.verdict} findings=${review.findings.length} errors=${errorCount} warnings=${warningCount}`,
          outputs: ["review.json"],
        });

        // If approved with no actionable findings (errors + warnings), skip fix step
        if (review.verdict === "approve" && actionableCount === 0) {
          markSkipped(index, DEV_STEP_NAMES.FIX, "Review approved, no actionable findings");
        }
      }
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.REVIEW, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 5: Fix (agent, conditional) ──────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.FIX)) {
    markRunning(index, DEV_STEP_NAMES.FIX);
    try {
      const review = readJson<{ findings: Array<{ severity: string; file: string; issue: string; suggestion: string }> }>(
        join(runDir, "review.json"),
      );
      const actionable = review.findings.filter((f) => f.severity === "error" || f.severity === "warning");

      if (actionable.length === 0) {
        markSkipped(index, DEV_STEP_NAMES.FIX, "No actionable findings");
      } else {
        const implLog = existsSync(join(runDir, "implement-log.json"))
          ? readFileSync(join(runDir, "implement-log.json"), "utf-8")
          : "{}";

        const fixerDef = loadAgent("fixer");
        const fixContext = buildContext(issue, runDir, {
          "implement-log.json": implLog,
          "review.json (actionable findings)": JSON.stringify(actionable, null, 2),
        });
        const fixPrompt = `${fixerDef}\n\n${fixContext}`;

        runAgent(fixPrompt, "Fixer");

        markCompleted(index, DEV_STEP_NAMES.FIX, {
          summary: `Fixed ${actionable.length} findings`,
          outputs: ["fix-log.json"],
        });
      }
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.FIX, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 6: Verify (CLI with circuit breaker) ─────────────────────
  // Loop: verify → fail → review → fix → verify. Circuit breaker detects
  // stuck loops and triggers re-plan. Max MAX_FIX_ROUNDS rounds.
  if (shouldRun(DEV_STEP_NAMES.VERIFY)) {
    markRunning(index, DEV_STEP_NAMES.VERIFY);
    const circuit = loadCircuit(runDir);

    let verified = false;
    while (!verified) {
      try {
        runCli("pnpm lint", `Type check (verify round ${circuit.attempt + 1})`);
        runCli("pnpm test:run", `Tests (verify round ${circuit.attempt + 1})`);
        runCli("pnpm build", `Build (verify round ${circuit.attempt + 1})`);
        verified = true;
      } catch (verifyErr) {
        const verifyError = verifyErr instanceof Error ? verifyErr.message : String(verifyErr);
        circuit.previousErrorCount = circuit.errorCount;
        circuit.errorCount = countReviewErrors(runDir);
        circuit.attempt++;
        saveCircuit(runDir, circuit);

        const action = circuitDecision(circuit);
        console.log(`  [circuit] Round ${circuit.attempt}: errors=${circuit.errorCount} prev=${circuit.previousErrorCount ?? "n/a"} → ${action}`);

        if (action === "give-up") {
          markFailed(index, DEV_STEP_NAMES.VERIFY,
            `Circuit breaker OPEN: re-plan already attempted, still failing. Manual intervention needed.`);
          throw new Error("Circuit breaker: pipeline exhausted all recovery options");
        }

        if (action === "re-plan") {
          console.log(`  [circuit] Triggering re-plan with failure context...`);
          circuit.replanAttempted = true;
          circuit.state = "half-open";
          saveCircuit(runDir, circuit);

          // Re-plan: planner reads previous plan + review failures
          const prevPlan = existsSync(join(runDir, "plan.json"))
            ? readFileSync(join(runDir, "plan.json"), "utf-8") : "{}";
          const prevReview = existsSync(join(runDir, "review.json"))
            ? readFileSync(join(runDir, "review.json"), "utf-8") : "{}";

          const replanDef = loadAgent("planner");
          const replanContext = buildContext(issue, runDir, {
            "PREVIOUS plan.json (this approach FAILED)": prevPlan,
            "PREVIOUS review.json (these issues were found)": prevReview,
            "INSTRUCTION": "The previous plan failed. Analyze why from the review findings and try a DIFFERENT approach. Do NOT repeat the same plan.",
          });
          runAgent(`${replanDef}\n\n${replanContext}`, "Re-planner");

          // Re-implement with new plan
          const newPlan = readFileSync(join(runDir, "plan.json"), "utf-8");
          const reimplDef = loadAgent("implementer");
          const reimplContext = buildContext(issue, runDir, { "plan.json": newPlan });
          runAgent(`${reimplDef}\n\n${reimplContext}`, "Re-implementer");

          // Loop back to verify (one more chance)
          continue;
        }

        // action === "fix-retry": run review → fix → loop back to verify
        console.log(`  [circuit] Running review → fix cycle...`);

        // Quick review of current state
        const fixDiff = execSync("git diff main...HEAD", { encoding: "utf-8", cwd: PROJECT_ROOT });
        const truncFixDiff = fixDiff.length > 30_000
          ? fixDiff.slice(0, 30_000) + "\n\n... (truncated)"
          : fixDiff;
        const implLogFix = existsSync(join(runDir, "implement-log.json"))
          ? readFileSync(join(runDir, "implement-log.json"), "utf-8") : "{}";

        const reviewerDef = loadAgent("reviewer");
        const rvCtx = buildContext(issue, runDir, {
          "implement-log.json": implLogFix,
          "git diff main...HEAD": truncFixDiff,
          "Verify failure": verifyError.slice(0, 3000),
        });
        const rvOutput = runAgent(`${reviewerDef}\n\n${rvCtx}`, `Reviewer (round ${circuit.attempt})`);

        // Always save fresh review — overwrite stale data from previous round
        const rvJson = rvOutput.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
        if (rvJson) writeFileSync(join(runDir, "review.json"), rvJson[0] + "\n");

        // Fix
        const fixerDef = loadAgent("fixer");
        const fxCtx = buildContext(issue, runDir, {
          "implement-log.json": implLogFix,
          "Verify failure": verifyError.slice(0, 3000),
        });
        runAgent(`${fixerDef}\n\n${fxCtx}`, `Fixer (round ${circuit.attempt})`);
      }
    }

    circuit.state = "closed";
    saveCircuit(runDir, circuit);
    markCompleted(index, DEV_STEP_NAMES.VERIFY, {
      summary: `Lint + tests + build passed (${circuit.attempt} fix rounds)`,
      outputs: ["circuit.json"],
    });
  }

  // ─── Step 7: PR (CLI) ──────────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.PR)) {
    markRunning(index, DEV_STEP_NAMES.PR);
    try {
      // Push branch
      runCli(`git push -u origin ${shellEscape(index.branch)}`, "Push branch");

      // Build PR body from plan, review, and fix results
      const plan = readJson<{ summary: string; tasks: Array<{ title: string }> }>(join(runDir, "plan.json"));
      const taskList = plan.tasks.map((t) => `- ${t.title}`).join("\n");

      // Include self-review results if available
      let reviewSection = "";
      if (existsSync(join(runDir, "review.json"))) {
        const review = readJson<{ verdict: string; summary: string; findings: Array<{ severity: string }> }>(
          join(runDir, "review.json"),
        );
        const errorCount = review.findings.filter((f) => f.severity === "error").length;
        const warningCount = review.findings.filter((f) => f.severity === "warning").length;
        reviewSection = `\n## Self-review\n\n${review.summary}\n- Verdict: ${review.verdict}\n- Errors: ${errorCount}, Warnings: ${warningCount}, Total: ${review.findings.length}\n`;
      }

      const prBody = `## Summary

${plan.summary}

## Tasks

${taskList}
${reviewSection}
## Test plan

- [ ] \`pnpm lint\` passes
- [ ] \`pnpm test:run\` passes
- [ ] \`pnpm build\` passes

Closes #${issue.number}

---
Generated by \`scripts/develop.ts\` ([#247](https://github.com/let-sunny/canicode/issues/247))`;

      const prTitle = `${issue.title.startsWith("feat:") || issue.title.startsWith("fix:") ? issue.title : `feat: ${issue.title}`}`;

      // Create draft PR
      const prOutput = runCli(
        `gh pr create --draft --title ${shellEscape(prTitle)} --body ${shellEscape(prBody)}`,
        "Create draft PR",
      );

      // Extract PR URL from output
      const prUrl = prOutput.trim().split("\n").pop() ?? "";
      writeFileSync(join(runDir, "pr-url.txt"), prUrl + "\n");

      markCompleted(index, DEV_STEP_NAMES.PR, {
        summary: prUrl,
        outputs: ["pr-url.txt"],
      });

      console.log(`\n  PR created: ${prUrl}`);
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.PR, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
