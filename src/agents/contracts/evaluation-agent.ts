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
}

export interface EvaluationAgentOutput {
  mismatches: MismatchCase[];
  validatedRules: string[];
}
