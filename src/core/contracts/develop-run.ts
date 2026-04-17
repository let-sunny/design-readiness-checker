import { z } from "zod";

import {
  StepStatusSchema,
  StepTypeSchema,
  StepRecordSchema,
  type StepRecord,
} from "./calibration-run.js";

// Re-export shared step types for convenience
export { StepStatusSchema, StepTypeSchema, StepRecordSchema };
export type { StepRecord };

// --- Development pipeline run index (index.json) ---

export const DevelopRunIndexSchema = z.object({
  /** Schema version for forward compatibility */
  version: z.literal(1),
  /** GitHub issue number */
  issue: z.number(),
  /** Issue title */
  issueTitle: z.string(),
  /** Git branch name */
  branch: z.string(),
  /** Run directory path */
  runDir: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Overall run status */
  status: z.enum(["running", "completed", "failed"]),
  steps: z.array(StepRecordSchema),
});
export type DevelopRunIndex = z.infer<typeof DevelopRunIndexSchema>;

// --- Step name constants ---

export const DEV_STEP_NAMES = {
  PLAN: "plan",
  IMPLEMENT: "implement",
  TEST: "test",
  REVIEW: "review",
  FIX: "fix",
  VERIFY: "verify",
  PR: "pr",
} as const;

/** Ordered list of all steps in the development pipeline */
export const DEV_STEP_ORDER: readonly string[] = [
  DEV_STEP_NAMES.PLAN,
  DEV_STEP_NAMES.IMPLEMENT,
  DEV_STEP_NAMES.TEST,
  DEV_STEP_NAMES.REVIEW,
  DEV_STEP_NAMES.FIX,
  DEV_STEP_NAMES.VERIFY,
  DEV_STEP_NAMES.PR,
];

/** Step definitions: name → type mapping */
export const DEV_STEP_DEFS: Record<string, z.infer<typeof StepTypeSchema>> = {
  [DEV_STEP_NAMES.PLAN]: "agent",
  [DEV_STEP_NAMES.IMPLEMENT]: "agent",
  [DEV_STEP_NAMES.TEST]: "cli",
  [DEV_STEP_NAMES.REVIEW]: "agent",
  [DEV_STEP_NAMES.FIX]: "agent",
  [DEV_STEP_NAMES.VERIFY]: "cli",
  [DEV_STEP_NAMES.PR]: "cli",
};

/**
 * Create a fresh index.json for a new development run.
 */
export function createDevRunIndex(
  issue: number,
  issueTitle: string,
  branch: string,
  runDir: string,
): DevelopRunIndex {
  const now = new Date().toISOString();
  return {
    version: 1,
    issue,
    issueTitle,
    branch,
    runDir,
    createdAt: now,
    updatedAt: now,
    status: "running",
    steps: DEV_STEP_ORDER.map((name) => ({
      name,
      type: DEV_STEP_DEFS[name]!,
      status: "pending" as const,
      retries: 0,
    })),
  };
}

/**
 * Find the first step to resume from (first non-completed step).
 * Returns the step name, or null if all steps are completed.
 */
export function findDevResumePoint(index: DevelopRunIndex): string | null {
  for (const step of index.steps) {
    if (step.status !== "completed" && step.status !== "skipped") {
      return step.name;
    }
  }
  return null;
}

// --- Implementer artifacts ---

/**
 * Schema for `implement-log.json` produced by the Implementer agent.
 * Kept `.passthrough()` so the agent can include extra context without failing validation.
 */
export const ImplementLogSchema = z
  .object({
    filesChanged: z.array(z.string()),
    commits: z.array(z.string()),
    decisions: z.array(z.string()),
    knownRisks: z.array(z.string()),
    status: z.enum(["success", "timeout"]).optional(),
    completedTasks: z.array(z.number()).optional(),
    timedOutAt: z.string().optional(),
  })
  .passthrough();
export type ImplementLog = z.infer<typeof ImplementLogSchema>;

/**
 * Schema for `implement-attempts/<n>.json` — one record per Implementer attempt.
 * Used by the retry loop to detect stalled agents (identical filesWritten across attempts).
 */
export const ImplementAttemptSchema = z
  .object({
    attempt: z.number(),
    startedAt: z.string(),
    endedAt: z.string(),
    status: z.enum(["success", "timeout", "error"]),
    failureReason: z.string().optional(),
    filesWritten: z.array(z.string()),
    lastTaskId: z.number().optional(),
    err: z.string().optional(),
  })
  .passthrough();
export type ImplementAttempt = z.infer<typeof ImplementAttemptSchema>;
