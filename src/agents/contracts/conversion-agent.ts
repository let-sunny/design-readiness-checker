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
  "component-references",
  "node-names-hierarchy",
  "variable-references",
  "style-references",
]);

export const StripDeltaResultSchema = z.object({
  stripType: StripTypeEnum,
  baselineSimilarity: z.number(),
  strippedSimilarity: z.number(),
  delta: z.number().finite(),
  deltaDifficulty: DifficultySchema,
});

export const StripDeltasArraySchema = z.array(StripDeltaResultSchema);

export type StripDeltaResult = z.infer<typeof StripDeltaResultSchema>;

