import { z } from "zod";
import { DifficultySchema } from "./conversion-agent.js";
import { SeveritySchema } from "../../core/contracts/severity.js";

export const MismatchTypeSchema = z.enum([
  "overscored",
  "underscored",
  "missing-rule",
  "validated",
]);
export type MismatchType = z.infer<typeof MismatchTypeSchema>;

export const MismatchCaseSchema = z.object({
  type: MismatchTypeSchema,
  nodeId: z.string(),
  nodePath: z.string(),
  ruleId: z.string().optional(),
  currentScore: z.number().optional(),
  currentSeverity: SeveritySchema.optional(),
  actualDifficulty: DifficultySchema,
  reasoning: z.string(),
  category: z.string().optional(),
  description: z.string().optional(),
});

export type MismatchCase = z.infer<typeof MismatchCaseSchema>;

export interface EvaluationAgentInput {
  nodeIssueSummaries: Array<{
    nodeId: string;
    nodePath: string;
    flaggedRuleIds: string[];
  }>;
  conversionRecords: Array<{
    nodeId: string;
    nodePath: string;
    difficulty: string;
    ruleRelatedStruggles: Array<{
      ruleId: string;
      description: string;
      actualImpact: string;
    }>;
    uncoveredStruggles: Array<{
      description: string;
      suggestedCategory: string;
      estimatedImpact: string;
    }>;
  }>;
  ruleScores: Record<string, { score: number; severity: string }>;
  /**
   * Responsive viewport comparison delta (similarity - responsiveSimilarity).
   * Positive = design breaks at expanded viewport. Used to evaluate responsive-critical rules.
   * null/undefined = no responsive comparison available.
   */
  responsiveDelta?: number | null | undefined;
  /**
   * Strip ablation deltas keyed by strip type.
   * Each value = baseline similarity - stripped similarity (percentage points).
   * Positive = removing that info caused degradation. Used to objectively override AI self-assessment.
   * undefined = no strip ablation data available.
   */
  stripDeltas?: Record<string, number> | undefined;
  /**
   * Whether the conversion was whole-design (single root record covering the entire page).
   * When true, evaluation merges all nodeIssueSummaries' flaggedRuleIds into the single record
   * so rules flagged on child nodes aren't silently dropped.
   */
  wholeDesign?: boolean | undefined;
}

export interface EvaluationAgentOutput {
  mismatches: MismatchCase[];
  validatedRules: string[];
}
