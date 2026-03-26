import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";
import { isExcludedName } from "../excluded-names.js";

// ============================================
// Helper functions
// ============================================

function isContainerNode(node: AnalysisNode): boolean {
  return node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT" || node.type === "INSTANCE";
}

function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

function hasTextContent(node: AnalysisNode): boolean {
  return node.type === "TEXT" || (node.children?.some((c) => c.type === "TEXT") ?? false);
}

function hasOverlappingBounds(a: AnalysisNode, b: AnalysisNode): boolean {
  const boxA = a.absoluteBoundingBox;
  const boxB = b.absoluteBoundingBox;

  if (!boxA || !boxB) return false;

  return !(
    boxA.x + boxA.width <= boxB.x ||
    boxB.x + boxB.width <= boxA.x ||
    boxA.y + boxA.height <= boxB.y ||
    boxB.y + boxB.height <= boxA.y
  );
}

// ============================================
// no-auto-layout (merged: absorbs ambiguous-structure + missing-layout-hint)
// ============================================

const noAutoLayoutDef: RuleDefinition = {
  id: "no-auto-layout",
  name: "No Auto Layout",
  category: "structure",
  why: "Without Auto Layout, AI must guess positioning from absolute coordinates instead of reading explicit layout rules",
  impact: "Generated code uses hardcoded positions that break on any content or screen size change",
  fix: "Apply Auto Layout to create clear, explicit structure — enables AI to generate flexbox/grid instead of absolute positioning",
};

const noAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "FRAME" && !isContainerNode(node)) return null;
  if (hasAutoLayout(node)) return null;
  if (!node.children || node.children.length === 0) return null;

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
              nodeId: node.id,
              nodePath: context.path.join(" > "),
              message: `"${node.name}" has overlapping children without Auto Layout — apply auto-layout to separate overlapping children`,
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
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          message: `"${node.name}" has nested containers without layout hints — apply auto-layout to organize nested containers`,
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
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `Frame "${node.name}" has no auto-layout${arrangement}${directionHint ? ` — apply ${directionHint} auto-layout` : " — apply auto-layout"}`,
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
  category: "structure",
  why: "Absolute positioning inside Auto Layout contradicts the parent's layout rules — AI sees conflicting instructions",
  impact: "AI must decide whether to follow the parent's flexbox or the child's absolute position — often gets it wrong",
  fix: "Remove absolute positioning or use proper Auto Layout alignment",
};

/**
 * Check if a node is small relative to its parent (decoration/badge pattern).
 * Returns true if the node is less than 25% of the parent's width AND height.
 */
function isSmallRelativeToParent(node: AnalysisNode, parent: AnalysisNode): boolean {
  const nodeBB = node.absoluteBoundingBox;
  const parentBB = parent.absoluteBoundingBox;
  if (!nodeBB || !parentBB) return false;
  if (parentBB.width === 0 || parentBB.height === 0) return false;

  const widthRatio = nodeBB.width / parentBB.width;
  const heightRatio = nodeBB.height / parentBB.height;
  return widthRatio < 0.25 && heightRatio < 0.25;
}

const absolutePositionInAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  if (node.layoutPositioning !== "ABSOLUTE") return null;

  // Exception: vector/graphic nodes (icons, illustrations — absolute positioning is expected)
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "LINE" || node.type === "ELLIPSE" || node.type === "STAR" || node.type === "REGULAR_POLYGON") return null;

  // Exception: intentional name patterns (badge, close, overlay, etc.)
  if (isExcludedName(node.name)) return null;

  // Exception: small decoration relative to parent (< 25% size)
  if (isSmallRelativeToParent(node, context.parent)) return null;

  // Exception: inside a component definition (designer's intentional layout)
  if (context.parent.type === "COMPONENT") return null;

  return {
    ruleId: absolutePositionInAutoLayoutDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" uses absolute positioning inside Auto Layout parent "${context.parent.name}" — remove absolute positioning or restructure outside the auto-layout parent`,
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
  category: "structure",
  why: "Fixed sizing inside Auto Layout contradicts the flexible layout intent",
  impact: "AI generates a rigid element inside a flex container — the layout won't respond to content changes",
  fix: "Use 'Hug' or 'Fill' for at least one axis. Both-axes FIXED → layout completely rigid; horizontal-only FIXED → width won't adapt to parent resize",
};

const fixedSizeInAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  if (!isContainerNode(node)) return null;
  if (!node.absoluteBoundingBox) return null;

  // Skip if it's intentionally a small fixed element (icon, avatar, etc.)
  const { width, height } = node.absoluteBoundingBox;
  if (width <= 48 && height <= 48) return null;

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
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `Container "${node.name}" (${width}×${height}) uses fixed size on both axes inside auto-layout — set at least one axis to HUG or FILL`,
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

    // Excluded names (nav, header, etc.)
    if (isExcludedName(node.name)) return null;

    return {
      ruleId: fixedSizeInAutoLayoutDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" has fixed width (${width}px) inside auto-layout — set horizontal sizing to FILL`,
    };
  }

  return null;
};

