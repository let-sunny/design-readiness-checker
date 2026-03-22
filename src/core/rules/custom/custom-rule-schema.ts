import { z } from "zod";
import { CategorySchema } from "../../contracts/category.js";
import { SeveritySchema } from "../../contracts/severity.js";

export const MatchConditionSchema = z.object({
  // Node type conditions
  type: z.array(z.string()).optional(),
  notType: z.array(z.string()).optional(),

  // Name conditions (case-insensitive, substring match)
  nameContains: z.string().optional(),
  nameNotContains: z.string().optional(),
  namePattern: z.string().optional(),

  // Size conditions
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),

  // Layout conditions
  hasAutoLayout: z.boolean().optional(),
  hasChildren: z.boolean().optional(),
  minChildren: z.number().optional(),
  maxChildren: z.number().optional(),

  // Component conditions
  isComponent: z.boolean().optional(),
  isInstance: z.boolean().optional(),
  hasComponentId: z.boolean().optional(),

  // Visibility
  isVisible: z.boolean().optional(),

  // Fill/style conditions
  hasFills: z.boolean().optional(),
  hasStrokes: z.boolean().optional(),
  hasEffects: z.boolean().optional(),

  // Depth condition
  minDepth: z.number().optional(),
  maxDepth: z.number().optional(),
});

export type MatchCondition = z.infer<typeof MatchConditionSchema>;

export const CustomRuleSchema = z.object({
  id: z.string(),
  category: CategorySchema,
  severity: SeveritySchema,
  score: z.number().int().max(0),
  match: MatchConditionSchema,
  message: z.string().optional(),
  why: z.string(),
  impact: z.string(),
  fix: z.string(),
  // Backward compat: silently ignore the old prompt field
  prompt: z.string().optional(),
});

export type CustomRule = z.infer<typeof CustomRuleSchema>;

export const CustomRulesFileSchema = z.array(CustomRuleSchema);
