import { z } from "zod";

// --- Calibration evidence ---

export const CalibrationEvidenceEntrySchema = z.object({
  ruleId: z.string(),
  type: z.enum(["overscored", "underscored"]),
  actualDifficulty: z.string(),
  fixture: z.string(),
  timestamp: z.string(),
  // Phase 1 fields (#144) — optional for backward compatibility with existing evidence
  confidence: z.enum(["high", "medium", "low"]).optional(),
  pro: z.array(z.string()).optional(),
  con: z.array(z.string()).optional(),
  decision: z.enum(["APPROVE", "REJECT", "REVISE", "HOLD"]).optional(),
});

export type CalibrationEvidenceEntry = z.infer<typeof CalibrationEvidenceEntrySchema>;

export const CrossRunEvidenceGroupSchema = z.object({
  overscoredCount: z.number(),
  underscoredCount: z.number(),
  overscoredDifficulties: z.array(z.string()),
  underscoredDifficulties: z.array(z.string()),
  // Aggregated pro/con from all entries for this rule
  allPro: z.array(z.string()).optional(),
  allCon: z.array(z.string()).optional(),
  lastConfidence: z.enum(["high", "medium", "low"]).optional(),
  lastDecision: z.enum(["APPROVE", "REJECT", "REVISE", "HOLD"]).optional(),
});

export type CrossRunEvidenceGroup = z.infer<typeof CrossRunEvidenceGroupSchema>;

export type CrossRunEvidence = Record<string, CrossRunEvidenceGroup>;

// --- Evidence ratio summary (deterministic pre-computation for Critic) ---

export const EvidenceRatioSummarySchema = z.object({
  totalSamples: z.number(),
  overscoredCount: z.number(),
  underscoredCount: z.number(),
  overscoredRate: z.number(),
  underscoredRate: z.number(),
  dominantDirection: z.enum(["overscored", "underscored", "mixed"]),
  dominantRate: z.number(),
  expectedDifficulty: z.string(),
  confidence: z.enum(["high", "medium", "low", "insufficient"]),
  summary: z.string(),
});

export type EvidenceRatioSummary = z.infer<typeof EvidenceRatioSummarySchema>;

