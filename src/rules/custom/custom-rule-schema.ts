import { z } from "zod";
import { CategorySchema } from "../../contracts/category.js";
import { SeveritySchema } from "../../contracts/severity.js";

export const CustomRuleSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  score: z.number().int().max(0),
  prompt: z.string(),
  why: z.string(),
  impact: z.string(),
  fix: z.string(),
});

export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const CustomRulesFileSchema = z.array(CustomRuleSchema);
