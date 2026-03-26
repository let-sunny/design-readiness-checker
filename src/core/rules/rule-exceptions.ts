import type { AnalysisNode } from "../contracts/figma-node.js";
import type { RuleContext } from "../contracts/rule.js";

// ============================================
// Shared node type helpers
// ============================================

const VISUAL_LEAF_TYPES = new Set([
  "VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "STAR", "REGULAR_POLYGON", "RECTANGLE",
]);

export function isVisualLeafType(type: string): boolean {
  return VISUAL_LEAF_TYPES.has(type);
}

function hasImageFill(node: AnalysisNode): boolean {
  if (!node.fills || !Array.isArray(node.fills)) return false;
  return node.fills.some((f) => {
    const fill = f as Record<string, unknown>;
    return fill["type"] === "IMAGE";
  });
}

function isSmallRelativeToParent(node: AnalysisNode, parent: AnalysisNode): boolean {
  const nodeBB = node.absoluteBoundingBox;
  const parentBB = parent.absoluteBoundingBox;
  if (!nodeBB || !parentBB) return false;
  if (parentBB.width === 0 || parentBB.height === 0) return false;

  const widthRatio = nodeBB.width / parentBB.width;
  const heightRatio = nodeBB.height / parentBB.height;
  return widthRatio < 0.25 && heightRatio < 0.25;
}

function isFullSizeRelativeToParent(node: AnalysisNode, parent: AnalysisNode): boolean {
  const nodeBB = node.absoluteBoundingBox;
  const parentBB = parent.absoluteBoundingBox;
  if (!nodeBB || !parentBB) return false;
  if (parentBB.width === 0 || parentBB.height === 0) return false;

  const widthRatio = nodeBB.width / parentBB.width;
  const heightRatio = nodeBB.height / parentBB.height;
  return widthRatio >= 0.9 && heightRatio >= 0.9;
}

// ============================================
// Auto-layout exceptions
// ============================================

/** Frames that don't need auto-layout */
export function isAutoLayoutExempt(node: AnalysisNode): boolean {
  // All children are visual leaf types (icons, shapes)
  if (node.children && node.children.length > 0 && node.children.every((c) => VISUAL_LEAF_TYPES.has(c.type))) {
    return true;
  }

  // Instance nodes — internal layout is managed by the component master
  if (node.type === "INSTANCE") return true;

  return false;
}

// ============================================
// Absolute-position exceptions
// ============================================

/** Nodes that are allowed to use absolute positioning inside auto-layout */
export function isAbsolutePositionExempt(node: AnalysisNode, context: RuleContext): boolean {
  // Vector/graphic nodes — absolute positioning is expected
  if (VISUAL_LEAF_TYPES.has(node.type)) return true;

  // Small decoration relative to parent (< 25% size)
  if (context.parent && isSmallRelativeToParent(node, context.parent)) return true;

  // Inside a component definition — designer's intentional layout
  if (context.parent?.type === "COMPONENT") return true;

  // Full-size background element (>= 90% of parent) — background layer
  if (context.parent && isFullSizeRelativeToParent(node, context.parent)) return true;

  return false;
}

// ============================================
// Size-constraint exceptions
// ============================================

/** Nodes that don't need maxWidth even with FILL sizing */
export function isSizeConstraintExempt(node: AnalysisNode, context: RuleContext): boolean {
  // Already has maxWidth
  if (node.maxWidth !== undefined) return true;

  // Small elements — won't stretch problematically
  if (node.absoluteBoundingBox && node.absoluteBoundingBox.width <= 200) return true;

  // Parent already has maxWidth — parent constrains the stretch
  if (context.parent?.maxWidth !== undefined) return true;

  // Root-level frames — they represent the screen itself
  if (context.depth <= 1) return true;

  // Only FILL child among siblings — intent is to fill the parent entirely
  if (context.siblings) {
    const fillSiblings = context.siblings.filter((s) => s.layoutSizingHorizontal === "FILL");
    if (fillSiblings.length <= 1) return true;
  }

  // Inside grid layout — grid controls sizing
  if (context.parent?.layoutMode === "GRID") return true;

  // Inside flex wrap — wrap layout controls sizing per row
  if (context.parent?.layoutWrap === "WRAP") return true;

  // Text nodes — content length provides natural sizing
  if (node.type === "TEXT") return true;

  return false;
}

// ============================================
// Fixed-size exceptions
// ============================================

/** Nodes that are allowed to use fixed sizing inside auto-layout */
export function isFixedSizeExempt(node: AnalysisNode): boolean {
  // Small fixed elements (icons, avatars) — intentionally fixed
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    if (width <= 48 && height <= 48) return true;
  }

  // Image fills — fixed size is intentional for thumbnails/avatars
  if (hasImageFill(node)) return true;

  return false;
}
