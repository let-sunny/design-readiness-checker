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
  "pixel-critical":
    "Auto Layout, absolute positioning, group usage — layout issues that directly affect pixel accuracy",
  "responsive-critical":
    "Fixed sizing, size constraints, responsive behavior — issues that break at different viewports",
  "code-quality":
    "Component reuse, detached instances, variant structure, nesting depth",
  "token-management":
    "Design token binding for colors, fonts, shadows, opacity, spacing grid",
  "interaction":
    "State variants for interactive components — hover, disabled, active, focus",
  "minor":
    "Semantic layer names, naming conventions, default names",
};

export const SEVERITY_ORDER: Severity[] = [
  "blocking",
  "risk",
  "missing-info",
  "suggestion",
];
