import { z } from "zod";
import { SeveritySchema } from "./severity.js";

const GradeSchema = z.enum(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]);

export const InstanceContextSchema = z.object({
  parentInstanceNodeId: z.string(),
  sourceNodeId: z.string(),
  sourceComponentId: z.string().optional(),
  sourceComponentName: z.string().optional(),
});

export type InstanceContext = z.infer<typeof InstanceContextSchema>;

/**
 * Apply-strategy enum surfaced on survey questions and analyze-output issues.
 * Mirrors `RuleApplyStrategy` in `src/core/gotcha/apply-context.ts` —
 * declared as a Zod enum here so MCP responses validate end-to-end.
 */
export const RuleApplyStrategySchema = z.enum([
  "property-mod",
  "structural-mod",
  "annotation",
  "auto-fix",
]);

export type RuleApplyStrategy = z.infer<typeof RuleApplyStrategySchema>;

const TargetPropertySchema = z.union([z.string(), z.array(z.string())]);

/**
 * Mirrors the `AnnotationProperty` interface in `src/core/roundtrip/types.ts`.
 * Declared here per the project's Zod convention (schemas live in contracts/)
 * so MCP responses validate end-to-end.
 */
export const AnnotationPropertySchema = z.object({ type: z.string() });

export const GotchaSurveyQuestionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  question: z.string(),
  hint: z.string(),
  example: z.string(),
  instanceContext: InstanceContextSchema.optional(),
  applyStrategy: RuleApplyStrategySchema,
  targetProperty: TargetPropertySchema.optional(),
  annotationProperties: z.array(AnnotationPropertySchema).optional(),
  suggestedName: z.string().optional(),
  isInstanceChild: z.boolean(),
  sourceChildId: z.string().optional(),
});

export type GotchaSurveyQuestion = z.infer<typeof GotchaSurveyQuestionSchema>;

export const GotchaSurveySchema = z.object({
  designGrade: GradeSchema,
  isReadyForCodeGen: z.boolean(),
  questions: z.array(GotchaSurveyQuestionSchema),
});

export type GotchaSurvey = z.infer<typeof GotchaSurveySchema>;
