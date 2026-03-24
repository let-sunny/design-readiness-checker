import { z } from "zod";
import { SeveritySchema } from "@/core/contracts/severity.js";
import type { CrossRunEvidence } from "./evidence.js";

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const ScoreAdjustmentSchema = z.object({
  ruleId: z.string(),
  currentScore: z.number(),
  proposedScore: z.number(),
  currentSeverity: SeveritySchema,
  proposedSeverity: SeveritySchema.optional(),
  reasoning: z.string(),
  confidence: ConfidenceSchema,
  supportingCases: z.number(),
});

export type ScoreAdjustment = z.infer<typeof ScoreAdjustmentSchema>;

export const NewRuleProposalSchema = z.object({
  suggestedId: z.string(),
  category: z.string(),
  description: z.string(),
  suggestedSeverity: SeveritySchema,
  suggestedScore: z.number(),
  reasoning: z.string(),
  supportingCases: z.number(),
});

export type NewRuleProposal = z.infer<typeof NewRuleProposalSchema>;

export interface TuningAgentInput {
  mismatches: Array<{
    type: string;
    nodeId: string;
    nodePath: string;
    ruleId?: string | undefined;
    currentScore?: number | undefined;
    currentSeverity?: string | undefined;
    actualDifficulty: string;
    reasoning: string;
  }>;
  ruleScores: Record<string, { score: number; severity: string }>;
  priorEvidence?: CrossRunEvidence;
}

export interface TuningAgentOutput {
  adjustments: ScoreAdjustment[];
  newRuleProposals: NewRuleProposal[];
}
