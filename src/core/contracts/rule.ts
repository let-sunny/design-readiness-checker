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
  nodeId: string;
  nodePath: string;
  message: string;
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
  // Layout (11)
  | "no-auto-layout"
  | "absolute-position-in-auto-layout"
  | "fixed-width-in-responsive-context"
  | "missing-responsive-behavior"
  | "group-usage"
  | "fixed-size-in-auto-layout"
  | "missing-min-width"
  | "missing-max-width"
  | "deep-nesting"
  // Token (7)
  | "raw-color"
  | "raw-font"
  | "inconsistent-spacing"
  | "magic-number-spacing"
  | "raw-shadow"
  | "raw-opacity"
  | "multiple-fill-colors"
  // Component (4)
  | "missing-component"
  | "detached-instance"
  | "variant-not-used"
  | "missing-component-description"
  // Naming (5)
  | "default-name"
  | "non-semantic-name"
  | "inconsistent-naming-convention"
  | "numeric-suffix-name"
  | "too-long-name"
  // AI Readability (5)
  | "ambiguous-structure"
  | "z-index-dependent-layout"
  | "missing-layout-hint"
  | "invisible-layer"
  | "empty-frame"
  // Handoff Risk (5)
  | "hardcode-risk"
  | "text-truncation-unhandled"
  | "prototype-link-in-design";

/**
 * Categories that support depthWeight
 */
export const DEPTH_WEIGHT_CATEGORIES: Category[] = ["layout", "handoff-risk"];

/**
 * Check if a category supports depth weighting
 */
export function supportsDepthWeight(category: Category): boolean {
  return DEPTH_WEIGHT_CATEGORIES.includes(category);
}
