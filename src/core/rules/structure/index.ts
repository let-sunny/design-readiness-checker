import type { AnalysisNode } from "../../contracts/figma-node.js";
import type { RuleCheckFn, RuleContext, RuleDefinition, RuleViolation } from "../../contracts/rule.js";
import { getAnalysisState } from "../../contracts/rule.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";
import { isAutoLayoutExempt, isAbsolutePositionExempt, isFixedSizeExempt } from "../rule-exceptions.js";
import { noAutoLayoutMsg, absolutePositionMsg, fixedSizeMsg, missingSizeConstraintMsg, nonLayoutContainerMsg, deepNestingMsg } from "../rule-messages.js";
import { isContainerNode, hasAutoLayout, hasOverlappingBounds } from "../node-semantics.js";

// ============================================
// no-auto-layout (merged: absorbs ambiguous-structure + missing-layout-hint)
// ============================================

const noAutoLayoutDef: RuleDefinition = {
  id: "no-auto-layout",
  name: "No Auto Layout",
  category: "pixel-critical",
  why: "Without Auto Layout, AI must guess positioning from absolute coordinates instead of reading explicit layout rules",
  impact: "Generated code uses hardcoded positions that break on any content or screen size change",
  fix: "Apply Auto Layout to create clear, explicit structure — enables AI to generate flexbox/grid instead of absolute positioning",
};

const noAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  if (hasAutoLayout(node)) return null;
  if (!node.children || node.children.length === 0) return null;

  if (isAutoLayoutExempt(node)) return null;

  // Priority 1: Check for overlapping visible children (ambiguous-structure)
  if (node.children.length >= 2) {
    for (let i = 0; i < node.children.length; i++) {
      for (let j = i + 1; j < node.children.length; j++) {
        const childA = node.children[i];
        const childB = node.children[j];
        if (!childA || !childB) continue;

        if (hasOverlappingBounds(childA, childB)) {
          if (childA.visible !== false && childB.visible !== false) {
            return {
              ruleId: noAutoLayoutDef.id,
              subType: "overlapping" as const,
              nodeId: node.id,
              nodePath: context.path.join(" > "),
              ...noAutoLayoutMsg.overlapping(node.name),
            };
          }
        }
      }
    }
  }

  // Priority 2: Check for nested containers without layout hints (missing-layout-hint)
  if (node.children.length >= 2) {
    const nestedContainers = node.children.filter((c) => isContainerNode(c));
    if (nestedContainers.length >= 2) {
      const withoutLayout = nestedContainers.filter((c) => !hasAutoLayout(c));
      if (withoutLayout.length >= 2) {
        return {
          ruleId: noAutoLayoutDef.id,
          subType: "nested" as const,
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          ...noAutoLayoutMsg.nested(node.name),
        };
      }
    }
  }

  // Priority 3: Basic no-auto-layout check (FRAME only)
  if (node.type !== "FRAME") return null;

  const childCount = node.children?.length ?? 0;
  let directionHint = "";
  if (node.children && node.children.length >= 2) {
    const boxes = node.children.filter(c => c.absoluteBoundingBox).map(c => c.absoluteBoundingBox!);
    if (boxes.length >= 2) {
      const yRange = Math.max(...boxes.map(b => b.y)) - Math.min(...boxes.map(b => b.y));
      const xRange = Math.max(...boxes.map(b => b.x)) - Math.min(...boxes.map(b => b.x));
      directionHint = yRange > xRange ? "VERTICAL" : "HORIZONTAL";
    }
  }

  const arrangement = directionHint
    ? ` (${childCount} children arranged ${directionHint.toLowerCase()}ly)`
    : childCount > 0 ? ` (${childCount} children)` : "";

  return {
    ruleId: noAutoLayoutDef.id,
    subType: "basic" as const,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...noAutoLayoutMsg.basic(node.name, arrangement, directionHint),
  };
};

export const noAutoLayout = defineRule({
  definition: noAutoLayoutDef,
  check: noAutoLayoutCheck,
});

// ============================================
// absolute-position-in-auto-layout
// ============================================

const absolutePositionInAutoLayoutDef: RuleDefinition = {
  id: "absolute-position-in-auto-layout",
  name: "Absolute Position in Auto Layout",
  category: "pixel-critical",
  why: "Absolute positioning inside Auto Layout contradicts the parent's layout rules — AI sees conflicting instructions",
  impact: "AI must decide whether to follow the parent's flexbox or the child's absolute position — often gets it wrong",
  fix: "Remove absolute positioning or use proper Auto Layout alignment",
};

const absolutePositionInAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  if (node.layoutPositioning !== "ABSOLUTE") return null;

  if (isAbsolutePositionExempt(node)) return null;

  return {
    ruleId: absolutePositionInAutoLayoutDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...absolutePositionMsg(node.name, context.parent.name),
  };
};

export const absolutePositionInAutoLayout = defineRule({
  definition: absolutePositionInAutoLayoutDef,
  check: absolutePositionInAutoLayoutCheck,
});

// ============================================
// fixed-size-in-auto-layout (merged: absorbs fixed-width-in-responsive-context)
// ============================================

const fixedSizeInAutoLayoutDef: RuleDefinition = {
  id: "fixed-size-in-auto-layout",
  name: "Fixed Size in Auto Layout",
  category: "responsive-critical",
  why: "Fixed sizing inside Auto Layout contradicts the flexible layout intent",
  impact: "AI generates a rigid element inside a flex container — the layout won't respond to content changes",
  fix: "Use 'Hug' or 'Fill' for at least one axis. Both-axes FIXED → layout completely rigid; horizontal-only FIXED → width won't adapt to parent resize",
};

const fixedSizeInAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  if (!isContainerNode(node)) return null;
  if (!node.absoluteBoundingBox) return null;

  if (isFixedSizeExempt(node)) return null;

  const { width, height } = node.absoluteBoundingBox;

  // Check both axes FIXED (stronger case)
  const hFixed =
    node.layoutSizingHorizontal === "FIXED" || node.layoutSizingHorizontal === undefined;
  const vFixed =
    node.layoutSizingVertical === "FIXED" || node.layoutSizingVertical === undefined;

  if (hFixed && vFixed) {
    // Skip if it has its own auto-layout
    if (node.layoutMode && node.layoutMode !== "NONE") return null;

    return {
      ruleId: fixedSizeInAutoLayoutDef.id,
      subType: "both-axes" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...fixedSizeMsg.bothAxes(node.name, width, height),
    };
  }

  // Check horizontal-only FIXED (lighter case, from fixed-width-in-responsive-context)
  if (hFixed && !vFixed) {
    // Use layoutSizingHorizontal if available (accurate)
    if (node.layoutSizingHorizontal) {
      if (node.layoutSizingHorizontal !== "FIXED") return null;
    } else {
      // Fallback: STRETCH means fill, skip
      if (node.layoutAlign === "STRETCH") return null;
      if (node.layoutAlign !== "INHERIT") return null;
    }

    return {
      ruleId: fixedSizeInAutoLayoutDef.id,
      subType: "horizontal" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...fixedSizeMsg.horizontal(node.name, width),
    };
  }

  return null;
};

export const fixedSizeInAutoLayout = defineRule({
  definition: fixedSizeInAutoLayoutDef,
  check: fixedSizeInAutoLayoutCheck,
});

// ============================================
// missing-size-constraint (#403 redesign — scope-aware, info-collection)
// ============================================
//
// Pre-#403 this rule fired on every FILL container with no max-width
// regardless of whether an ancestor already established a bound, and
// scored -8/risk. The redesign narrows it to genuinely ambiguous sizing
// situations and reframes the output as a gotcha rather than a
// violation (per ADR-017 channel separation):
//
//   page scope:
//     - container FRAME/SECTION with FILL width AND no chain-bound
//       ancestor (chain-bound = FIXED width OR FILL/HUG with explicit
//       min/max). Fires `page-container-unbound` — designer intent
//       (stretch with screen vs. cap at content) is structurally
//       undecidable.
//     - INSTANCE with FIXED width inside an Auto Layout parent. Fires
//       `page-instance-fixed` — could be intentional override or a stale
//       size carried over from the component definition.
//
//   component scope:
//     - the analysis root (and only the root — internal nodes pass)
//       with FIXED width. Fires `component-fixed-by-design` for
//       COMPONENT/COMPONENT_SET roots, `component-fixed-by-override`
//       for INSTANCE roots — same shape, different gotcha framing.
//
// Deliberately scoped out (see PR body):
//   - INSTANCE FIXED outside Auto Layout — `no-auto-layout` already
//     owns the score channel on the non-auto-layout parent. Firing
//     here too would double-penalize one structural concern.
//   - Nodes inside an INSTANCE — Plugin API silently ignores min/max
//     overrides on instance internal nodes, so the gotcha would be
//     un-actionable.
//   - Height axis — width is the dominant responsive concern; height
//     redesign deferred to a follow-up issue.

