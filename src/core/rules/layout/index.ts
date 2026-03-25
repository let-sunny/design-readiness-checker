import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";

// ============================================
// Helper functions
// ============================================

function isContainerNode(node: AnalysisNode): boolean {
  return node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT";
}

function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

function hasTextContent(node: AnalysisNode): boolean {
  return node.type === "TEXT" || (node.children?.some((c) => c.type === "TEXT") ?? false);
}

// ============================================
// no-auto-layout
// ============================================

const noAutoLayoutDef: RuleDefinition = {
  id: "no-auto-layout",
  name: "No Auto Layout",
  category: "layout",
  why: "Frames without Auto Layout require manual positioning for every element",
  impact: "Layout breaks on content changes, harder to maintain and scale",
  fix: "Apply Auto Layout to the frame with appropriate direction and spacing",
};

const noAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "FRAME") return null;
  if (hasAutoLayout(node)) return null;
  // Skip if frame has no children (might be intentional placeholder)
  if (!node.children || node.children.length === 0) return null;

  return {
    ruleId: noAutoLayoutDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `Frame "${node.name}" has no Auto Layout`,
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
  category: "layout",
  why: "Absolute positioning inside Auto Layout breaks the automatic flow",
  impact: "Element will not respond to sibling changes, may overlap unexpectedly",
  fix: "Remove absolute positioning or use proper Auto Layout alignment",
};

import { isExcludedName } from "../excluded-names.js";

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
    message: `"${node.name}" uses absolute positioning inside Auto Layout parent "${context.parent.name}". If intentional (badge, overlay, close button), rename to badge-*, overlay-*, close-* to suppress this warning.`,
  };
};

export const absolutePositionInAutoLayout = defineRule({
  definition: absolutePositionInAutoLayoutDef,
  check: absolutePositionInAutoLayoutCheck,
});

// ============================================
// fixed-width-in-responsive-context
// ============================================

const fixedWidthInResponsiveContextDef: RuleDefinition = {
  id: "fixed-width-in-responsive-context",
  name: "Fixed Width in Responsive Context",
  category: "layout",
  why: "Fixed width inside Auto Layout prevents responsive behavior",
  impact: "Content will not adapt to container size changes",
  fix: "Use 'Fill' or 'Hug' instead of fixed width",
};

const fixedWidthInResponsiveContextCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  if (!isContainerNode(node)) return null;

  // Use layoutSizingHorizontal if available (accurate)
  if (node.layoutSizingHorizontal) {
    if (node.layoutSizingHorizontal !== "FIXED") return null;
  } else {
    // Fallback: STRETCH means fill, skip
    if (node.layoutAlign === "STRETCH") return null;
    if (!node.absoluteBoundingBox) return null;
    if (node.layoutAlign !== "INHERIT") return null;
  }

  // Excluded names (nav, header, etc.)
  if (isExcludedName(node.name)) return null;

  return {
    ruleId: fixedWidthInResponsiveContextDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has fixed width inside Auto Layout`,
  };
};

export const fixedWidthInResponsiveContext = defineRule({
  definition: fixedWidthInResponsiveContextDef,
  check: fixedWidthInResponsiveContextCheck,
});

// ============================================
// missing-responsive-behavior
// ============================================

const missingResponsiveBehaviorDef: RuleDefinition = {
  id: "missing-responsive-behavior",
  name: "Missing Responsive Behavior",
  category: "layout",
  why: "Elements without constraints won't adapt to different screen sizes",
  impact: "Layout will break or look wrong on different devices",
  fix: "Set appropriate constraints (left/right, top/bottom, scale, etc.)",
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
      message: `"${node.name}" has no responsive behavior configured`,
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
  category: "layout",
  why: "Groups don't support Auto Layout and have limited layout control",
  impact: "Harder to maintain consistent spacing and alignment",
  fix: "Convert Group to Frame and apply Auto Layout",
};

const groupUsageCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "GROUP") return null;

  return {
    ruleId: groupUsageDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" is a Group - consider converting to Frame with Auto Layout`,
  };
};

