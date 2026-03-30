import { z } from "zod";
import { CategorySchema, type Category } from "./category.js";
import { SeveritySchema } from "./severity.js";
import type { AnalysisFile, AnalysisNode } from "./figma-node.js";

/**
 * Rule definition - static metadata (does not change)
 */
export const RuleDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: CategorySchema,
  why: z.string(),
  impact: z.string(),
  fix: z.string(),
});

export type RuleDefinition = z.infer<typeof RuleDefinitionSchema>;

/**
 * Rule config - adjustable settings (can be modified via presets)
 */
export const RuleConfigSchema = z.object({
  severity: SeveritySchema,
  score: z.number().int().max(0),
  depthWeight: z.number().min(1).max(2).optional(),
  enabled: z.boolean().default(true),
  options: z.record(z.string(), z.unknown()).optional(),
});

export type RuleConfig = z.infer<typeof RuleConfigSchema>;

/**
 * Context passed to rule check functions
 */
export interface RuleContext {
  file: AnalysisFile;
  parent?: AnalysisNode | undefined;
  depth: number;
  /** Depth relative to the nearest COMPONENT/INSTANCE ancestor. Resets at component boundaries. */
  componentDepth: number;
  maxDepth: number;
  path: string[];
  /** Ancestor node types from root to parent (excludes current node). */
  ancestorTypes: string[];
  siblings?: AnalysisNode[] | undefined;
  /** Per-analysis shared state. Created fresh for each analysis run, eliminating module-level mutable state. */
  analysisState: Map<string, unknown>;
}

/**
 * Get or initialize per-analysis state for a rule.
 * Each key gets its own lazily-initialized state that persists for the duration of one analysis run.
 */
export function getAnalysisState<T>(context: RuleContext, key: string, init: () => T): T {
  if (context.analysisState.has(key)) {
    return context.analysisState.get(key) as T;
  }
  const value = init();
  context.analysisState.set(key, value);
  return value;
}

/**
 * Rule violation result from check function
 */
export interface RuleViolation {
  ruleId: string;
  subType?: string;
  nodeId: string;
  nodePath: string;
  message: string;
  suggestion: string;
  guide?: string;
}

/**
 * Rule check function signature
 */
export type RuleCheckFn = (
  node: AnalysisNode,
  context: RuleContext,
  options?: Record<string, unknown>
) => RuleViolation | null;

/**
 * Complete rule with definition, config, and check function
 */
export interface Rule {
  definition: RuleDefinition;
  check: RuleCheckFn;
}

/**
 * Rule ID type for type safety
 */
export type RuleId =
  // Pixel Critical — layout issues that directly affect pixel accuracy (ΔV ≥ 5%)
  | "no-auto-layout"
  | "absolute-position-in-auto-layout"
  | "non-layout-container"
  // Responsive Critical — size issues that break at different viewports (ΔV ≥ 15%)
  | "fixed-size-in-auto-layout"
  | "missing-size-constraint"
  // Code Quality — structural issues affecting code reuse (ΔV ≈ 0%, CSS classes -8~15)
  | "missing-component"
  | "detached-instance"
  | "variant-structure-mismatch"
  | "deep-nesting"
  // Token Management — raw values without design tokens
  | "raw-value"
  | "irregular-spacing"
  // Interaction — missing state variants and prototype links for interactive components
  | "missing-interaction-state"
  | "missing-prototype"
  // Minor — naming issues with negligible impact (ΔV < 2%)
  | "non-standard-naming"
  | "non-semantic-name"
  | "inconsistent-naming-convention";

/**
 * Categories that support depthWeight
 */
export const DEPTH_WEIGHT_CATEGORIES: Category[] = ["pixel-critical", "responsive-critical"];

/**
 * Check if a category supports depth weighting
 */
export function supportsDepthWeight(category: Category): boolean {
  return DEPTH_WEIGHT_CATEGORIES.includes(category);
}