const missingSizeConstraintDef: RuleDefinition = {
  id: "missing-size-constraint",
  name: "Missing Size Constraint",
  category: "responsive-critical",
  why: "Width sizing without explicit bounds (FIXED root or FILL chained to a bounded ancestor) is structurally indistinguishable from missing information — AI cannot tell whether the designer intended responsive stretching, a fixed cap, or simply forgot to set min/max",
  impact: "Generated code either guesses hard-coded widths or omits responsive constraints; either way the runtime layout drifts from the design intent at viewports the designer never explicitly considered",
  fix: "Answer the gotcha to declare intent (responsive vs. fixed-by-design vs. instance override), then encode the answer in Figma sizing — FILL/HUG with min/max for responsive bounds, FIXED only when intentionally non-responsive",
};

// ── Chain-bound walker (memoized via analysisState) ──────────────────────
//
// "Chain-bound" = some ancestor in the analysis tree (root included)
// resolves the width chain by either fixing the width or capping a
// FILL with min/max. Computed lazily as the rule visits each node:
// because traverseAndCheck runs the check fn parent-first, by the time
// a child asks `parentChainBound(child)` the parent's entry is already
// in the cache. The side-effect MUST run for every visited node — see
// `recordChainBound` call placement below.

type ChainBoundCache = Map<string, boolean>;
const CHAIN_BOUND_KEY = "missing-size-constraint:chain-bound";

function getChainBoundCache(context: RuleContext): ChainBoundCache {
  return getAnalysisState(context, CHAIN_BOUND_KEY, () => new Map<string, boolean>());
}

function establishesOwnWidthBound(node: AnalysisNode): boolean {
  if (node.layoutSizingHorizontal === "FIXED") return true;
  if (node.minWidth !== undefined || node.maxWidth !== undefined) return true;
  return false;
}

function recordChainBound(context: RuleContext, node: AnalysisNode): boolean {
  const cache = getChainBoundCache(context);
  const cached = cache.get(node.id);
  if (cached !== undefined) return cached;
  const own = establishesOwnWidthBound(node);
  const parent = context.parent;
  const inherited = parent ? cache.get(parent.id) ?? false : false;
  const result = own || inherited;
  cache.set(node.id, result);
  return result;
}

function parentChainBound(context: RuleContext): boolean {
  if (!context.parent) return false;
  return getChainBoundCache(context).get(context.parent.id) ?? false;
}

// ── Subtype dispatchers ──────────────────────────────────────────────────

const PAGE_CONTAINER_FRAME_TYPES = new Set(["FRAME", "SECTION"]);

function formatWidth(node: AnalysisNode): string {
  return node.absoluteBoundingBox ? `${node.absoluteBoundingBox.width}px` : "unknown";
}

function buildViolation(
  subType: "page-container-unbound" | "page-instance-fixed" | "component-fixed-by-design" | "component-fixed-by-override",
  node: AnalysisNode,
  context: RuleContext,
  msg: { message: string; suggestion: string; guide?: string }
): RuleViolation {
  return {
    ruleId: missingSizeConstraintDef.id,
    subType,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...msg,
  };
}

function checkComponentScopeRoot(
  node: AnalysisNode,
  context: RuleContext
): RuleViolation | null {
  // Only the analysis root in component scope — internal nodes pass.
  // Variants of a COMPONENT_SET sit at depth=1 and are intentionally
  // skipped; variant-level sizing is the variant-structure-mismatch
  // rule's concern, not this one.
  if (context.depth !== 0) return null;
  if (node.layoutSizingHorizontal !== "FIXED") return null;

  const currentWidth = formatWidth(node);
  if (context.rootNodeType === "INSTANCE") {
    return buildViolation(
      "component-fixed-by-override",
      node,
      context,
      missingSizeConstraintMsg.componentFixedByOverride(node.name, currentWidth),
    );
  }
  // COMPONENT, COMPONENT_SET, or scope-overridden FRAME treated as a
  // component definition. The gotcha framing is identical — "is this
  // intentionally non-responsive?" — so they share the subtype.
  return buildViolation(
    "component-fixed-by-design",
    node,
    context,
    missingSizeConstraintMsg.componentFixedByDesign(node.name, currentWidth),
  );
}

