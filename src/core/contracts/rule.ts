import { z } from "zod";
import type { Acknowledgment } from "./acknowledgment.js";
import type { AnalysisScope } from "./analysis-scope.js";
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
  /**
   * #404: Scope of the analysis root (`page` vs `component`). Rules use
   * this to decide whether expectations like "container must define
   * bounds" or "repetition should become a component" apply. Constant for
   * all nodes in a single analysis — whether the CURRENT node happens to
   * be a `COMPONENT` descendant of a page root is already signalled by
   * `componentDepth`, not by re-deriving scope per node.
   */
  scope: AnalysisScope;
  /**
   * #403: Figma node type of the analysis root, captured once in
   * `RuleEngine.analyze`. This is an *axis orthogonal to* `scope`:
   * `scope === "component"` does not tell a rule whether the root is a
   * `COMPONENT`/`COMPONENT_SET` (component being audited) or an
   * `INSTANCE` (component being used, possibly with overrides). The
   * `missing-size-constraint` redesign needs that distinction so the
   * gotcha question can ask the right thing — "intentionally
   * non-responsive?" vs "override intended? original may be FILL". The
   * value is the raw Figma node type string (no new enum) so it stays in
   * sync with `AnalysisNode.type` without a translation layer.
   */
  rootNodeType: string;
  /**
   * ADR-022: lookup canicode-authored acknowledgments by `(nodeId, ruleId)`.
   * The rule engine builds this from `RuleEngineOptions.acknowledgments` and
   * exposes it to every rule so individual rules can short-circuit (suppress
   * emission) when an acknowledgment carries a rule-opt-out intent. The
   * existing density-half-weight semantic (#371) is unchanged — that path
   * still flags `acknowledged: true` post-emit and is independent of this
   * helper.
   *
   * Returns the matching acknowledgment, or `undefined` when there is no
   * acknowledgment for the pair. Node ids are normalised by the engine, so
   * callers can pass URL-style or Plugin-API-style ids interchangeably.
   */
  findAcknowledgment: (nodeId: string, ruleId: string) => Acknowledgment | undefined;
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
  /**
   * Pre-computed name to write to `node.name` in Figma — populated by naming
   * rules whose suggestion is a deterministic function of the node's existing
   * state (`non-standard-naming`, `inconsistent-naming-convention`).
   * Capitalized for direct Plugin-API use; the human-readable `suggestion`
   * string keeps lowercase prose.
   */
  suggestedName?: string;
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
  | "unmapped-component"
  // Token Management — raw values without design tokens
  | "raw-value"
  | "irregular-spacing"
  // Interaction — missing state variants and prototype links for interactive components
  | "missing-interaction-state"
  | "missing-prototype"
  // Semantic — naming issues with negligible pixel impact (ΔV < 2%)
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