export const fixedSizeInAutoLayout = defineRule({
  definition: fixedSizeInAutoLayoutDef,
  check: fixedSizeInAutoLayoutCheck,
});

// ============================================
// missing-size-constraint (merged: missing-min-width + missing-max-width)
// ============================================

const missingSizeConstraintDef: RuleDefinition = {
  id: "missing-size-constraint",
  name: "Missing Size Constraint",
  category: "structure",
  why: "Without min/max-width, AI has no bounds — generated code may collapse or stretch indefinitely",
  impact: "Content becomes unreadable or invisible at extreme screen sizes",
  fix: "Set min-width and/or max-width so AI can generate proper size constraints",
};

const missingSizeConstraintCheck: RuleCheckFn = (node, context) => {
  // Only check containers and text-containing nodes
  if (!isContainerNode(node) && !hasTextContent(node)) return null;
  // Skip if not in Auto Layout context
  if (!context.parent || !hasAutoLayout(context.parent)) return null;
  // Only flag FILL containers — FIXED/HUG don't need min/max-width
  if (node.layoutSizingHorizontal !== "FILL") return null;

  const missingMin = node.minWidth === undefined;
  const missingMax = node.maxWidth === undefined;

  // Skip small fixed elements (icons, dividers) for min-width check
  let skipMinCheck = false;
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width <= 48 && height <= 24) skipMinCheck = true;
  }

  // Skip small elements for max-width check
  let skipMaxCheck = false;
  if (node.absoluteBoundingBox) {
    const { width } = node.absoluteBoundingBox;
    if (width <= 200) skipMaxCheck = true;
  }

  const effectiveMissingMin = missingMin && !skipMinCheck;
  const effectiveMissingMax = missingMax && !skipMaxCheck;

  const currentWidth = node.absoluteBoundingBox ? `${node.absoluteBoundingBox.width}px` : "unknown";

  if (effectiveMissingMin && effectiveMissingMax) {
    return {
      ruleId: missingSizeConstraintDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses FILL width (currently ${currentWidth}) without min or max constraints — add minWidth and/or maxWidth`,
    };
  }

  if (effectiveMissingMin) {
    return {
      ruleId: missingSizeConstraintDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses FILL width (currently ${currentWidth}) without min-width — add minWidth to prevent collapse on narrow screens`,
    };
  }

  if (effectiveMissingMax) {
    return {
      ruleId: missingSizeConstraintDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses FILL width (currently ${currentWidth}) without max-width — add maxWidth to prevent stretching on large screens`,
    };
  }

  return null;
};

export const missingSizeConstraint = defineRule({
  definition: missingSizeConstraintDef,
  check: missingSizeConstraintCheck,
});

// ============================================
// missing-responsive-behavior
// ============================================

const missingResponsiveBehaviorDef: RuleDefinition = {
  id: "missing-responsive-behavior",
  name: "Missing Responsive Behavior",
  category: "structure",
  why: "Without constraints, AI has no information about how elements should behave when the container resizes",
  impact: "AI generates static layouts that break on any screen size other than the one in the design",
  fix: "Set appropriate constraints so AI can generate responsive CSS (min/max-width, flex-grow, etc.)",
};

const missingResponsiveBehaviorCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  // Skip if inside Auto Layout (Auto Layout handles responsiveness)
  if (context.parent && hasAutoLayout(context.parent)) return null;
  // Skip root-level frames (they define the viewport)
  if (context.depth < 2) return null;

  // Check for missing layout mode and no parent auto layout
  if (!hasAutoLayout(node) && !node.layoutAlign) {
    return {
      ruleId: missingResponsiveBehaviorDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" has no responsive behavior configured — apply auto-layout or set constraints`,
    };
  }

  return null;
};

export const missingResponsiveBehavior = defineRule({
  definition: missingResponsiveBehaviorDef,
  check: missingResponsiveBehaviorCheck,
});

// ============================================
// group-usage
// ============================================

const groupUsageDef: RuleDefinition = {
  id: "group-usage",
  name: "Group Usage",
  category: "structure",
  why: "Groups have no layout rules — AI sees children with absolute coordinates but no container logic",
  impact: "AI wraps grouped elements in a plain div with no spacing/alignment, producing fragile layouts",
  fix: "Convert Group to Frame with Auto Layout so AI can generate proper flex/grid containers",
};

const groupUsageCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "GROUP") return null;

  return {
    ruleId: groupUsageDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" is a Group — convert to Frame and apply auto-layout`,
  };
};

