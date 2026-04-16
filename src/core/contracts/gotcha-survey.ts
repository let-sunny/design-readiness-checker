import { z } from "zod";
import { SeveritySchema } from "./severity.js";

const GradeSchema = z.enum(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]);

export const GotchaSurveyQuestionSchema = z.object({
  nodeId: z.string(),
  nodeName: z.string(),
  ruleId: z.string(),
  severity: SeveritySchema,
  question: z.string(),
  hint: z.string(),
  example: z.string(),
});

export type GotchaSurveyQuestion = z.infer<typeof GotchaSurveyQuestionSchema>;

export const GotchaSurveySchema = z.object({
  designGrade: GradeSchema,
  isReadyForCodeGen: z.boolean(),
  questions: z.array(GotchaSurveyQuestionSchema),
});

export type GotchaSurvey = z.infer<typeof GotchaSurveySchema>;
