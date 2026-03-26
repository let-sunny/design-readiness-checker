import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";

// ============================================
// Helper functions
// ============================================

function hasStyleReference(node: AnalysisNode, styleType: string): boolean {
  return node.styles !== undefined && styleType in node.styles;
}

function hasBoundVariable(node: AnalysisNode, key: string): boolean {
  return node.boundVariables !== undefined && key in node.boundVariables;
}

function isOnGrid(value: number, gridBase: number): boolean {
  return value % gridBase === 0;
}

// ============================================
// raw-color
// ============================================

const rawColorDef: RuleDefinition = {
  id: "raw-color",
  name: "Raw Color",
  category: "token",
  why: "Raw hex values repeated across nodes increase the chance of AI mismatching colors in large pages",
  impact: "AI must reproduce each exact hex value independently — one typo means a visible color difference",
  fix: "Use a color style or variable so AI can reference a single token instead of hardcoded values",
};

const rawColorCheck: RuleCheckFn = (node, context) => {
  // Skip nodes without fills
  if (!node.fills || !Array.isArray(node.fills)) return null;
  if (node.fills.length === 0) return null;

  // Check if fill style is applied
  if (hasStyleReference(node, "fill")) return null;

  // Check if color variable is bound
  if (hasBoundVariable(node, "fills")) return null;

  // Check each fill for raw colors
  for (const fill of node.fills) {
    const fillObj = fill as Record<string, unknown>;
    if (fillObj["type"] === "SOLID" && fillObj["color"]) {
      const c = fillObj["color"] as Record<string, number>;
      const hex = `#${Math.round((c["r"] ?? 0) * 255).toString(16).padStart(2, "0")}${Math.round((c["g"] ?? 0) * 255).toString(16).padStart(2, "0")}${Math.round((c["b"] ?? 0) * 255).toString(16).padStart(2, "0")}`.toUpperCase();
      return {
        ruleId: rawColorDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" uses raw fill color ${hex} without style or variable — bind to a color variable`,
      };
    }
  }

  return null;
};

export const rawColor = defineRule({
  definition: rawColorDef,
  check: rawColorCheck,
});

// ============================================
// raw-font
// ============================================

const rawFontDef: RuleDefinition = {
  id: "raw-font",
  name: "Raw Font",
  category: "token",
  why: "Without text styles, AI must reproduce exact font/size/weight combinations per node — easy to get one wrong",
  impact: "Inconsistent typography in generated code when the same style appears with slightly different values",
  fix: "Apply text styles so AI can reference a single token for consistent typography",
};

const rawFontCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "TEXT") return null;

  // Check if text style is applied
  if (hasStyleReference(node, "text")) return null;

  // Check for text variable bindings
  if (hasBoundVariable(node, "fontFamily") || hasBoundVariable(node, "fontSize")) {
    return null;
  }

  const fontParts: string[] = [];
  const s = node.style;
  if (s) {
    if (s["fontFamily"]) fontParts.push(String(s["fontFamily"]));
    if (s["fontSize"]) fontParts.push(`${s["fontSize"]}px`);
    if (s["fontWeight"]) fontParts.push(String(s["fontWeight"]));
  }
  const fontDesc = fontParts.length > 0 ? ` (${fontParts.join(" ")})` : "";

  return {
    ruleId: rawFontDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" uses raw font${fontDesc} without text style — apply a text style`,
  };
};

export const rawFont = defineRule({
  definition: rawFontDef,
  check: rawFontCheck,
});

// ============================================
// inconsistent-spacing
// ============================================

const inconsistentSpacingDef: RuleDefinition = {
  id: "inconsistent-spacing",
  name: "Inconsistent Spacing",
  category: "token",
  why: "Off-grid spacing forces AI to handle many unique values instead of a predictable pattern",
  impact: "AI may round to nearby values or apply wrong spacing when many similar-but-different values exist",
  fix: "Align spacing to the design system grid (e.g., 4pt/8pt increments) for predictable implementation",
};

