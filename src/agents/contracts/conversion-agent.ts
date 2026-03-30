import { z } from "zod";

export const DifficultySchema = z.enum(["easy", "moderate", "hard", "failed"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const RuleRelatedStruggleSchema = z.object({
  ruleId: z.string(),
  description: z.string(),
  actualImpact: DifficultySchema,
});

export type RuleRelatedStruggle = z.infer<typeof RuleRelatedStruggleSchema>;

export const UncoveredStruggleSchema = z.object({
  description: z.string(),
  suggestedCategory: z.string(),
  estimatedImpact: DifficultySchema,
});

export type UncoveredStruggle = z.infer<typeof UncoveredStruggleSchema>;

export const ConversionRecordSchema = z.object({
  nodeId: z.string(),
  nodePath: z.string(),
  generatedCode: z.string(),
  difficulty: DifficultySchema,
  notes: z.string(),
  ruleRelatedStruggles: z.array(RuleRelatedStruggleSchema),
  uncoveredStruggles: z.array(UncoveredStruggleSchema),
  durationMs: z.number(),
});

export type ConversionRecord = z.infer<typeof ConversionRecordSchema>;

export const StripTypeEnum = z.enum([
  "layout-direction-spacing",
  "size-constraints",
  "component-references",
  "node-names-hierarchy",
  "variable-references",
  "style-references",
]);

export const StripDeltaResultSchema = z.object({
  stripType: StripTypeEnum,
  // Pixel similarity (design viewport)
  baselineSimilarity: z.number(),
  strippedSimilarity: z.number(),
  delta: z.number().finite(),
  deltaDifficulty: DifficultySchema,
  // Responsive similarity (expanded viewport — primarily for size-constraints)
  baselineResponsiveSimilarity: z.number().finite().nullable().optional(),
  strippedResponsiveSimilarity: z.number().finite().nullable().optional(),
  responsiveDelta: z.number().finite().nullable().optional(),
  responsiveViewport: z.number().int().positive().nullable().optional(),
  // Input tokens (design-tree token count)
  baselineInputTokens: z.number().int().nonnegative().optional(),
  strippedInputTokens: z.number().int().nonnegative().optional(),
  tokenDelta: z.number().int().optional(),
  // HTML output size
  baselineHtmlBytes: z.number().int().nonnegative().optional(),
  strippedHtmlBytes: z.number().int().nonnegative().optional(),
  htmlBytesDelta: z.number().int().optional(),
  // CSS metrics
  baselineCssClassCount: z.number().int().nonnegative().optional(),
  strippedCssClassCount: z.number().int().nonnegative().optional(),
  baselineCssVariableCount: z.number().int().nonnegative().optional(),
  strippedCssVariableCount: z.number().int().nonnegative().optional(),
});

export const StripDeltasArraySchema = z.array(StripDeltaResultSchema);

export type StripDeltaResult = z.infer<typeof StripDeltaResultSchema>;

export const RuleImpactAssessmentSchema = z.array(
  z.object({
    ruleId: z.string(),
    issueCount: z.number(),
    actualImpact: z.string(),
    description: z.string(),
  })
);

export const UncoveredStrugglesInputSchema = z.array(
  z.object({
    description: z.string(),
    suggestedCategory: z.string(),
    estimatedImpact: z.string(),
  })
);

