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
  imageScaleMode: string | null;
}

/** Extract fill color and IMAGE presence from a node, skipping invisible fills. */
function getFillInfo(node: AnalysisNode): FillInfo {
  const result: FillInfo = { color: null, hasImage: false, imageScaleMode: null };
  if (!node.fills || !Array.isArray(node.fills)) return result;
  for (const fill of node.fills) {
    const f = fill as {
      type?: string;
      visible?: boolean;
      color?: { r?: number; g?: number; b?: number; a?: number };
      opacity?: number;
      boundVariables?: { color?: { id?: string } };
      scaleMode?: string;
    };
    // Skip invisible fills
    if (f.visible === false) continue;
    if (f.type === "SOLID" && f.color) {
      const opacity = f.opacity ?? f.color.a ?? 1;
      let colorValue: string;
      if (opacity < 1) {
        const r = Math.round((f.color.r ?? 0) * 255);
        const g = Math.round((f.color.g ?? 0) * 255);
        const b = Math.round((f.color.b ?? 0) * 255);
        colorValue = `rgba(${r}, ${g}, ${b}, ${opacity})`;
      } else {
        colorValue = rgbaToHex(f.color) ?? "#000";
      }
      // Append variable reference if available
      if (f.boundVariables?.color?.id) {
        result.color = `${colorValue} /* var:${f.boundVariables.color.id} */`;
      } else {
        result.color = colorValue;
      }
    } else if (f.type === "IMAGE") {
      result.hasImage = true;
      result.imageScaleMode = f.scaleMode ?? null;
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

/** Map Figma text horizontal alignment to CSS text-align. */
function mapTextAlignHorizontal(figmaAlign: string): string {
  const map: Record<string, string> = {
    LEFT: "left",
    CENTER: "center",
    RIGHT: "right",
    JUSTIFIED: "justify",
  };
  return map[figmaAlign] ?? figmaAlign.toLowerCase();
}

/** Map Figma text vertical alignment to CSS flex align-items. */
function mapTextAlignVertical(figmaAlign: string): string {
  const map: Record<string, string> = {
    TOP: "flex-start",
    CENTER: "center",
    BOTTOM: "flex-end",
  };
  return map[figmaAlign] ?? figmaAlign.toLowerCase();
}

/** Get variable reference comment from boundVariables if available. */
function getVarRef(node: AnalysisNode, prop: string): string {
  const bv = node.boundVariables as Record<string, unknown> | undefined;
  if (!bv) return "";
  const ref = bv[prop];
  if (!ref) return "";
  if (typeof ref === "object" && ref !== null && "id" in ref) {
    return ` /* var:${(ref as { id: string }).id} */`;
  }
  return "";
}

/** Get first variable ref among multiple properties. */
function getFirstVarRef(node: AnalysisNode, props: string[]): string {
  for (const prop of props) {
    const ref = getVarRef(node, prop);
    if (ref) return ref;
  }
  return "";
}

/** Format instance component property values for AI hints. */
function formatComponentProperties(node: AnalysisNode): string | null {
  if (!node.componentProperties || typeof node.componentProperties !== "object") return null;
  const entries = Object.entries(node.componentProperties)
    .map(([name, value]) => {
      const v = value as { value?: unknown };
      const raw = typeof v?.value === "string" ? v.value : JSON.stringify(v?.value ?? "");
      return `${name}=${raw}`;
    });
  if (entries.length === 0) return null;
  return entries.join(", ");
}

/** Extract key visual styles from a node for hover diff comparison. */
function extractVisualStyles(node: AnalysisNode): Record<string, string> {
  const styles: Record<string, string> = {};
  const fillInfo = getFillInfo(node);
  if (fillInfo.color && node.type !== "TEXT") styles["background"] = fillInfo.color;
  const stroke = getStroke(node);
  if (stroke) styles["border-color"] = stroke;
  if (node.cornerRadius) styles["border-radius"] = `${node.cornerRadius}px`;
  if (node.opacity !== undefined && node.opacity < 1) styles["opacity"] = `${Math.round(node.opacity * 100) / 100}`;
  const shadow = getShadow(node);
  if (shadow) styles["box-shadow"] = shadow;
  // Text color
  if (node.type === "TEXT") {
    const textColor = getFill(node);
    if (textColor) styles["color"] = textColor;
  }
  return styles;
}

const HOVER_STYLE_DEFAULTS: Record<string, string> = {
  background: "transparent",
  "border-color": "transparent",
  "border-radius": "0px",
  opacity: "1",
  "box-shadow": "none",
  color: "inherit",
};

function getHoverResetValue(styleKey: string): string {
  return HOVER_STYLE_DEFAULTS[styleKey] ?? "initial";
}

function appendStyleDiffs(
  currentStyles: Record<string, string>,
  hoverStyles: Record<string, string>,
  diffs: string[],
  namePrefix?: string,
): void {
  const styleKeys = new Set([...Object.keys(currentStyles), ...Object.keys(hoverStyles)]);
  for (const key of styleKeys) {
    const currentValue = currentStyles[key];
    const hoverValue = hoverStyles[key] ?? getHoverResetValue(key);
    if (currentValue !== hoverValue) {
      const prefix = namePrefix ? `${namePrefix}: ` : "";
      diffs.push(`${prefix}${key}: ${hoverValue}`);
    }
  }
}

function getChildStableKey(node: AnalysisNode): string | null {
  // Prefer name over id: variant children share the same name but have different ids
  if (node.name) return `name:${node.name}`;
  return node.id ?? null;
}

/** Compute style diff between current node and its hover variant. */
function computeHoverDiff(
  currentNode: AnalysisNode,
  hoverNode: AnalysisNode,
): string | null {
  const current = extractVisualStyles(currentNode);
  const hover = extractVisualStyles(hoverNode);
  const diffs: string[] = [];
  appendStyleDiffs(current, hover, diffs);
  // Check children for text/color changes (first level only)
  if (currentNode.children && hoverNode.children) {
    const hoverByStableKey = new Map<string, AnalysisNode>();
    const hoverUnmatchedByIndex: AnalysisNode[] = [];

    for (const child of hoverNode.children) {
      const key = getChildStableKey(child);
      if (key) {
        // Keep the first occurrence to reduce noisy collisions.
        if (!hoverByStableKey.has(key)) hoverByStableKey.set(key, child);
      } else {
        hoverUnmatchedByIndex.push(child);
      }
    }

    let unkeyedIdx = 0;
    for (let i = 0; i < currentNode.children.length; i++) {
      const cc = currentNode.children[i];
      if (!cc) continue;

      const stableKey = getChildStableKey(cc);
      let hc: AnalysisNode | undefined;
      if (stableKey) {
        hc = hoverByStableKey.get(stableKey);
      } else {
        hc = hoverUnmatchedByIndex[unkeyedIdx];
        unkeyedIdx++;
      }
      if (!hc) continue;
      const ccStyles = extractVisualStyles(cc);
      const hcStyles = extractVisualStyles(hc);
      appendStyleDiffs(ccStyles, hcStyles, diffs, cc.name);
    }
  }
  return diffs.length > 0 ? diffs.join("; ") : null;
}

/** Render a single node and its children as indented design-tree text. */
function renderNode(
  node: AnalysisNode,
  indent: number,
  vectorDir?: string,
  components?: AnalysisFile["components"],
  imageMapping?: Record<string, string>,
  vectorMapping?: Record<string, string>,
  fileStyles?: AnalysisFile["styles"],
  interactionDests?: Record<string, AnalysisNode>,
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
  if (node.type === "INSTANCE") {
    const componentProps = formatComponentProperties(node);
    if (componentProps) {
      lines.push(`${prefix}  component-properties: ${componentProps}`);
    }
  }

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
        styles.push(`${mainGap}: ${node.itemSpacing}px${getVarRef(node, "itemSpacing")}`);
      }
      if (node.counterAxisSpacing != null) {
        const crossGap = node.layoutMode === "VERTICAL" ? "column-gap" : "row-gap";
        styles.push(`${crossGap}: ${node.counterAxisSpacing}px${getVarRef(node, "counterAxisSpacing")}`);
      }
      if (node.primaryAxisAlignItems) styles.push(`justify-content: ${mapAlign(node.primaryAxisAlignItems)}`);
      if (node.counterAxisAlignItems) styles.push(`align-items: ${mapAlign(node.counterAxisAlignItems)}`);
      if (node.counterAxisAlignContent && node.counterAxisAlignContent !== "AUTO") {
        styles.push(`align-content: ${mapAlign(node.counterAxisAlignContent)}`);
      }
    }
  }
  // Child self-alignment in auto-layout
  if (node.layoutAlign && node.layoutAlign !== "INHERIT") {
    styles.push(`align-self: ${mapAlign(node.layoutAlign)}`);
  }
  if (node.layoutGrow === 1) {
    styles.push("flex-grow: 1");
  }

  // Padding
  const pt = node.paddingTop ?? 0;
  const pr = node.paddingRight ?? 0;
  const pb = node.paddingBottom ?? 0;
  const pl = node.paddingLeft ?? 0;
  if (pt || pr || pb || pl) {
    const padRef = getFirstVarRef(node, ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]);
    styles.push(`padding: ${pt}px ${pr}px ${pb}px ${pl}px${padRef}`);
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
      styles.push("background-position: center");
      styles.push("background-repeat: no-repeat");
      if (fillInfo.imageScaleMode === "FIT") {
        styles.push("background-size: contain");
      } else if (fillInfo.imageScaleMode === "FILL") {
        styles.push("background-size: cover");
      }
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
      const strokeRef = getFirstVarRef(node, ["individualStrokeWeights", "strokes"]);
      if (isw.top) styles.push(`border-top: ${isw.top}px solid ${stroke}${strokeRef}`);
      if (isw.right) styles.push(`border-right: ${isw.right}px solid ${stroke}${strokeRef}`);
      if (isw.bottom) styles.push(`border-bottom: ${isw.bottom}px solid ${stroke}${strokeRef}`);
      if (isw.left) styles.push(`border-left: ${isw.left}px solid ${stroke}${strokeRef}`);
    } else {
      styles.push(`border: ${sw}px solid ${stroke}${getVarRef(node, "strokes")}`);
    }
  }

  // Border radius
  if (node.cornerRadius) {
    const radiusRef = getVarRef(node, "rectangleCornerRadii");
    styles.push(`border-radius: ${node.cornerRadius}px${radiusRef}`);
  }

  // Shadow
  const shadow = getShadow(node);
  if (shadow) styles.push(`box-shadow: ${shadow}`);

  // Overflow
  if (node.clipsContent) styles.push("overflow: hidden");

  // Opacity
  if (node.opacity !== undefined && node.opacity < 1) {
    styles.push(`opacity: ${Math.round(node.opacity * 100) / 100}`);
  }

  // Min/max constraints
  if (node.minWidth !== undefined) styles.push(`min-width: ${Math.round(node.minWidth)}px`);
  if (node.maxWidth !== undefined) styles.push(`max-width: ${Math.round(node.maxWidth)}px`);
  if (node.minHeight !== undefined) styles.push(`min-height: ${Math.round(node.minHeight)}px`);
  if (node.maxHeight !== undefined) styles.push(`max-height: ${Math.round(node.maxHeight)}px`);

  // Typography
  if (node.type === "TEXT" && node.style) {
    // Add text style name if available
    const nodeStyles = node.styles as Record<string, string> | undefined;
    const textStyleId = nodeStyles?.["text"];
    if (textStyleId && fileStyles) {
      const styleInfo = fileStyles[textStyleId] as { name?: string } | undefined;
      if (styleInfo?.name) {
        styles.push(`/* text-style: ${styleInfo.name} */`);
      }
    }

    const s = node.style as Record<string, unknown>;
    if (s["fontFamily"]) styles.push(`font-family: "${s["fontFamily"]}"${getVarRef(node, "fontFamily")}`);
    if (s["fontWeight"]) styles.push(`font-weight: ${s["fontWeight"]}${getVarRef(node, "fontWeight")}`);
    if (s["fontSize"]) styles.push(`font-size: ${s["fontSize"]}px${getVarRef(node, "fontSize")}`);
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
    if (s["textAlignHorizontal"]) {
      styles.push(`text-align: ${mapTextAlignHorizontal(String(s["textAlignHorizontal"]))}`);
    }
    if (s["textAlignVertical"]) {
      // CSS has no direct text vertical-align in a text box; emit flex hint.
      styles.push("display: flex");
      styles.push(`align-items: ${mapTextAlignVertical(String(s["textAlignVertical"]))}`);
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
    const mappedFile = vectorMapping?.[node.id];
    const svgPath = mappedFile
      ? join(vectorDir, mappedFile)
      : join(vectorDir, `${node.id.replace(/:/g, "-")}.svg`); // fallback to legacy ID-based naming
    if (existsSync(svgPath)) {
      const svg = readFileSync(svgPath, "utf-8").trim();
      styles.push(`svg: ${svg}`);
    }
  }

  if (styles.length > 0) {
    lines.push(`${prefix}  style: ${styles.join("; ")}`);
  }

  // Interaction states (hover)
  if (node.interactions && interactionDests) {
    for (const interaction of node.interactions) {
      const i = interaction as {
        trigger?: { type?: string };
        actions?: Array<{ destinationId?: string; navigation?: string }>;
      };
      if (i.trigger?.type === "ON_HOVER" && i.actions) {
        for (const action of i.actions) {
          if (action.destinationId && action.navigation === "CHANGE_TO") {
            const hoverNode = interactionDests[action.destinationId];
            if (hoverNode) {
              const diff = computeHoverDiff(node, hoverNode);
              if (diff) {
                lines.push(`${prefix}  [hover]: ${diff}`);
              }
            }
          }
        }
      }
    }
  }

  // Children
  if (node.children) {
    for (const child of node.children) {
      const childOutput = renderNode(child, indent + 1, vectorDir, components, imageMapping, vectorMapping, fileStyles, interactionDests);
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

  // Load vector mapping once if vectorDir is provided
  let vectorMapping: Record<string, string> | undefined;
  if (options?.vectorDir) {
    const mappingPath = join(options.vectorDir, "mapping.json");
    if (existsSync(mappingPath)) {
      try {
        vectorMapping = JSON.parse(readFileSync(mappingPath, "utf-8")) as Record<string, string>;
      } catch { /* ignore malformed mapping */ }
    }
  }

  const tree = renderNode(root, 0, options?.vectorDir, file.components, imageMapping, vectorMapping, file.styles, file.interactionDestinations);

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
