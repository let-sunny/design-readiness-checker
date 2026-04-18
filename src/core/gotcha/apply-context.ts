import type { RuleId, RuleViolation } from "../contracts/rule.js";
import type { InstanceContext } from "../contracts/gotcha-survey.js";
import type { AnnotationProperty } from "../roundtrip/types.js";
import {
  isInstanceChildNodeId,
  parseInstanceChildNodeId,
} from "../adapters/instance-id-parser.js";
import { getAnnotationProperties } from "../rules/rule-config.js";

/**
 * Apply strategy for a rule violation. Tells the SKILL.md/`use_figma`
 * pipeline which Plugin-API path to take.
 *
 * - `property-mod`   — Strategy A. Direct property write on the scene/instance node.
 * - `structural-mod` — Strategy B. Structural change; ask user to confirm before applying.
 * - `annotation`     — Strategy C. Cannot be auto-fixed; record as a Figma annotation.
 * - `auto-fix`       — Strategy D. Lower-severity rules from analyze output;
 *                      may be a property write (naming) or annotation-only.
 *
 * Sibling module `resolve-apply-target.ts` solves a different concern
 * (scene-vs-definition write target). Compose them — do not merge.
 */
export type RuleApplyStrategy =
  | "property-mod"
  | "structural-mod"
  | "annotation"
  | "auto-fix";

/**
 * Pre-computed apply context attached to gotcha-survey questions and
 * analyze-output issues. Lets the SKILL.md consume the data directly
 * instead of re-deriving rule routing on every roundtrip run.
 *
 * `targetProperty` is `string` for single-property writes, `string[]`
 * for rules that require multiple writes (e.g. `irregular-spacing`
 * subType `padding` → 4 padding fields), and `undefined` for
 * annotation/structural strategies that have no single property target.
 */
export interface ApplyContext {
  applyStrategy: RuleApplyStrategy;
  targetProperty?: string | string[];
  annotationProperties?: AnnotationProperty[];
  isInstanceChild: boolean;
  sourceChildId?: string;
}

const STRATEGY_BY_RULE: Record<RuleId, RuleApplyStrategy> = {
  // Strategy A — property modification
  "no-auto-layout": "property-mod",
  "fixed-size-in-auto-layout": "property-mod",
  "missing-size-constraint": "property-mod",
  "irregular-spacing": "property-mod",
  "non-semantic-name": "property-mod",
  // Strategy B — structural modification (needs user confirmation)
  "non-layout-container": "structural-mod",
  "deep-nesting": "structural-mod",
  "missing-component": "structural-mod",
  "detached-instance": "structural-mod",
  // Strategy C — annotation only
  "absolute-position-in-auto-layout": "annotation",
  "variant-structure-mismatch": "annotation",
  // Strategy D — auto-fix lower-severity issues from analyze output
  "non-standard-naming": "auto-fix",
  "inconsistent-naming-convention": "auto-fix",
  "raw-value": "auto-fix",
  "missing-interaction-state": "auto-fix",
  "missing-prototype": "auto-fix",
};

/**
 * Resolve the Figma Plugin-API target property (or properties) for a
 * violation. Returns `undefined` for rules whose strategy does not write
 * a single property (structural-mod, annotation), or for naming auto-fixes
 * where the value comes from `violation.suggestedName` rather than a
 * specific Figma property — except the `name` write itself, which we
 * surface so SKILL.md can branch uniformly on `targetProperty === 'name'`.
 */
function resolveTargetProperty(
  ruleId: RuleId,
  subType: string | undefined,
): string | string[] | undefined {
  switch (ruleId) {
    case "no-auto-layout":
      return ["layoutMode", "itemSpacing"];
    case "fixed-size-in-auto-layout":
      if (subType === "horizontal") return "layoutSizingHorizontal";
      // both-axes — write both axes
      return ["layoutSizingHorizontal", "layoutSizingVertical"];
    case "missing-size-constraint":
      if (subType === "wrap") return "minWidth";
      if (subType === "max-width") return "maxWidth";
      // grid — both bounds
      return ["minWidth", "maxWidth"];
    case "irregular-spacing":
      if (subType === "gap") return "itemSpacing";
      // padding — all four padding fields
      return ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"];
    case "non-semantic-name":
      return "name";
    case "non-layout-container":
      return "layoutMode";
    case "non-standard-naming":
    case "inconsistent-naming-convention":
      return "name";
    case "deep-nesting":
    case "missing-component":
    case "detached-instance":
    case "absolute-position-in-auto-layout":
    case "variant-structure-mismatch":
    case "raw-value":
    case "missing-interaction-state":
    case "missing-prototype":
      return undefined;
  }
}

/**
 * Compute the deterministic apply context for a rule violation.
 *
 * - `applyStrategy` and `targetProperty` come from the ruleId/subType tables above.
 * - `isInstanceChild` and `sourceChildId` are parsed from the violation `nodeId`
 *   via `parseInstanceChildNodeId` — single source of truth for `I...;...` ids.
 * - `instanceContext`, when supplied, takes precedence for `sourceChildId` so
 *   callers that already resolved the source component (gotcha-survey) do not
 *   re-parse the id.
 *
 * Strategy D rules that target scene nodes (analyze output) can pass
 * `instanceContext: undefined` — the function still returns the parsed
 * `isInstanceChild`/`sourceChildId` so SKILL.md knows whether to walk the
 * instance fallback.
 */
export function computeApplyContext(
  violation: Pick<RuleViolation, "ruleId" | "subType" | "nodeId">,
  instanceContext?: InstanceContext,
): ApplyContext {
  const ruleId = violation.ruleId as RuleId;
  const applyStrategy = STRATEGY_BY_RULE[ruleId] ?? "annotation";
  const targetProperty = resolveTargetProperty(ruleId, violation.subType);
  const annotationProperties = getAnnotationProperties(
    ruleId,
    violation.subType,
  );

  const parsed = parseInstanceChildNodeId(violation.nodeId);
  const isInstanceChild =
    parsed !== null || isInstanceChildNodeId(violation.nodeId);
  const sourceChildId = instanceContext?.sourceNodeId ?? parsed?.sourceNodeId;

  return {
    applyStrategy,
    ...(targetProperty !== undefined ? { targetProperty } : {}),
    ...(annotationProperties !== undefined ? { annotationProperties } : {}),
    isInstanceChild,
    ...(sourceChildId !== undefined ? { sourceChildId } : {}),
  };
}
