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
} from "node:fs";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";

import {
  DevelopRunIndexSchema,
  createDevRunIndex,
  findDevResumePoint,
  DEV_STEP_NAMES,
  type DevelopRunIndex,
  type StepRecord,
} from "../src/core/contracts/develop-run.js";
import { createDevelopRunDir } from "../src/agents/run-directory.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_TEST_RETRIES = 3;
const AGENT_TIMEOUT = 600_000; // 10 minutes
const PROJECT_ROOT = resolve(import.meta.dirname ?? ".", "..");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options: {
    resume: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
  allowPositionals: true,
});

if (values.help) {
  console.log(`Usage:
  npx tsx scripts/develop.ts <issue-number>
  npx tsx scripts/develop.ts --resume <run-dir>

Options:
  --resume <run-dir>  Resume a failed run from the last incomplete step
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

function buildBaseContext(issue: IssueData, runDir: string): string {
  return `## Project Instructions (CLAUDE.md)

${loadClaudeMd()}

## Target Issue

**#${issue.number}: ${issue.title}**

${issue.body}

## Run Directory

${runDir}
`;
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let index: DevelopRunIndex;
  let runDir: string;
  let issue: IssueData;

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
    index.status = "running";
    saveIndex(index);
    console.log(`Resuming development from step: ${resumeFrom}`);
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

    // Create branch
    const branchName = `develop/${issue.number}`;
    try {
      execSync(`git checkout -b ${shellEscape(branchName)} main`, { encoding: "utf-8", cwd: PROJECT_ROOT });
    } catch {
      // Branch may already exist (from a previous attempt)
      execSync(`git checkout ${shellEscape(branchName)}`, { encoding: "utf-8", cwd: PROJECT_ROOT });
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

  const baseContext = buildBaseContext(issue, runDir);

  // ─── Step 1: Plan (agent) ──────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.PLAN)) {
    markRunning(index, DEV_STEP_NAMES.PLAN);
    try {
      const planPrompt = `You are a software architect planning the implementation for a GitHub issue.

${baseContext}

## Your Task

Analyze the issue and the codebase, then produce a detailed implementation plan.

### Instructions

1. Read the issue carefully and understand the requirements
2. Explore the relevant parts of the codebase (use Glob, Grep, Read)
3. Identify which files need to be created or modified
4. Break down the work into ordered tasks

### Output Format

Write a JSON plan to ${join(runDir, "plan.json")} with this structure:

\`\`\`json
{
  "summary": "One-paragraph summary of what needs to be done",
  "tasks": [
    {
      "id": 1,
      "title": "Short task title",
      "description": "What to do and why",
      "files": ["src/path/to/file.ts"],
      "approach": "How to implement this"
    }
  ],
  "testStrategy": "How to verify the implementation",
  "risks": ["Potential issues to watch for"]
}
\`\`\`

Write the plan file, then print a one-line summary to stdout.`;

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

      const plan = readJson<{ tasks: unknown[] }>(join(runDir, "plan.json"));
      markCompleted(index, DEV_STEP_NAMES.PLAN, {
        summary: `${plan.tasks.length} tasks planned`,
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

      const implementPrompt = `You are a senior TypeScript developer implementing a planned feature.

${baseContext}

## Implementation Plan

${plan}

## Your Task

Implement ALL tasks from the plan above. Follow these rules:

1. Follow the project conventions in CLAUDE.md strictly (ESM, .js extensions, strict TS, etc.)
2. Create/modify files as specified in the plan
3. Do NOT run tests — a separate step handles that
4. Do NOT create a PR — a separate step handles that
5. After implementation, stage your changes with \`git add\` and commit with a conventional commit message

### Important

- Read existing files before modifying them
- Keep changes minimal — only what the plan requires
- Use the project's existing patterns and utilities

After completing all tasks, print a summary of what you implemented.`;

      const implOutput = runAgent(implementPrompt, "Implementer");

      // Check that changes were made
      const diffStat = execSync("git diff --stat HEAD~1 2>/dev/null || git diff --stat HEAD", {
        encoding: "utf-8",
        cwd: PROJECT_ROOT,
      }).trim();

      writeFileSync(join(runDir, "implement-output.txt"), implOutput);

      markCompleted(index, DEV_STEP_NAMES.IMPLEMENT, {
        summary: diffStat.split("\n").pop() ?? "Changes committed",
        outputs: ["implement-output.txt"],
      });
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.IMPLEMENT, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 3: Test (CLI with fix retry loop) ────────────────────────
  if (shouldRun(DEV_STEP_NAMES.TEST)) {
    markRunning(index, DEV_STEP_NAMES.TEST);
    let testPassed = false;
    let lastError = "";

    for (let attempt = 0; attempt <= MAX_TEST_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          console.log(`  [retry] Test attempt ${attempt + 1}/${MAX_TEST_RETRIES + 1}`);
        }

        // Run lint and tests
        runCli("pnpm lint", "Type check");
        runCli("pnpm test:run", "Tests");
        testPassed = true;
        break;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.warn(`  [test] Failed (attempt ${attempt + 1}): ${lastError.slice(0, 200)}`);

        if (attempt < MAX_TEST_RETRIES) {
          // Ask fix agent to resolve the issue
          console.log(`  [agent] Calling fix agent for test failure...`);
          const fixPrompt = `You are a TypeScript developer fixing test/lint failures.

${baseContext}

## Test Failure

The following test/lint command failed:

\`\`\`
${lastError.slice(0, 3000)}
\`\`\`

## Your Task

1. Read the failing files and understand the errors
2. Fix the issues — type errors, test failures, etc.
3. Stage and commit your fixes with message: "fix: resolve test failures"

Do NOT change test expectations unless the test is genuinely wrong.
Focus on fixing the implementation to match what tests expect.`;

          try {
            runAgent(fixPrompt, `Test Fix (attempt ${attempt + 1})`);
          } catch (fixErr) {
            console.warn(`  [agent] Fix agent failed: ${fixErr instanceof Error ? fixErr.message.slice(0, 200) : String(fixErr)}`);
          }
        }
      }
    }

    if (testPassed) {
      markCompleted(index, DEV_STEP_NAMES.TEST, {
        summary: "Lint + tests passed",
      });
    } else {
      markFailed(index, DEV_STEP_NAMES.TEST, `Tests failed after ${MAX_TEST_RETRIES + 1} attempts: ${lastError.slice(0, 500)}`);
      throw new Error("Tests failed after retries");
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

        const reviewPrompt = `You are a code reviewer checking a feature branch.

${baseContext}

## Changes (git diff main...HEAD)

\`\`\`diff
${truncatedDiff}
\`\`\`

## Your Task

Review the changes for:
1. **Correctness**: Logic errors, edge cases, off-by-one errors
2. **Conventions**: Does it follow CLAUDE.md conventions? (ESM, .js extensions, strict TS, naming)
3. **Security**: Injection risks, hardcoded secrets, unsafe operations
4. **Completeness**: Does it fully address the issue requirements?

### Output Format

Write a JSON review to ${join(runDir, "review.json")} with this structure:

\`\`\`json
{
  "verdict": "approve" | "request-changes",
  "summary": "Overall assessment",
  "findings": [
    {
      "severity": "error" | "warning" | "suggestion",
      "file": "path/to/file.ts",
      "line": 42,
      "issue": "What's wrong",
      "suggestion": "How to fix it"
    }
  ]
}
\`\`\`

Be strict but fair. Only flag real issues, not style preferences already handled by the project conventions.`;

        const reviewOutput = runAgent(reviewPrompt, "Reviewer");

        if (!existsSync(join(runDir, "review.json"))) {
          const jsonMatch = reviewOutput.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
          if (jsonMatch) {
            writeFileSync(join(runDir, "review.json"), jsonMatch[0] + "\n");
          } else {
            // No structured review — treat as approve
            writeFileSync(join(runDir, "review.json"), JSON.stringify({
              verdict: "approve",
              summary: "Review completed (unstructured output)",
              findings: [],
            }, null, 2) + "\n");
          }
        }

        const review = readJson<{ verdict: string; findings: unknown[] }>(join(runDir, "review.json"));
        const errorCount = (review.findings as Array<{ severity: string }>)
          .filter((f) => f.severity === "error").length;

        markCompleted(index, DEV_STEP_NAMES.REVIEW, {
          summary: `verdict=${review.verdict} findings=${review.findings.length} errors=${errorCount}`,
          outputs: ["review.json"],
        });

        // If approved with no errors, skip fix step
        if (review.verdict === "approve" && errorCount === 0) {
          markSkipped(index, DEV_STEP_NAMES.FIX, "Review approved, no errors");
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
        const fixPrompt = `You are a TypeScript developer fixing code review findings.

${baseContext}

## Review Findings to Fix

${JSON.stringify(actionable, null, 2)}

## Your Task

1. Read each file mentioned in the findings
2. Fix all errors and warnings
3. Stage and commit with message: "fix: address review findings"

Do NOT fix suggestions — only errors and warnings.
Do NOT make unrelated changes.`;

        runAgent(fixPrompt, "Fixer");

        markCompleted(index, DEV_STEP_NAMES.FIX, {
          summary: `Fixed ${actionable.length} findings`,
        });
      }
    } catch (err) {
      markFailed(index, DEV_STEP_NAMES.FIX, err instanceof Error ? err.message : String(err));
      throw err;
    }
  }

  // ─── Step 6: Verify (CLI) ──────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.VERIFY)) {
    markRunning(index, DEV_STEP_NAMES.VERIFY);
    try {
      runCli("pnpm lint", "Type check (verify)");
      runCli("pnpm build", "Build (verify)");

      markCompleted(index, DEV_STEP_NAMES.VERIFY, {
        summary: "Lint + build passed",
      });
    } catch (err) {
      // One retry with fix agent
      console.warn(`  [verify] Failed, calling fix agent...`);
      const fixPrompt = `You are a TypeScript developer fixing build/lint failures.

${baseContext}

## Build/Lint Failure

\`\`\`
${(err instanceof Error ? err.message : String(err)).slice(0, 3000)}
\`\`\`

## Your Task

Fix the build/lint errors. Stage and commit with message: "fix: resolve build errors"`;

      try {
        runAgent(fixPrompt, "Verify Fix");
        // Re-run verify
        runCli("pnpm lint", "Type check (verify retry)");
        runCli("pnpm build", "Build (verify retry)");
        markCompleted(index, DEV_STEP_NAMES.VERIFY, { summary: "Lint + build passed (after fix)" });
      } catch (retryErr) {
        markFailed(index, DEV_STEP_NAMES.VERIFY, retryErr instanceof Error ? retryErr.message : String(retryErr));
        throw retryErr;
      }
    }
  }

  // ─── Step 7: PR (CLI) ──────────────────────────────────────────────
  if (shouldRun(DEV_STEP_NAMES.PR)) {
    markRunning(index, DEV_STEP_NAMES.PR);
    try {
      // Push branch
      runCli(`git push -u origin ${shellEscape(index.branch)}`, "Push branch");

      // Build PR body from plan and review
      const plan = readJson<{ summary: string; tasks: Array<{ title: string }> }>(join(runDir, "plan.json"));
      const taskList = plan.tasks.map((t) => `- ${t.title}`).join("\n");

      const prBody = `## Summary

${plan.summary}

## Tasks

${taskList}

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
