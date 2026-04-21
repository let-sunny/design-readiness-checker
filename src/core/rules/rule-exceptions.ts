import type { AnalysisNode } from "../contracts/figma-node.js";
import { isVisualLeafType, isVisualOnlyNode, isExcludedName } from "./node-semantics.js";

// ============================================
// Auto-layout exceptions
// ============================================

/** Frames that don't need auto-layout (only visual-leaf children like icon paths) */
export function isAutoLayoutExempt(node: AnalysisNode): boolean {
  if (
    node.children &&
    node.children.length > 0 &&
    node.children.every((c) => isVisualLeafType(c.type))
  ) return true;

  return false;
}

// ============================================
// Absolute-position exceptions
// ============================================

/** Nodes that are allowed to use absolute positioning inside auto-layout */
export function isAbsolutePositionExempt(node: AnalysisNode): boolean {
  if (isVisualOnlyNode(node)) return true;

  // Intentional name patterns (badge, close, overlay, etc.)
  if (isExcludedName(node.name)) return true;

  return false;
}

// ============================================
// Size-constraint exceptions
// ============================================
//
// `isSizeConstraintExempt` was removed in #403 (commit
// `feat(rules): missing-size-constraint scope-aware…`). The new rule
// walks the full ancestor chain to determine whether any container
// already establishes a width bound, which strictly subsumes the old
// "parent has maxWidth OR depth <= 1" heuristic. Keeping the helper
// would produce two divergent definitions of "bound" in the codebase.

// ============================================
// Fixed-size exceptions
// ============================================

/** Nodes that are allowed to use fixed sizing inside auto-layout */
export function isFixedSizeExempt(node: AnalysisNode): boolean {
  // Visual-only nodes (icons, images, shapes) — intentionally fixed
  if (isVisualOnlyNode(node)) return true;

  // Excluded names (nav, header, etc.)
  if (isExcludedName(node.name)) return true;

  return false;
}
