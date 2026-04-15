import { z } from "zod";

// --- Step status tracking for calibration pipeline ---

export const StepStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "skipped",
]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepTypeSchema = z.enum(["cli", "agent"]);
export type StepType = z.infer<typeof StepTypeSchema>;

export const StepRecordSchema = z.object({
  name: z.string(),
  type: StepTypeSchema,
  status: StepStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  durationMs: z.number().optional(),
  /** Key input file paths consumed by this step */
  inputs: z.array(z.string()).optional(),
  /** Key output file paths produced by this step */
  outputs: z.array(z.string()).optional(),
  /** One-line summary carried to the next step as context */
  summary: z.string().optional(),
  error: z.string().optional(),
  retries: z.number().default(0),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

// --- Calibration run index (index.json) ---

export const CalibrationRunIndexSchema = z.object({
  /** Schema version for forward compatibility */
  version: z.literal(1),
  fixture: z.string(),
  fixturePath: z.string(),
  runDir: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Overall run status derived from step statuses */
  status: z.enum(["running", "completed", "failed"]),
  steps: z.array(StepRecordSchema),
});
export type CalibrationRunIndex = z.infer<typeof CalibrationRunIndexSchema>;

// --- Step name constants ---

export const STEP_NAMES = {
  ANALYZE: "analyze",
  DESIGN_TREE: "design-tree",
  STRIP_DESIGN_TREE: "strip-design-tree",
  CONVERT: "convert",
  MEASURE: "measure",
  GAP_ANALYZE: "gap-analyze",
  EVALUATE: "evaluate",
  GATHER_EVIDENCE: "gather-evidence",
  CRITIC: "critic",
  FINALIZE_DEBATE: "finalize-debate",
  ARBITRATOR: "arbitrator",
  ENRICH_EVIDENCE: "enrich-evidence",
  PRUNE_EVIDENCE: "prune-evidence",
  GAP_REPORT: "gap-report",
} as const;

/** Ordered list of all steps in the calibration pipeline */
export const STEP_ORDER: readonly string[] = [
  STEP_NAMES.ANALYZE,
  STEP_NAMES.DESIGN_TREE,
  STEP_NAMES.STRIP_DESIGN_TREE,
  STEP_NAMES.CONVERT,
  STEP_NAMES.MEASURE,
  STEP_NAMES.GAP_ANALYZE,
  STEP_NAMES.EVALUATE,
  STEP_NAMES.GATHER_EVIDENCE,
  STEP_NAMES.CRITIC,
  STEP_NAMES.FINALIZE_DEBATE,
  STEP_NAMES.ARBITRATOR,
  STEP_NAMES.ENRICH_EVIDENCE,
  STEP_NAMES.PRUNE_EVIDENCE,
  STEP_NAMES.GAP_REPORT,
];

/** Step definitions: name → type mapping */
export const STEP_DEFS: Record<string, StepType> = {
  [STEP_NAMES.ANALYZE]: "cli",
  [STEP_NAMES.DESIGN_TREE]: "cli",
  [STEP_NAMES.STRIP_DESIGN_TREE]: "cli",
  [STEP_NAMES.CONVERT]: "agent",
  [STEP_NAMES.MEASURE]: "cli",
  [STEP_NAMES.GAP_ANALYZE]: "agent",
  [STEP_NAMES.EVALUATE]: "cli",
  [STEP_NAMES.GATHER_EVIDENCE]: "cli",
  [STEP_NAMES.CRITIC]: "agent",
  [STEP_NAMES.FINALIZE_DEBATE]: "cli",
  [STEP_NAMES.ARBITRATOR]: "agent",
  [STEP_NAMES.ENRICH_EVIDENCE]: "cli",
  [STEP_NAMES.PRUNE_EVIDENCE]: "cli",
  [STEP_NAMES.GAP_REPORT]: "cli",
};

/**
 * Create a fresh index.json for a new calibration run.
 */
export function createRunIndex(
  fixture: string,
  fixturePath: string,
  runDir: string,
): CalibrationRunIndex {
  const now = new Date().toISOString();
  return {
    version: 1,
    fixture,
    fixturePath,
    runDir,
    createdAt: now,
    updatedAt: now,
    status: "running",
    steps: STEP_ORDER.map((name) => ({
      name,
      type: STEP_DEFS[name]!,
      status: "pending" as const,
      retries: 0,
    })),
  };
}

/**
 * Find the first step to resume from (first non-completed step).
 * Returns the step name, or null if all steps are completed.
 */
export function findResumePoint(index: CalibrationRunIndex): string | null {
  for (const step of index.steps) {
    if (step.status !== "completed" && step.status !== "skipped") {
      return step.name;
    }
  }
  return null;
}