const inconsistentSpacingCheck: RuleCheckFn = (node, context, options) => {
  const configuredGridBase = (options?.["gridBase"] as number) ?? getRuleOption("inconsistent-spacing", "gridBase", 4);
  const gridBase = Number.isFinite(configuredGridBase) && configuredGridBase > 0 ? configuredGridBase : 4;

  // Check padding values
  const paddings = [
    node.paddingLeft,
    node.paddingRight,
    node.paddingTop,
    node.paddingBottom,
  ].filter((p): p is number => p !== undefined && p > 0);

  for (const padding of paddings) {
    if (!isOnGrid(padding, gridBase)) {
      return {
        ruleId: inconsistentSpacingDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has padding ${padding}px not on ${gridBase}pt grid — round to nearest ${gridBase}pt multiple (${Math.round(padding / gridBase) * gridBase}px)`,
      };
    }
  }

  // Check item spacing
  if (node.itemSpacing !== undefined && node.itemSpacing > 0) {
    if (!isOnGrid(node.itemSpacing, gridBase)) {
      return {
        ruleId: inconsistentSpacingDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has item spacing ${node.itemSpacing}px not on ${gridBase}pt grid — round to nearest ${gridBase}pt multiple (${Math.round(node.itemSpacing / gridBase) * gridBase}px)`,
      };
    }
  }

  return null;
};

export const inconsistentSpacing = defineRule({
  definition: inconsistentSpacingDef,
  check: inconsistentSpacingCheck,
});

// ============================================
// magic-number-spacing
// ============================================

const magicNumberSpacingDef: RuleDefinition = {
  id: "magic-number-spacing",
  name: "Magic Number Spacing",
  category: "token",
  why: "Arbitrary values like 13px or 17px have no pattern AI can learn — each must be reproduced exactly",
  impact: "Higher chance of pixel-level differences when AI substitutes nearby round values",
  fix: "Round to the nearest grid value or use spacing tokens for predictable AI output",
};

const magicNumberSpacingCheck: RuleCheckFn = (node, context, options) => {
  const configuredGridBase = (options?.["gridBase"] as number) ?? getRuleOption("magic-number-spacing", "gridBase", 4);
  const gridBase = Number.isFinite(configuredGridBase) && configuredGridBase > 0 ? configuredGridBase : 4;

  // Similar to inconsistent-spacing but focuses on finding "magic" numbers
  // Magic numbers are often odd values like 13, 17, 23, etc.
  const allSpacings = [
    node.paddingLeft,
    node.paddingRight,
    node.paddingTop,
    node.paddingBottom,
    node.itemSpacing,
  ].filter((s): s is number => s !== undefined && s > 0);

  for (const spacing of allSpacings) {
    // Check if it's not on grid AND not a common intentional value
    const commonValues = [1, 2, 4]; // Allow 1, 2, 4 as intentional small values
    if (!isOnGrid(spacing, gridBase) && !commonValues.includes(spacing)) {
      // Only flag truly "magic" numbers (prime-ish, odd values)
      if (spacing % 2 !== 0 && spacing > 4) {
        return {
          ruleId: magicNumberSpacingDef.id,
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          message: `"${node.name}" uses magic number spacing: ${spacing}px — round to ${Math.round(spacing / gridBase) * gridBase}px (nearest ${gridBase}pt grid value)`,
        };
      }
    }
  }

  return null;
};

export const magicNumberSpacing = defineRule({
  definition: magicNumberSpacingDef,
  check: magicNumberSpacingCheck,
});

// ============================================
// raw-shadow
// ============================================

const rawShadowDef: RuleDefinition = {
  id: "raw-shadow",
  name: "Raw Shadow",
  category: "token",
  why: "Raw shadow values (offset, blur, spread, color) are complex — AI must reproduce each parameter exactly",
  impact: "Shadow mismatches are visually obvious and hard to debug in generated code",
  fix: "Use an effect style so AI can reference a single token for consistent shadows",
};

