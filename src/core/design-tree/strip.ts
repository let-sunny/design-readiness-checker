/**
 * Strip specific information types from design-tree text for ablation experiments.
 * Post-processes the generated text — does NOT modify design-tree.ts.
 *
 * Flow: generateDesignTree() → stripDesignTree() → send to LLM
 */

/** All strip types available (including utility strips not used in experiments). */
export type DesignTreeStripType =
  | "layout-direction-spacing"
  | "size-constraints"
  | "position-stacking"
  | "color-values"
  | "typography"
  | "shadows-effects"
  | "component-references"
  | "component-descriptions"
  | "node-names-hierarchy"
  | "overflow-text-behavior"
  | "hover-interaction-states"
  | "variable-references"
  | "style-references";

/**
 * Experiment-relevant strip types only.
 * Excludes trivially obvious types (color, typography, shadows, overflow, hover)
 * and no-op types (position-stacking, component-descriptions).
 */
export type DesignTreeInfoType =
  | "layout-direction-spacing"
  | "size-constraints"
  | "component-references"
  | "node-names-hierarchy"
  | "variable-references"
  | "style-references";

/** All strip types (used for exhaustive testing). */
export const ALL_STRIP_TYPES: readonly DesignTreeStripType[] = [
  "layout-direction-spacing", "size-constraints", "position-stacking",
  "color-values", "typography", "shadows-effects", "component-references",
  "component-descriptions", "node-names-hierarchy", "overflow-text-behavior",
  "hover-interaction-states", "variable-references", "style-references",
] as const;

/**
 * Strip experiment types used in calibration ablation (six types).
 * Keep in sync with `StripTypeEnum` / `STRIP_TYPE_RULES` in the agents layer.
 * `size-constraints` pairs with responsive rules `missing-size-constraint`, `fixed-size-in-auto-layout`.
 */
export const DESIGN_TREE_INFO_TYPES: readonly DesignTreeInfoType[] = [
  "layout-direction-spacing",
  "size-constraints",
  "component-references",
  "node-names-hierarchy",
  "variable-references",
  "style-references",
] as const;

// --- Style property matchers ---

const LAYOUT_PROPS = new Set([
  "display",
  "flex-direction",
  "flex-wrap",
  "gap",
  "row-gap",
  "column-gap",
  "justify-content",
  "align-items",
  "align-content",
  "padding",
  "grid-template-columns",
  "grid-template-rows",
  "align-self",
]);

const SIZE_PROPS = new Set([
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "flex-grow",
]);

const TYPOGRAPHY_PROPS = new Set([
  "font-family",
  "font-weight",
  "font-size",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration",
]);

const SHADOW_PROPS = new Set([
  "box-shadow",
  "opacity",
]);

/** Get the CSS property name from a style segment like "font-size: 16px" */
function getPropertyName(segment: string): string {
  const colonIdx = segment.indexOf(":");
  if (colonIdx === -1) return segment.trim();
  return segment.slice(0, colonIdx).trim();
}

/** Check if a style segment is a "fill" size (width: 100% or height: 100%) */
function isFillSize(segment: string): boolean {
  const trimmed = segment.trim();
  return trimmed === "width: 100%" || trimmed === "height: 100%";
}

// --- Color replacement ---

const HEX_COLOR_RE = /#[0-9A-Fa-f]{6,8}/g;
const RGBA_RE = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)/g;
const SVG_COLOR_ATTR_RE = /(fill|stroke)="(#[0-9A-Fa-f]{6,8})"/g;

function replaceColors(segment: string): string {
  let result = segment;
  result = result.replace(RGBA_RE, "[COLOR]");
  result = result.replace(HEX_COLOR_RE, "[COLOR]");
  return result;
}

function replaceColorsInSvg(svgContent: string): string {
  return svgContent.replace(SVG_COLOR_ATTR_RE, '$1="[COLOR]"');
}

// --- Reference removal ---

const VAR_COMMENT_RE = /\s*\/\*\s*var:[^*]*\*\//g;
const TEXT_STYLE_COMMENT_RE = /\s*\/\*\s*text-style:[^*]*\*\//g;

function removeVarRefs(segment: string): string {
  return segment.replace(VAR_COMMENT_RE, "").trim();
}

function removeStyleRefs(segment: string): string {
  return segment.replace(TEXT_STYLE_COMMENT_RE, "").trim();
}


// --- Line classification ---

interface ParsedStyleLine {
  indent: string;
  properties: string[];
  svgSegment: string | null;
  /** text: "..." content — always preserved, never stripped or split. */
  textSegment: string | null;
}

/** Extract `text: "..."` segment from raw style string, handling escaped quotes. */
function extractTextSegment(raw: string): { textSegment: string | null; rest: string } {
  // Match text: "..." allowing escaped quotes inside
  const textMatch = raw.match(/(?:^|;\s*)text:\s*"(?:[^"\\]|\\.)*"/);
  if (!textMatch) return { textSegment: null, rest: raw };
  const textSegment = textMatch[0].replace(/^;\s*/, "").trim();
  const rest = raw.replace(textMatch[0], "").replace(/;\s*$/, "").replace(/^;\s*/, "");
  return { textSegment, rest };
}

/** Split a style line into prefix, individual properties, optional SVG tail, and protected text. */
function parseStyleLine(line: string): ParsedStyleLine | null {
  const match = line.match(/^(\s*)style:\s*(.*)/s);
  if (!match) return null;
  const indent = match[1] ?? "";
  const raw = match[2] ?? "";

  // 1. Extract text: "..." first (protected from splitting)
  const { textSegment, rest: afterText } = extractTextSegment(raw);

  // 2. Separate SVG segment (always last, starts with "svg: <")
  let svgSegment: string | null = null;
  let propsRaw = afterText;
  const svgIdx = afterText.indexOf("svg: <");
  if (svgIdx !== -1) {
    svgSegment = afterText.slice(svgIdx);
    propsRaw = afterText.slice(0, svgIdx).replace(/;\s*$/, "");
  }

  // 3. Split remaining properties by "; "
  const properties = propsRaw
    ? propsRaw.split("; ").map((p) => p.trim()).filter(Boolean)
    : [];

  return { indent, properties, svgSegment, textSegment };
}

