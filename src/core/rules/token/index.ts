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
  why: "Raw hex colors are not connected to the design system",
  impact: "Color changes require manual updates across the entire design",
  fix: "Use a color style or variable instead of raw hex values",
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
      return {
        ruleId: rawColorDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" uses raw color without style or variable`,
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
  why: "Text without text styles is disconnected from the type system",
  impact: "Typography changes require manual updates across the design",
  fix: "Apply a text style to maintain consistency",
};

const rawFontCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "TEXT") return null;

  // Check if text style is applied
  if (hasStyleReference(node, "text")) return null;

  // Check for text variable bindings
  if (hasBoundVariable(node, "fontFamily") || hasBoundVariable(node, "fontSize")) {
    return null;
  }

  return {
    ruleId: rawFontDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has no text style applied`,
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
  why: "Spacing values outside the grid system break visual consistency",
  impact: "Inconsistent visual rhythm and harder to maintain",
  fix: "Use spacing values from the design system grid (e.g., 8pt increments)",
};

const inconsistentSpacingCheck: RuleCheckFn = (node, context, options) => {
  const gridBase = (options?.["gridBase"] as number) ?? getRuleOption("inconsistent-spacing", "gridBase", 4);

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
        message: `"${node.name}" has padding ${padding}px not on ${gridBase}pt grid`,
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
        message: `"${node.name}" has item spacing ${node.itemSpacing}px not on ${gridBase}pt grid`,
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
  why: "Arbitrary spacing values make the system harder to understand",
  impact: "Unpredictable spacing, harder to create consistent layouts",
  fix: "Round spacing to the nearest grid value or use spacing tokens",
};

const magicNumberSpacingCheck: RuleCheckFn = (node, context, options) => {
  const gridBase = (options?.["gridBase"] as number) ?? getRuleOption("magic-number-spacing", "gridBase", 4);

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
          message: `"${node.name}" uses magic number spacing: ${spacing}px`,
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
  why: "Shadow effects without styles are disconnected from the design system",
  impact: "Shadow changes require manual updates across the design",
  fix: "Create and apply an effect style for shadows",
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
      return {
        ruleId: rawShadowDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has shadow effect without effect style`,
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
  why: "Hardcoded opacity values are not connected to design tokens",
  impact: "Opacity changes require manual updates",
  fix: "Use opacity variables or consider if opacity is truly needed",
};

const rawOpacityCheck: RuleCheckFn = (node, _context) => {
  // Check if opacity variable is bound
  if (hasBoundVariable(node, "opacity")) return null;

  // This would need to check node opacity property
  // Simplified for now - needs more Figma API data
  return null;
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
  why: "Similar but slightly different colors indicate inconsistent token usage",
  impact: "Visual inconsistency and harder to maintain brand colors",
  fix: "Consolidate to a single color token or style",
};

const multipleFillColorsCheck: RuleCheckFn = (_node, _context, _options) => {
  // This rule needs to analyze colors across multiple nodes
  // It's better suited for a post-processing analysis phase
  // Simplified implementation - would need global context
  return null;
};

export const multipleFillColors = defineRule({
  definition: multipleFillColorsDef,
  check: multipleFillColorsCheck,
});
