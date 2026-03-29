/**
 * Centralized node semantic classification.
 * All "what is this node?" logic lives here so rules share the same predicates.
 *
 * Categories:
 * - Container: layout containers (frame, group, component, instance)
 * - Visual: decorative/graphic elements (vector, shape, image)
 * - Interactive: user-interactable elements (button, link, tab, input, toggle)
 * - Overlay: elements that open on top (modal, drawer, dropdown)
 * - Carousel: elements that slide/swipe (carousel, slider, gallery)
 * - Token: style/variable binding checks
 * - Naming: name pattern classification
 */

import type { AnalysisNode } from "../contracts/figma-node.js";

// ── Container classification ─────────────────────────────────────────────────

export function isContainerNode(node: AnalysisNode): boolean {
  return node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT" || node.type === "INSTANCE";
}

export function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

export function hasTextContent(node: AnalysisNode): boolean {
  return node.type === "TEXT" || (node.children?.some((c) => c.type === "TEXT") ?? false);
}

export function hasOverlappingBounds(a: AnalysisNode, b: AnalysisNode): boolean {
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

// ── Visual classification ────────────────────────────────────────────────────

const VISUAL_LEAF_TYPES = new Set([
  "VECTOR", "BOOLEAN_OPERATION", "ELLIPSE", "LINE", "STAR", "REGULAR_POLYGON", "RECTANGLE",
]);

export function isVisualLeafType(type: string): boolean {
  return VISUAL_LEAF_TYPES.has(type);
}

export function hasImageFill(node: AnalysisNode): boolean {
  if (!Array.isArray(node.fills)) return false;
  return node.fills.some(
    (fill) =>
      typeof fill === "object" &&
      fill !== null &&
      (fill as { type?: unknown }).type === "IMAGE",
  );
}

export function isVisualOnlyNode(node: AnalysisNode): boolean {
  if (VISUAL_LEAF_TYPES.has(node.type)) return true;
  const hasOnlyVisualChildren =
    node.children !== undefined &&
    node.children.length > 0 &&
    node.children.every((c) => VISUAL_LEAF_TYPES.has(c.type));
  // Image fill only counts as visual-only when there are no content children
  if (hasImageFill(node) && (!node.children || node.children.length === 0 || hasOnlyVisualChildren)) {
    return true;
  }
  if (hasOnlyVisualChildren) return true;
  return false;
}

// ── Interactive classification ───────────────────────────────────────────────

export type StatefulComponentType = "button" | "link" | "tab" | "input" | "toggle";

/** Name patterns → interactive type mapping */
export const STATEFUL_PATTERNS: Array<{ pattern: RegExp; type: StatefulComponentType }> = [
  { pattern: /\b(btn|button|cta)\b/i, type: "button" },
  { pattern: /\b(link|anchor)\b/i, type: "link" },
  { pattern: /\b(tab|tabs)\b/i, type: "tab" },
  { pattern: /\b(nav|navigation|menu|navbar)\b/i, type: "tab" },
  { pattern: /\b(input|text-?field|search-?bar|textarea)\b/i, type: "input" },
  { pattern: /\b(select|dropdown|combo-?box)\b/i, type: "input" },
  { pattern: /\b(toggle|switch|checkbox|radio)\b/i, type: "toggle" },
];

export function getStatefulComponentType(node: AnalysisNode): StatefulComponentType | null {
  if (!node.name) return null;
  for (const entry of STATEFUL_PATTERNS) {
    if (entry.pattern.test(node.name)) return entry.type;
  }
  return null;
}

export function isStatefulComponent(node: AnalysisNode): boolean {
  return getStatefulComponentType(node) !== null;
}

/**
 * Standard state names accepted across web + mobile platforms.
 * Used by missing-interaction-state (to detect presence) and
 * non-standard-naming (to flag non-standard names).
 */
export const STANDARD_STATE_NAMES = new Set([
  // CSS pseudo-classes (web)
  "default", "hover", "active", "focus", "focused", "disabled",
  // Material Design (Android)
  "pressed",
  // UIKit (iOS)
  "highlighted",
  // Common
  "selected",
]);

/**
 * Patterns that look like state names but aren't in the standard set.
 * Maps common non-standard names to their standard equivalent for suggestions.
 */
export const STATE_NAME_SUGGESTIONS: Record<string, string> = {
  on: "active",
  off: "disabled",
  clicked: "pressed",
  tapped: "pressed",
  inactive: "disabled",
  normal: "default",
  rest: "default",
  enabled: "default",
  hovered: "hover",
  activated: "active",
  checked: "selected",
  unchecked: "default",
};

/** Pattern to detect state-like variant option names (broad match) */
export const STATE_LIKE_PATTERN = /\b(on|off|clicked|tapped|inactive|normal|rest|enabled|hovered|activated|checked|unchecked)\b/i;

// ── Overlay / Carousel patterns ──────────────────────────────────────────────

/** Elements that open on top of current view */
export const OVERLAY_PATTERN = /\b(dropdown|select|combo-?box|popover|accordion|drawer|modal|bottom-?sheet|sheet|sidebar|panel|dialog|popup|toast)\b/i;

/** Elements that swipe/slide between items */
export const CAROUSEL_PATTERN = /\b(carousel|slider|swiper|slide-?show|gallery)\b/i;

export function isOverlayNode(node: AnalysisNode): boolean {
  return node.name !== undefined && OVERLAY_PATTERN.test(node.name);
}

export function isCarouselNode(node: AnalysisNode): boolean {
  return node.name !== undefined && CAROUSEL_PATTERN.test(node.name);
}

// ── Token classification ─────────────────────────────────────────────────────

export function hasStyleReference(node: AnalysisNode, styleType: string): boolean {
  return node.styles !== undefined && styleType in node.styles;
}

export function hasBoundVariable(node: AnalysisNode, key: string): boolean {
  return node.boundVariables !== undefined && key in node.boundVariables;
}

// ── Naming patterns ──────────────────────────────────────────────────────────

/** Figma default name patterns (Frame 1, Group 2, etc.) */
export const DEFAULT_NAME_PATTERNS = [
  /^Frame\s*\d*$/i,
  /^Group\s*\d*$/i,
  /^Rectangle\s*\d*$/i,
  /^Ellipse\s*\d*$/i,
  /^Vector\s*\d*$/i,
  /^Line\s*\d*$/i,
  /^Text\s*\d*$/i,
  /^Image\s*\d*$/i,
  /^Component\s*\d*$/i,
  /^Instance\s*\d*$/i,
];

export function isDefaultName(name: string): boolean {
  return DEFAULT_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/** Shape-only non-semantic names */
export const NON_SEMANTIC_NAMES = [
  "rectangle", "ellipse", "vector", "line", "polygon",
  "star", "path", "shape", "image", "fill", "stroke",
];

export function isNonSemanticName(name: string): boolean {
  return NON_SEMANTIC_NAMES.includes(name.toLowerCase().trim());
}

// ── Exclusion ────────────────────────────────────────────────────────────────

export const EXCLUDED_NAME_PATTERN = /(badge|close|dismiss|overlay|float|fab|dot|indicator|corner|decoration|tag|status|notification|icon|ico|image|asset|filter|dim|dimmed|bg|background|logo|avatar|divider|separator|nav|navigation|gnb|header|footer|sidebar|toolbar|modal|dialog|popup|toast|tooltip|dropdown|menu|sticky|spinner|loader|cursor|cta|chatbot|thumb|thumbnail|tabbar|tab-bar|statusbar|status-bar)/i;

export function isExcludedName(name: string): boolean {
  return EXCLUDED_NAME_PATTERN.test(name);
}