/** Reassemble a style line from parts. Returns null if no properties remain. */
function reassembleStyleLine(parsed: ParsedStyleLine): string | null {
  const parts = [...parsed.properties];
  if (parsed.svgSegment) parts.push(parsed.svgSegment);
  if (parsed.textSegment) parts.push(parsed.textSegment);
  if (parts.length === 0) return null;
  return `${parsed.indent}style: ${parts.join("; ")}`;
}

// --- Per-type strip functions ---

function stripLayoutSpacing(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties.filter((p) => {
      const prop = getPropertyName(p);
      return !LAYOUT_PROPS.has(prop);
    });
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

function stripSizeConstraints(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties.filter((p) => {
      const prop = getPropertyName(p);
      if (SIZE_PROPS.has(prop)) return false;
      if (isFillSize(p)) return false;
      return true;
    });
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

function stripColorValues(lines: string[]): string[] {
  return lines.map((line) => {
    // Handle [hover] lines — replace colors there too
    if (line.match(/^\s*\[hover\]:/)) {
      return replaceColors(line);
    }

    const parsed = parseStyleLine(line);
    if (!parsed) return line;

    parsed.properties = parsed.properties.map((p) => {
      const prop = getPropertyName(p);
      // Don't touch image paths or text content
      if (prop === "background-image") return p;
      if (prop === "content-image") return p;
      if (prop === "text") return p;
      // Replace colors in background, color, border, box-shadow
      if (["background", "color", "border", "border-top", "border-right",
           "border-bottom", "border-left", "box-shadow"].includes(prop)) {
        return replaceColors(p);
      }
      return p;
    });

    // Replace colors in SVG
    if (parsed.svgSegment) {
      parsed.svgSegment = replaceColorsInSvg(parsed.svgSegment);
    }

    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

function stripTypography(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties.filter((p) => {
      const prop = getPropertyName(p);
      if (TYPOGRAPHY_PROPS.has(prop)) return false;
      if (p.trim().startsWith("/* text-style:")) return false;
      return true;
    });
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

function stripShadowsEffects(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties.filter((p) => {
      const prop = getPropertyName(p);
      return !SHADOW_PROPS.has(prop);
    });
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

/** Header line pattern: {indent}Name (TYPE, WxH) with optional [component: ...] */
const HEADER_RE = /^(\s*)(.+?)(\s*\([A-Z_]+,\s*[\d?]+x[\d?]+\).*)$/;

/** Check if a line is a node header (not style/comment/component-properties/hover). */
function isHeaderLine(line: string): boolean {
  if (line.trimStart().startsWith("style:")) return false;
  if (line.trimStart().startsWith("[hover]:")) return false;
  if (line.trimStart().startsWith("component-properties:")) return false;
  if (line.startsWith("#")) return false;
  return HEADER_RE.test(line);
}

function stripComponentReferences(lines: string[]): string[] {
  return lines
    .filter((line) => !line.match(/^\s*component-properties:/))
    .map((line) => {
      if (isHeaderLine(line)) {
        return line.replace(/\s*\[component:[^\]]*\]$/, "");
      }
      return line;
    });
}

function stripNodeNames(lines: string[]): string[] {
  let counter = 0;
  return lines.map((line) => {
    if (!isHeaderLine(line)) return line;
    const match = line.match(HEADER_RE);
    if (match) {
      counter++;
      return `${match[1]}Node${counter}${match[3]}`;
    }
    return line;
  });
}

function stripOverflow(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties.filter((p) =>
      p.trim() !== "overflow: hidden"
    );
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

function stripHoverStates(lines: string[]): string[] {
  return lines.filter((line) => !line.match(/^\s*\[hover\]:/));
}

/** Strip variable reference comments only (keep text-style references). */
function stripVariableReferences(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties
      .map((p) => removeVarRefs(p))
      .filter(Boolean);
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

/** Strip text-style comments only (keep variable references). */
function stripStyleReferences(lines: string[]): string[] {
  return lines.map((line) => {
    const parsed = parseStyleLine(line);
    if (!parsed) return line;
    parsed.properties = parsed.properties
      .map((p) => removeStyleRefs(p))
      .filter(Boolean);
    return reassembleStyleLine(parsed);
  }).filter((line): line is string => line !== null);
}

// --- Main API ---

const STRIP_FUNCTIONS: Record<DesignTreeStripType, (lines: string[]) => string[]> = {
  "layout-direction-spacing": stripLayoutSpacing,
  "size-constraints": stripSizeConstraints,
  "position-stacking": (lines) => lines,
  "color-values": stripColorValues,
  "typography": stripTypography,
  "shadows-effects": stripShadowsEffects,
  "component-references": stripComponentReferences,
  "component-descriptions": (lines) => lines,
  "node-names-hierarchy": stripNodeNames,
  "overflow-text-behavior": stripOverflow,
  "hover-interaction-states": stripHoverStates,
  "variable-references": stripVariableReferences,
  "style-references": stripStyleReferences,
};

/**
 * Strip a specific information type from a design-tree text.
 * Returns a new string with the target information removed.
 */
export function stripDesignTree(tree: string, type: DesignTreeStripType): string {
  const lines = tree.split("\n");
  const stripped = STRIP_FUNCTIONS[type](lines);
  return stripped.join("\n");
}
