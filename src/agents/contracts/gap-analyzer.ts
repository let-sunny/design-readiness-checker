import { z } from "zod";

export const GapEntrySchema = z.object({
  category: z.string(),
  description: z.string(),
  pixelImpact: z.string().optional(),
  coveredByRule: z.string().nullable().optional(),
  coveredByExistingRule: z.boolean().optional(),
  existingRule: z.string().nullable().optional(),
  causedByInterpretation: z.boolean().optional(),
  actionable: z.boolean().optional(),
  suggestedRuleCategory: z.string().optional(),
  area: z.string().optional(),
});

export type GapEntry = z.infer<typeof GapEntrySchema>;

export const GapAnalyzerOutputSchema = z.object({
  fixture: z.string().optional(),
  similarity: z.number().optional(),
  timestamp: z.string().optional(),
  gaps: z.array(GapEntrySchema),
  summary: z
    .object({
      totalGaps: z.number(),
      actionableGaps: z.number(),
      coveredByExistingRules: z.number(),
      newRuleCandidates: z.number(),
      renderingArtifacts: z.number(),
    })
    .optional(),
  newRuleSuggestions: z
    .array(
      z.object({
        ruleId: z.string(),
        rationale: z.string().optional(),
      })
    )
    .optional(),
});

export type GapAnalyzerOutput = z.infer<typeof GapAnalyzerOutputSchema>;