export const groupUsage = defineRule({
  definition: groupUsageDef,
  check: groupUsageCheck,
});

// ============================================
// deep-nesting
// ============================================

const deepNestingDef: RuleDefinition = {
  id: "deep-nesting",
  name: "Deep Nesting",
  category: "structure",
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
    message: `"${node.name}" is nested ${context.componentDepth} levels deep within its component (max: ${maxDepth}) — extract into a sub-component to reduce depth`,
  };
};

export const deepNesting = defineRule({
  definition: deepNestingDef,
  check: deepNestingCheck,
});

// ============================================
// z-index-dependent-layout
// ============================================

const zIndexDependentLayoutDef: RuleDefinition = {
  id: "z-index-dependent-layout",
  name: "Z-Index Dependent Layout",
  category: "structure",
  why: "Using overlapping layers to create visual layout is hard to interpret",
  impact: "Code generation may misinterpret the intended layout",
  fix: "Restructure using Auto Layout to express the visual relationship explicitly",
};

const zIndexDependentLayoutCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  if (!node.children || node.children.length < 2) return null;

  let significantOverlapCount = 0;

  for (let i = 0; i < node.children.length; i++) {
    for (let j = i + 1; j < node.children.length; j++) {
      const childA = node.children[i];
      const childB = node.children[j];

      if (!childA || !childB) continue;
      if (childA.visible === false || childB.visible === false) continue;

      const boxA = childA.absoluteBoundingBox;
      const boxB = childB.absoluteBoundingBox;

      if (!boxA || !boxB) continue;

      if (hasOverlappingBounds(childA, childB)) {
        const overlapX = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) -
          Math.max(boxA.x, boxB.x);
        const overlapY = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) -
          Math.max(boxA.y, boxB.y);

        if (overlapX > 0 && overlapY > 0) {
          const overlapArea = overlapX * overlapY;
          const smallerArea = Math.min(
            boxA.width * boxA.height,
            boxB.width * boxB.height
          );

          if (overlapArea > smallerArea * 0.2) {
            significantOverlapCount++;
          }
        }
      }
    }
  }

  if (significantOverlapCount > 0) {
    return {
      ruleId: zIndexDependentLayoutDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses layer stacking for layout (${significantOverlapCount} overlaps) — restructure using auto-layout to express relationships explicitly`,
    };
  }

  return null;
};

export const zIndexDependentLayout = defineRule({
  definition: zIndexDependentLayoutDef,
  check: zIndexDependentLayoutCheck,
});

// ============================================
// unnecessary-node (merged: invisible-layer + empty-frame)
// ============================================

const unnecessaryNodeDef: RuleDefinition = {
  id: "unnecessary-node",
  name: "Unnecessary Node",
  category: "structure",
  why: "Hidden layers and empty frames add noise to the design tree without contributing to the visual output",
  impact: "Increases API response size and may generate unnecessary wrapper elements in code",
  fix: "Remove unused hidden layers or empty frames. If hidden layers represent states, consider using Figma Slots.",
};

const unnecessaryNodeCheck: RuleCheckFn = (node, context) => {
  // Check 1: Invisible layer (from invisible-layer rule)
  if (node.visible === false) {
    // Skip if parent is also invisible (only report top-level invisible)
    if (context.parent?.visible === false) return null;

    // Check if parent has many hidden children — suggest Slot
    const slotThreshold =
      getRuleOption("unnecessary-node", "slotRecommendationThreshold", 3);
    const hiddenSiblingCount = context.siblings
      ? context.siblings.filter((s) => s.visible === false).length
      : 0;

    if (hiddenSiblingCount >= slotThreshold) {
      return {
        ruleId: unnecessaryNodeDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" is hidden (${hiddenSiblingCount} hidden siblings) — if these represent states, consider using Figma Slots instead`,
      };
    }

    return {
      ruleId: unnecessaryNodeDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" is hidden — no impact on code generation, clean up if unused`,
    };
  }

  // Check 2: Empty frame (from empty-frame rule)
  if (node.type === "FRAME") {
    if (node.children && node.children.length > 0) return null;

    // Allow empty frames that are clearly placeholders (small size)
    if (node.absoluteBoundingBox) {
      const { width, height } = node.absoluteBoundingBox;
      if (width <= 48 && height <= 48) return null;
    }

    return {
      ruleId: unnecessaryNodeDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" is an empty frame${node.absoluteBoundingBox ? ` (${node.absoluteBoundingBox.width}×${node.absoluteBoundingBox.height})` : ""} — remove or replace with auto-layout spacing`,
    };
  }

  return null;
};

export const unnecessaryNode = defineRule({
  definition: unnecessaryNodeDef,
  check: unnecessaryNodeCheck,
});
