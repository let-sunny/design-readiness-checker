import { z } from "zod";

export const CategorySchema = z.enum([
  "layout",
  "token",
  "component",
  "naming",
  "ai-readability",
  "handoff-risk",
]);

export type Category = z.infer<typeof CategorySchema>;

export const CATEGORIES = CategorySchema.options;

export const CATEGORY_LABELS: Record<Category, string> = {
  layout: "Layout",
  token: "Design Token",
  component: "Component",
  naming: "Naming",
  "ai-readability": "AI Readability",
  "handoff-risk": "Handoff Risk",
};
