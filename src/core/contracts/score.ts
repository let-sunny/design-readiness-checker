import { z } from "zod";
import { CategorySchema } from "./category.js";

export const CategoryScoreSchema = z.object({
  category: CategorySchema,
  score: z.number().min(0).max(100),
  maxScore: z.number().min(0).max(100),
  issueCount: z.object({
    error: z.number().int().min(0),
    warning: z.number().int().min(0),
    info: z.number().int().min(0),
  }),
});

export type CategoryScore = z.infer<typeof CategoryScoreSchema>;