export const groupUsage = defineRule({
  definition: groupUsageDef,
  check: groupUsageCheck,
});

// ============================================
// fixed-size-in-auto-layout
// ============================================

const fixedSizeInAutoLayoutDef: RuleDefinition = {
  id: "fixed-size-in-auto-layout",
  name: "Fixed Size in Auto Layout",
  category: "layout",
  why: "Fixed sizes inside Auto Layout limit flexibility",
  impact: "Element won't adapt to content or container changes",
  fix: "Consider using 'Hug' for content-driven sizing",
};

const fixedSizeInAutoLayoutCheck: RuleCheckFn = (node, context) => {
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;
  // Only check containers, not leaf nodes
  if (!isContainerNode(node)) return null;
  if (!node.absoluteBoundingBox) return null;

  // Skip if it's intentionally a small fixed element (icon, avatar, etc.)
  const { width, height } = node.absoluteBoundingBox;
  if (width <= 48 && height <= 48) return null;

  // Both axes must be FIXED for this to be a problem
  const hFixed =
    node.layoutSizingHorizontal === "FIXED" || node.layoutSizingHorizontal === undefined;
  const vFixed =
    node.layoutSizingVertical === "FIXED" || node.layoutSizingVertical === undefined;
  if (!hFixed || !vFixed) return null;

  // Skip if it has children — only flag leaf-like containers with no auto-layout of their own
  if (node.layoutMode && node.layoutMode !== "NONE") return null;

  return {
    ruleId: fixedSizeInAutoLayoutDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `Container "${node.name}" (${width}×${height}) uses fixed size on both axes inside Auto Layout. Consider HUG or FILL for at least one axis.`,
  };
};

export const fixedSizeInAutoLayout = defineRule({
  definition: fixedSizeInAutoLayoutDef,
  check: fixedSizeInAutoLayoutCheck,
});

// ============================================
// missing-min-width
// ============================================

const missingMinWidthDef: RuleDefinition = {
  id: "missing-min-width",
  name: "Missing Min Width",
  category: "layout",
  why: "Without min-width, containers can collapse to unusable sizes",
  impact: "Text truncation or layout collapse on narrow screens",
  fix: "Set a minimum width constraint on the container",
};

const missingMinWidthCheck: RuleCheckFn = (node, context) => {
  // Only check containers and text-containing nodes
  if (!isContainerNode(node) && !hasTextContent(node)) return null;
  // Skip small fixed elements (icons, dividers)
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width <= 48 && height <= 24) return null;
  }
  // Skip if not in Auto Layout context
  if (!context.parent || !hasAutoLayout(context.parent)) return null;

  // Only flag FILL containers — FIXED/HUG don't need min-width
  if (node.layoutSizingHorizontal !== "FILL") return null;

  // Has minWidth set — no issue
  if (node.minWidth !== undefined) return null;

  return {
    ruleId: missingMinWidthDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" uses FILL width without a min-width constraint. It may collapse on narrow screens.`,
  };
};

export const missingMinWidth = defineRule({
  definition: missingMinWidthDef,
  check: missingMinWidthCheck,
});

// ============================================
// missing-max-width
// ============================================

const missingMaxWidthDef: RuleDefinition = {
  id: "missing-max-width",
  name: "Missing Max Width",
  category: "layout",
  why: "Without max-width, content can stretch too wide on large screens",
  impact: "Poor readability and layout on wide screens",
  fix: "Set a maximum width constraint, especially for text containers",
};

const missingMaxWidthCheck: RuleCheckFn = (node, context) => {
  // Only check containers and text-containing nodes
  if (!isContainerNode(node) && !hasTextContent(node)) return null;
  // Skip small elements
  if (node.absoluteBoundingBox) {
    const { width } = node.absoluteBoundingBox;
    if (width <= 200) return null;
  }
  // Skip if not in Auto Layout context
  if (!context.parent || !hasAutoLayout(context.parent)) return null;

  // Only flag FILL containers — FIXED/HUG don't need max-width
  if (node.layoutSizingHorizontal !== "FILL") return null;

  // Has maxWidth set — no issue
  if (node.maxWidth !== undefined) return null;

  return {
    ruleId: missingMaxWidthDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" uses FILL width without a max-width constraint. Content may stretch too wide on large screens.`,
  };
};