const rawShadowCheck: RuleCheckFn = (node, context) => {
  if (!node.effects || !Array.isArray(node.effects)) return null;
  if (node.effects.length === 0) return null;

  // Check if effect style is applied
  if (hasStyleReference(node, "effect")) return null;

  // Check for shadow effects
  for (const effect of node.effects) {
    const effectObj = effect as Record<string, unknown>;
    if (
      effectObj["type"] === "DROP_SHADOW" ||
      effectObj["type"] === "INNER_SHADOW"
    ) {
      const shadowType = effectObj["type"] === "DROP_SHADOW" ? "drop shadow" : "inner shadow";
      const offset = effectObj["offset"] as Record<string, number> | undefined;
      const radius = effectObj["radius"] as number | undefined;
      const detailParts: string[] = [];
      if (offset) detailParts.push(`offset ${Math.round(offset["x"] ?? 0)},${Math.round(offset["y"] ?? 0)}`);
      if (radius !== undefined) detailParts.push(`blur ${Math.round(radius)}`);
      const details = detailParts.length > 0 ? ` (${detailParts.join(" ")})` : "";
      return {
        ruleId: rawShadowDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has ${shadowType}${details} without effect style — apply an effect style`,
      };
    }
  }

  return null;
};

export const rawShadow = defineRule({
  definition: rawShadowDef,
  check: rawShadowCheck,
});

// ============================================
// raw-opacity
// ============================================

const rawOpacityDef: RuleDefinition = {
  id: "raw-opacity",
  name: "Raw Opacity",
  category: "token",
  why: "Hardcoded opacity values must be reproduced exactly per node — easy to miss subtle transparency differences",
  impact: "AI may apply wrong opacity or miss it entirely, causing visible differences in overlays and backgrounds",
  fix: "Use opacity variables so the value is explicit and referenceable",
};

const rawOpacityCheck: RuleCheckFn = (node, context) => {
  // Only flag nodes with non-default opacity (< 1)
  if (node.opacity === undefined) return null;

  // Check if opacity variable is bound (tokenized)
  if (hasBoundVariable(node, "opacity")) return null;

  return {
    ruleId: rawOpacityDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" uses raw opacity (${Math.round(node.opacity * 100)}%) without a variable binding — bind opacity to a variable`,
  };
};

export const rawOpacity = defineRule({
  definition: rawOpacityDef,
  check: rawOpacityCheck,
});

// ============================================
// multiple-fill-colors
// ============================================

const multipleFillColorsDef: RuleDefinition = {
  id: "multiple-fill-colors",
  name: "Multiple Fill Colors",
  category: "token",
  why: "Near-duplicate colors (#3B82F6 vs #3B81F6) force AI to decide which is intentional and which is a mistake",
  impact: "AI may unify them incorrectly or faithfully reproduce the mismatch — both produce wrong output",
  fix: "Consolidate to a single color token so the intent is unambiguous",
};

/** Extract solid fill color as [r,g,b] (0-255) from a node, or null */
function extractSolidColor(node: AnalysisNode): [number, number, number] | null {
  if (!node.fills || !Array.isArray(node.fills) || node.fills.length === 0) return null;
  // Skip nodes with style references (already tokenized)
  if (node.styles && "fill" in node.styles) return null;
  for (const fill of node.fills) {
    const f = fill as Record<string, unknown>;
    if (f["type"] === "SOLID" && f["color"]) {
      const c = f["color"] as Record<string, number>;
      return [
        Math.round((c["r"] ?? 0) * 255),
        Math.round((c["g"] ?? 0) * 255),
        Math.round((c["b"] ?? 0) * 255),
      ];
    }
  }
  return null;
}

/** Euclidean distance between two RGB colors */
function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

// Both nodes in a near-duplicate pair are flagged individually — intentional,
// so each affected node appears in the issue list with its own location.
const multipleFillColorsCheck: RuleCheckFn = (node, context, options) => {
  if (!context.siblings || context.siblings.length < 2) return null;

  const myColor = extractSolidColor(node);
  if (!myColor) return null;

  const tolerance = (options?.["tolerance"] as number) ?? getRuleOption("multiple-fill-colors", "tolerance", 10);

  for (const sibling of context.siblings) {
    if (sibling.id === node.id) continue;
    const sibColor = extractSolidColor(sibling);
    if (!sibColor) continue;

    const dist = colorDistance(myColor, sibColor);
    // Flag if colors are similar but not identical (distance > 0 but within tolerance)
    if (dist > 0 && dist <= tolerance) {
      const myHex = `#${myColor[0].toString(16).padStart(2, "0")}${myColor[1].toString(16).padStart(2, "0")}${myColor[2].toString(16).padStart(2, "0")}`.toUpperCase();
      const sibHex = `#${sibColor[0].toString(16).padStart(2, "0")}${sibColor[1].toString(16).padStart(2, "0")}${sibColor[2].toString(16).padStart(2, "0")}`.toUpperCase();
      return {
        ruleId: multipleFillColorsDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" (${myHex}) has near-duplicate fill compared to sibling "${sibling.name}" (${sibHex}) — consolidate to a single color token`,
      };
    }
  }

  return null;
};

export const multipleFillColors = defineRule({
  definition: multipleFillColorsDef,
  check: multipleFillColorsCheck,
});