function checkPageInstanceFixed(
  node: AnalysisNode,
  context: RuleContext
): RuleViolation | null {
  if (node.type !== "INSTANCE") return null;
  if (node.layoutSizingHorizontal !== "FIXED") return null;

  // Scope-out (#403): when the parent is not Auto Layout,
  // `no-auto-layout` already fires on that parent and owns the score
  // channel for the structural problem. Adding a sizing gotcha on top
  // double-counts one underlying issue. The leak case
  // (INSTANCE direct child of a SECTION page-root, where
  // no-auto-layout's behavior on SECTION is ambiguous) will surface in
  // Phase 4's fire-rate gate; revisit then if it actually appears.
  if (!context.parent || !hasAutoLayout(context.parent)) return null;

  const currentWidth = formatWidth(node);
  return buildViolation(
    "page-instance-fixed",
    node,
    context,
    missingSizeConstraintMsg.pageInstanceFixed(node.name, currentWidth),
  );
}

function checkPageContainerUnbound(
  node: AnalysisNode,
  context: RuleContext
): RuleViolation | null {
  if (!PAGE_CONTAINER_FRAME_TYPES.has(node.type)) return null;
  if (node.layoutSizingHorizontal !== "FILL") return null;
  // Some ancestor already establishes the width bound for this chain —
  // the FILL here will resolve to a finite range, no ambiguity.
  if (parentChainBound(context)) return null;

  const currentWidth = formatWidth(node);
  return buildViolation(
    "page-container-unbound",
    node,
    context,
    missingSizeConstraintMsg.pageContainerUnbound(node.name, currentWidth),
  );
}

const missingSizeConstraintCheck: RuleCheckFn = (node, context) => {
  // Side-effect: record this node's chain-bound status for descendants.
  // MUST run for every visited node BEFORE any early return, otherwise
  // `parentChainBound` lookups on children will miss and silently
  // default to `false`. Co-locating the recorder with the only consumer
  // (this rule) keeps the cache contract local.
  recordChainBound(context, node);

  // Actionability filter (#403, D6): the Figma Plugin API silently
  // ignores min/max writes targeting nodes inside an INSTANCE, so any
  // gotcha generated here would be un-actionable. We exclude INSTANCE
  // descendants (but keep the INSTANCE node itself in scope — that's
  // the page-instance-fixed case, where the override IS actionable).
  if (context.ancestorTypes.includes("INSTANCE")) return null;

  if (context.scope === "component") {
    return checkComponentScopeRoot(node, context);
  }

  // page scope — at most one of these fires per node by construction
  // (different node-type predicates), so order does not matter.
  return checkPageInstanceFixed(node, context) ?? checkPageContainerUnbound(node, context);
};

export const missingSizeConstraint = defineRule({
  definition: missingSizeConstraintDef,
  check: missingSizeConstraintCheck,
});

// ============================================
// non-layout-container (was group-usage — now also catches Section)
// ============================================

const nonLayoutContainerDef: RuleDefinition = {
  id: "non-layout-container",
  name: "Non-Layout Container",
  category: "pixel-critical",
  why: "Groups and Sections lack proper layout rules — AI sees children with absolute coordinates but no container logic",
  impact: "AI wraps elements in a plain div with no spacing/alignment, producing fragile layouts",
  fix: "Convert to Frame with Auto Layout so AI can generate proper flex/grid containers",
};

const nonLayoutContainerCheck: RuleCheckFn = (node, context) => {
  if (node.type === "GROUP") {
    return {
      ruleId: nonLayoutContainerDef.id,
      subType: "group" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...nonLayoutContainerMsg.group(node.name),
    };
  }

  if (node.type === "SECTION") {
    return {
      ruleId: nonLayoutContainerDef.id,
      subType: "section" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...nonLayoutContainerMsg.section(node.name),
    };
  }

  return null;
};

export const nonLayoutContainer = defineRule({
  definition: nonLayoutContainerDef,
  check: nonLayoutContainerCheck,
});

// ============================================
// deep-nesting
// ============================================

const deepNestingDef: RuleDefinition = {
  id: "deep-nesting",
  name: "Deep Nesting",
  category: "code-quality",
  why: "Deep nesting consumes AI context exponentially — each level adds indentation and structural overhead",
  impact: "AI may lose track of parent-child relationships in deeply nested trees, producing wrong layout hierarchy",
  fix: "Flatten the structure by extracting deeply nested groups into sub-components",
};

const deepNestingCheck: RuleCheckFn = (node, context, options) => {
  const maxDepth = (options?.["maxDepth"] as number) ?? getRuleOption("deep-nesting", "maxDepth", 5);

  if (context.componentDepth < maxDepth) return null;
  if (!isContainerNode(node)) return null;

  return {
    ruleId: deepNestingDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...deepNestingMsg(node.name, context.componentDepth, maxDepth),
  };
};

export const deepNesting = defineRule({
  definition: deepNestingDef,
  check: deepNestingCheck,
});

