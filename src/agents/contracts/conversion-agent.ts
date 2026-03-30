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
  baselineResponsiveSimilarity: z.number().nullable().optional(),
  strippedResponsiveSimilarity: z.number().nullable().optional(),
  responsiveDelta: z.number().nullable().optional(),
  responsiveViewport: z.number().nullable().optional(),
  // Input tokens (design-tree token count)
  baselineInputTokens: z.number().optional(),
  strippedInputTokens: z.number().optional(),
  tokenDelta: z.number().optional(),
  // HTML output size
  baselineHtmlBytes: z.number().optional(),
  strippedHtmlBytes: z.number().optional(),
  htmlBytesDelta: z.number().optional(),
  // CSS metrics
  baselineCssClassCount: z.number().optional(),
  strippedCssClassCount: z.number().optional(),
  baselineCssVariableCount: z.number().optional(),
  strippedCssVariableCount: z.number().optional(),
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

