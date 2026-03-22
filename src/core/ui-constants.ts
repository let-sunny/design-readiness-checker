// Shared UI constants — single source of truth for report-html (Node) and app/shared (browser)

import type { Category } from "./contracts/category.js";
import type { Severity } from "./contracts/severity.js";

// Re-export category/severity constants that already exist
export { CATEGORIES, CATEGORY_LABELS } from "./contracts/category.js";
export { SEVERITY_LABELS } from "./contracts/severity.js";

// Gauge geometry
export const GAUGE_R = 54;
export const GAUGE_C = Math.round(2 * Math.PI * GAUGE_R); // ~339

export const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  layout:
    "Auto Layout, responsive constraints, nesting depth, absolute positioning",
  token: "Design token binding for colors, fonts, shadows, spacing grid",
  component: "Component reuse, detached instances, variant coverage",
  naming: "Semantic layer names, naming conventions, default names",
  "ai-readability":
    "Structure clarity for AI code generation, z-index, empty frames",
  "handoff-risk":
    "Hardcoded values, text truncation, image placeholders, dev status",
};

export const SEVERITY_ORDER: Severity[] = [
  "blocking",
  "risk",
  "missing-info",
  "suggestion",
];
