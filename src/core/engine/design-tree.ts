/**
 * Extract a DOM-like design tree from AnalysisFile.
 * Converts Figma node tree to a concise text format with inline CSS styles.
 * AI reads this 1:1 to generate HTML+CSS — no information loss, 50-100x smaller.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

/** Convert Figma RGBA color object to CSS hex string. */
function rgbaToHex(color: { r?: number; g?: number; b?: number; a?: number }): string | null {
  if (!color) return null;
  const r = Math.round((color.r ?? 0) * 255);
  const g = Math.round((color.g ?? 0) * 255);
  const b = Math.round((color.b ?? 0) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`.toUpperCase();
}

interface FillInfo {
  color: string | null;
  hasImage: boolean;
}

/** Extract fill color and IMAGE presence from a node, skipping invisible fills. */
function getFillInfo(node: AnalysisNode): FillInfo {
  const result: FillInfo = { color: null, hasImage: false };
  if (!node.fills || !Array.isArray(node.fills)) return result;
  for (const fill of node.fills) {
    const f = fill as { type?: string; visible?: boolean; color?: { r?: number; g?: number; b?: number; a?: number }; opacity?: number };
    // Skip invisible fills
    if (f.visible === false) continue;
    if (f.type === "SOLID" && f.color) {
      const opacity = f.opacity ?? f.color.a ?? 1;
      if (opacity < 1) {
        const r = Math.round((f.color.r ?? 0) * 255);
        const g = Math.round((f.color.g ?? 0) * 255);
        const b = Math.round((f.color.b ?? 0) * 255);
        result.color = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      } else {
        result.color = rgbaToHex(f.color);
      }
    } else if (f.type === "IMAGE") {
      result.hasImage = true;
    }
  }
  return result;
}

/** @deprecated Use getFillInfo instead for full fill details */
function getFill(node: AnalysisNode): string | null {
  return getFillInfo(node).color;
}

/** Extract the first solid stroke color as a CSS hex string. */
function getStroke(node: AnalysisNode): string | null {
  if (!node.strokes || !Array.isArray(node.strokes)) return null;
  for (const stroke of node.strokes) {
    const s = stroke as { type?: string; color?: { r?: number; g?: number; b?: number } };
    if (s.type === "SOLID" && s.color) return rgbaToHex(s.color);
  }
  return null;
}

/** Extract the first visible shadow effect as a CSS box-shadow value. */
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

/** Map Figma alignment values to CSS flexbox equivalents. */
function mapAlign(figmaAlign: string): string {
  const map: Record<string, string> = {
    MIN: "flex-start",
    CENTER: "center",
    MAX: "flex-end",
    SPACE_BETWEEN: "space-between",
  };
  return map[figmaAlign] ?? figmaAlign;
}

/** Render a single node and its children as indented design-tree text. */
function renderNode(
  node: AnalysisNode,
  indent: number,
  vectorDir?: string,
  components?: AnalysisFile["components"],
  imageMapping?: Record<string, string>,
): string {
  if (node.visible === false) return "";

  const prefix = "  ".repeat(indent);
  const lines: string[] = [];

  // Header — annotate INSTANCE nodes with component name
  const bbox = node.absoluteBoundingBox;
  const w = bbox ? Math.round(bbox.width) : "?";
  const h = bbox ? Math.round(bbox.height) : "?";
  let header = `${prefix}${node.name} (${node.type}, ${w}x${h})`;
  if (node.type === "INSTANCE" && node.componentId && components) {
    const comp = components[node.componentId];
    if (comp) {
      header += ` [component: ${comp.name}]`;
    }
  }
  lines.push(header);

  // Styles
  const styles: string[] = [];

  // Layout
  if (node.layoutMode && node.layoutMode !== "NONE") {
    if (node.layoutMode === "GRID") {
      styles.push(`display: grid`);
      if (node.gridColumnsSizing) styles.push(`grid-template-columns: ${node.gridColumnsSizing}`);
      if (node.gridRowsSizing) styles.push(`grid-template-rows: ${node.gridRowsSizing}`);
      if (node.gridColumnGap != null && node.gridRowGap != null) {
        styles.push(`gap: ${node.gridRowGap}px ${node.gridColumnGap}px`);
      } else if (node.gridRowGap != null) {
        styles.push(`row-gap: ${node.gridRowGap}px`);
      } else if (node.gridColumnGap != null) {
        styles.push(`column-gap: ${node.gridColumnGap}px`);
      } else if (node.itemSpacing != null) {
        styles.push(`gap: ${node.itemSpacing}px`);
      }
    } else {
      const dir = node.layoutMode === "VERTICAL" ? "column" : "row";
      styles.push(`display: flex; flex-direction: ${dir}`);
      if (node.layoutWrap === "WRAP") styles.push(`flex-wrap: wrap`);
      if (node.itemSpacing != null) {
        const mainGap = node.layoutMode === "VERTICAL" ? "row-gap" : "column-gap";
        styles.push(`${mainGap}: ${node.itemSpacing}px`);
      }
      if (node.counterAxisSpacing != null) {
        const crossGap = node.layoutMode === "VERTICAL" ? "column-gap" : "row-gap";
        styles.push(`${crossGap}: ${node.counterAxisSpacing}px`);
      }
      if (node.primaryAxisAlignItems) styles.push(`justify-content: ${mapAlign(node.primaryAxisAlignItems)}`);
      if (node.counterAxisAlignItems) styles.push(`align-items: ${mapAlign(node.counterAxisAlignItems)}`);
      if (node.counterAxisAlignContent && node.counterAxisAlignContent !== "AUTO") {
        styles.push(`align-content: ${mapAlign(node.counterAxisAlignContent)}`);
      }
    }
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
  const fillInfo = getFillInfo(node);
  if (fillInfo.color && node.type !== "TEXT") styles.push(`background: ${fillInfo.color}`);
  if (fillInfo.hasImage) {
    const mappedFile = imageMapping?.[node.id];
    if (mappedFile) {
      styles.push(`background-image: url(images/${mappedFile})`);
    } else {
      styles.push("background-image: [IMAGE]");
    }
  }

  // Border — respect per-side stroke weights
  const stroke = getStroke(node);
  if (stroke) {
    const isw = node.individualStrokeWeights as
      | { top?: number; right?: number; bottom?: number; left?: number }
      | undefined;
    const sw = (node.strokeWeight as number | undefined) ?? 1;
    if (isw) {
      if (isw.top) styles.push(`border-top: ${isw.top}px solid ${stroke}`);
      if (isw.right) styles.push(`border-right: ${isw.right}px solid ${stroke}`);
      if (isw.bottom) styles.push(`border-bottom: ${isw.bottom}px solid ${stroke}`);
      if (isw.left) styles.push(`border-left: ${isw.left}px solid ${stroke}`);
    } else {
      styles.push(`border: ${sw}px solid ${stroke}`);
    }
  }

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
    if (s["textDecoration"]) {
      const td = (s["textDecoration"] as string).toLowerCase();
      if (td !== "none") styles.push(`text-decoration: ${td}`);
    }

    const textColor = getFill(node);
    if (textColor) styles.push(`color: ${textColor}`);
  }

  // Text content
  if (node.type === "TEXT" && node.characters) {
    styles.push(`text: "${node.characters}"`);
  }

  // Vector SVG inline (when vector dir with downloaded SVGs is available)
  if (node.type === "VECTOR" && vectorDir) {
    const safeId = node.id.replace(/:/g, "-");
    const svgPath = join(vectorDir, `${safeId}.svg`);
    if (existsSync(svgPath)) {
      const svg = readFileSync(svgPath, "utf-8").trim();
      styles.push(`svg: ${svg}`);
    }
  }

  if (styles.length > 0) {
    lines.push(`${prefix}  style: ${styles.join("; ")}`);
  }

  // Children
  if (node.children) {
    for (const child of node.children) {
      const childOutput = renderNode(child, indent + 1, vectorDir, components, imageMapping);
      if (childOutput) lines.push(childOutput);
    }
  }

  return lines.join("\n");
}

/** Options for design tree generation. */
export interface DesignTreeOptions {
  /** Directory containing <nodeId>.svg files for VECTOR nodes */
  vectorDir?: string;
  /** Directory containing downloaded PNGs and mapping.json for IMAGE fill nodes */
  imageDir?: string;
}

/**
 * Generate a design tree string from an AnalysisFile.
 */
export interface DesignTreeResult {
  /** The design tree text */
  tree: string;
  /** Estimated token count (~4 chars per token for mixed code/text) */
  estimatedTokens: number;
  /** Raw byte size */
  bytes: number;
}

/**
 * Generate a design tree string from an AnalysisFile.
 */
export function generateDesignTree(file: AnalysisFile, options?: DesignTreeOptions): string {
  return generateDesignTreeWithStats(file, options).tree;
}

/**
 * Generate a design tree with token/size statistics.
 * Use this when you need to measure token consumption for AI context budget.
 */
export function generateDesignTreeWithStats(file: AnalysisFile, options?: DesignTreeOptions): DesignTreeResult {
  const root = file.document;
  const w = root.absoluteBoundingBox ? Math.round(root.absoluteBoundingBox.width) : 0;
  const h = root.absoluteBoundingBox ? Math.round(root.absoluteBoundingBox.height) : 0;

  // Load image mapping once if imageDir is provided
  let imageMapping: Record<string, string> | undefined;
  if (options?.imageDir) {
    const mappingPath = join(options.imageDir, "mapping.json");
    if (existsSync(mappingPath)) {
      try {
        imageMapping = JSON.parse(readFileSync(mappingPath, "utf-8")) as Record<string, string>;
      } catch { /* ignore malformed mapping */ }
    }
  }

  const tree = renderNode(root, 0, options?.vectorDir, file.components, imageMapping);

  const result = [
    "# Design Tree",
    `# Root: ${w}px x ${h}px`,
    "# Each node shows: name (TYPE, WxH) followed by CSS-like styles",
    "# Reproduce this tree as HTML. Each node = one HTML element.",
    "# Every style value is from Figma data — use exactly as shown.",
    "",
    tree,
  ].join("\n");

  const bytes = Buffer.byteLength(result, "utf-8");
  // ~4 chars per token for mixed code/text (conservative estimate)
  const estimatedTokens = Math.ceil(result.length / 4);

  return { tree: result, estimatedTokens, bytes };
}
