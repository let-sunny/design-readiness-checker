import { z } from "zod";

export const CategorySchema = z.enum([
  "pixel-critical",
  "responsive-critical",
  "code-quality",
  "token-management",
  "interaction",
  "minor",
]);

export type Category = z.infer<typeof CategorySchema>;

export const CATEGORIES = CategorySchema.options;

export const CATEGORY_LABELS: Record<Category, string> = {
  "pixel-critical": "Pixel Critical",
  "responsive-critical": "Responsive Critical",
  "code-quality": "Code Quality",
  "token-management": "Token Management",
  "interaction": "Interaction",
  "minor": "Minor",
};
