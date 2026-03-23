/**
 * Extract a DOM-like design tree from AnalysisFile.
 * Converts Figma node tree to a concise text format with inline CSS styles.
 * AI reads this 1:1 to generate HTML+CSS — no information loss, 50-100x smaller.
 */

import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

function rgbaToHex(color: { r?: number; g?: number; b?: number; a?: number }): string | null {
  if (!color) return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

function getFill(node: AnalysisNode): string | null {
  if (!node.fills || !Array.isArray(node.fills)) return null;
  for (const fill of node.fills) {
    const f = fill as { type?: string; color?: { r?: number; g?: number; b?: number } };
    if (f.type === "SOLID" && f.color) return rgbaToHex(f.color);
  }
  return null;
}

function getStroke(node: AnalysisNode): string | null {
  if (!node.strokes || !Array.isArray(node.strokes)) return null;
  for (const stroke of node.strokes) {
    const s = stroke as { type?: string; color?: { r?: number; g?: number; b?: number } };
    if (s.type === "SOLID" && s.color) return rgbaToHex(s.color);
  }
  return null;
}

function getShadow(node: AnalysisNode): string | null {
  if (!node.effects || !Array.isArray(node.effects)) return null;
  for (const effect of node.effects) {
    const e = effect as {
      type?: string;
      visible?: boolean;
      color?: { r?: number; g?: number; b?: number };
      offset?: { x?: number; y?: number };
      radius?: number;
    };
    if ((e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false) {
      const c = e.color ? rgbaToHex(e.color) : "#000";
      const ox = e.offset?.x ?? 0;
      const oy = e.offset?.y ?? 0;
      return `${ox}px ${oy}px ${e.radius ?? 0}px ${c}`;
    }
  }
  return null;
}

function mapAlign(figmaAlign: string): string {
  const map: Record<string, string> = {
    MIN: "flex-start",
    CENTER: "center",
    MAX: "flex-end",
    SPACE_BETWEEN: "space-between",
  };
  return map[figmaAlign] ?? figmaAlign;
}

function renderNode(node: AnalysisNode, indent: number): string {
  if (node.visible === false) return "";

  const prefix = "  ".repeat(indent);
  const lines: string[] = [];

  // Header
  const bbox = node.absoluteBoundingBox;
  const w = bbox ? Math.round(bbox.width) : "?";
  const h = bbox ? Math.round(bbox.height) : "?";
  lines.push(`${prefix}${node.name} (${node.type}, ${w}x${h})`);

  // Styles
  const styles: string[] = [];

  // Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    const dir = node.layoutMode === "VERTICAL" ? "column" : "row";
    styles.push(`display: flex; flex-direction: ${dir}`);
    if (node.itemSpacing != null) styles.push(`gap: ${node.itemSpacing}px`);
    if (node.primaryAxisAlignItems) styles.push(`justify-content: ${mapAlign(node.primaryAxisAlignItems)}`);
    if (node.counterAxisAlignItems) styles.push(`align-items: ${mapAlign(node.counterAxisAlignItems)}`);
  }

  // Padding
  const pt = node.paddingTop ?? 0;
  const pr = node.paddingRight ?? 0;
  const pb = node.paddingBottom ?? 0;
  const pl = node.paddingLeft ?? 0;
  if (pt || pr || pb || pl) {
    styles.push(`padding: ${pt}px ${pr}px ${pb}px ${pl}px`);
  }

  // Sizing
  if (node.layoutSizingHorizontal === "FILL") styles.push("width: 100%");
  if (node.layoutSizingVertical === "FILL") styles.push("height: 100%");

  // Fill (not for TEXT — text fill is color)
  const fill = getFill(node);
  if (fill && node.type !== "TEXT") styles.push(`background: ${fill}`);

  // Border
  const stroke = getStroke(node);
  if (stroke) styles.push(`border: 1px solid ${stroke}`);

  // Border radius
  if (node.cornerRadius) styles.push(`border-radius: ${node.cornerRadius}px`);

  // Shadow
  const shadow = getShadow(node);
  if (shadow) styles.push(`box-shadow: ${shadow}`);

  // Typography
  if (node.type === "TEXT" && node.style) {
    const s = node.style as Record<string, unknown>;
    if (s["fontFamily"]) styles.push(`font-family: "${s["fontFamily"]}"`);
    if (s["fontWeight"]) styles.push(`font-weight: ${s["fontWeight"]}`);
    if (s["fontSize"]) styles.push(`font-size: ${s["fontSize"]}px`);
    if (s["lineHeightPx"]) {
      const lh = s["lineHeightPx"] as number;
      styles.push(`line-height: ${Math.round(lh * 100) / 100}px`);
    }
    if (s["letterSpacing"]) {
      const ls = s["letterSpacing"] as number;
      styles.push(`letter-spacing: ${Math.round(ls * 100) / 100}px`);
    }

    const textColor = getFill(node);
    if (textColor) styles.push(`color: ${textColor}`);
  }

  // Text content
  if (node.type === "TEXT" && node.characters) {
    styles.push(`text: "${node.characters}"`);
  }

  if (styles.length > 0) {
    lines.push(`${prefix}  style: ${styles.join("; ")}`);
  }

  // Children
  if (node.children) {
    for (const child of node.children) {
      const childOutput = renderNode(child, indent + 1);
      if (childOutput) lines.push(childOutput);
    }
  }

  return lines.join("\n");
}

/**
 * Generate a design tree string from an AnalysisFile.
 */
export function generateDesignTree(file: AnalysisFile): string {
  const root = file.document;
  const w = root.absoluteBoundingBox ? Math.round(root.absoluteBoundingBox.width) : 0;
  const h = root.absoluteBoundingBox ? Math.round(root.absoluteBoundingBox.height) : 0;

  const tree = renderNode(root, 0);

  return [
    "# Design Tree",
    `# Root: ${w}px x ${h}px`,
    "# Each node shows: name (TYPE, WxH) followed by CSS-like styles",
    "# Reproduce this tree as HTML. Each node = one HTML element.",
    "# Every style value is from Figma data — use exactly as shown.",
    "",
    tree,
  ].join("\n");
}