export const missingMaxWidth = defineRule({
  definition: missingMaxWidthDef,
  check: missingMaxWidthCheck,
});

// ============================================
// deep-nesting
// ============================================

const deepNestingDef: RuleDefinition = {
  id: "deep-nesting",
  name: "Deep Nesting",
  category: "handoff-risk",
  why: "Deep nesting within a single component makes the structure hard to understand for developers during handoff",
  impact: "Developers must trace through many layers to understand layout intent, increasing implementation time",
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
    message: `"${node.name}" is nested ${context.componentDepth} levels deep within its component (max: ${maxDepth})`,
  };
};

export const deepNesting = defineRule({
  definition: deepNestingDef,
  check: deepNestingCheck,
});

// ============================================
// overflow-hidden-abuse
// ============================================

const overflowHiddenAbuseDef: RuleDefinition = {
  id: "overflow-hidden-abuse",
  name: "Overflow Hidden Abuse",
  category: "layout",
  why: "Using clip content to hide layout problems masks underlying issues",
  impact: "Content may be unintentionally cut off, problems harder to diagnose",
  fix: "Fix the underlying layout issue instead of hiding overflow",
};

const overflowHiddenAbuseCheck: RuleCheckFn = (_node, _context) => {
  // This would check for clipsContent property
  // Simplified for now - needs more Figma API data
  return null;
};

export const overflowHiddenAbuse = defineRule({
  definition: overflowHiddenAbuseDef,
  check: overflowHiddenAbuseCheck,
});

// ============================================
// inconsistent-sibling-layout-direction
// ============================================

const inconsistentSiblingLayoutDirectionDef: RuleDefinition = {
  id: "inconsistent-sibling-layout-direction",
  name: "Inconsistent Sibling Layout Direction",
  category: "layout",
  why: "Sibling containers with mixed layout directions without clear reason create confusion",
  impact: "Harder to understand and maintain the design structure",
  fix: "Use consistent layout direction for similar sibling elements",
};

const inconsistentSiblingLayoutDirectionCheck: RuleCheckFn = (node, context) => {
  // Only check container nodes with siblings
  if (!isContainerNode(node)) return null;
  if (!context.siblings || context.siblings.length < 2) return null;

  // Get layout directions of sibling containers
  const siblingContainers = context.siblings.filter(
    (s) => isContainerNode(s) && s.id !== node.id
  );

  if (siblingContainers.length === 0) return null;

  const myDirection = node.layoutMode;
  if (!myDirection || myDirection === "NONE") return null;

  // Check if siblings have different directions
  const siblingDirections = siblingContainers
    .map((s) => s.layoutMode)
    .filter((d) => d && d !== "NONE");

  if (siblingDirections.length === 0) return null;

  // If all siblings have the same direction, but this node is different
  const allSameSiblingDirection = siblingDirections.every(
    (d) => d === siblingDirections[0]
  );

  if (allSameSiblingDirection && siblingDirections[0] !== myDirection) {
    // Check for valid patterns: parent row -> child column (card layout)
    if (context.parent?.layoutMode === "HORIZONTAL" && myDirection === "VERTICAL") {
      return null; // This is a valid card-in-row pattern
    }

    return {
      ruleId: inconsistentSiblingLayoutDirectionDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" has ${myDirection} layout while siblings use ${siblingDirections[0]}`,
    };
  }

  return null;
};

export const inconsistentSiblingLayoutDirection = defineRule({
  definition: inconsistentSiblingLayoutDirectionDef,
  check: inconsistentSiblingLayoutDirectionCheck,
});
