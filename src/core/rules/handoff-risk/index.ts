import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";

// ============================================
// Helper functions
// ============================================

function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

function isContainerNode(node: AnalysisNode): boolean {
  return node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT";
}

function isTextNode(node: AnalysisNode): boolean {
  return node.type === "TEXT";
}

// ============================================
// hardcode-risk
// ============================================

const hardcodeRiskDef: RuleDefinition = {
  id: "hardcode-risk",
  name: "Hardcode Risk",
  category: "handoff-risk",
  why: "Hardcoded position/size values force AI to use magic numbers instead of computed layouts",
  impact: "Generated code is brittle — any content change (longer text, different image) breaks the layout",
  fix: "Use Auto Layout with relative positioning so AI generates flexible CSS",
};

const hardcodeRiskCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;

  // Check for absolute positioning
  if (node.layoutPositioning !== "ABSOLUTE") return null;

  // Check if parent has Auto Layout
  if (context.parent && hasAutoLayout(context.parent)) {
    return {
      ruleId: hardcodeRiskDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses absolute positioning with fixed values`,
    };
  }

  return null;
};

export const hardcodeRisk = defineRule({
  definition: hardcodeRiskDef,
  check: hardcodeRiskCheck,
});

// ============================================
// text-truncation-unhandled
// ============================================

const textTruncationUnhandledDef: RuleDefinition = {
  id: "text-truncation-unhandled",
  name: "Text Truncation Unhandled",
  category: "handoff-risk",
  why: "Long text in a narrow container without truncation rules — AI doesn't know if it should clip, ellipsis, or grow",
  impact: "AI may generate code where text overflows the container, breaking the visual layout",
  fix: "Set text truncation (ellipsis) or ensure the container uses 'Hug' so the intent is explicit",
};

const textTruncationUnhandledCheck: RuleCheckFn = (node, context) => {
  if (!isTextNode(node)) return null;

  // Check if parent is Auto Layout with fixed size
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;

  // Check if text has fixed width in the Auto Layout direction
  // This is a heuristic - would need more Figma API data for accuracy
  // Parent direction would be: context.parent.layoutMode

  // If parent is horizontal and text doesn't have truncation configured
  // Simplified check - full implementation would examine text truncation property
  if (node.absoluteBoundingBox) {
    const { width } = node.absoluteBoundingBox;
    // Flag if text is in a constrained space but long
    if (node.characters && node.characters.length > 50 && width < 300) {
      return {
        ruleId: textTruncationUnhandledDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" may need text truncation handling`,
      };
    }
  }

  return null;
};

export const textTruncationUnhandled = defineRule({
  definition: textTruncationUnhandledDef,
  check: textTruncationUnhandledCheck,
});

// ============================================
// prototype-link-in-design
// ============================================

const prototypeLinkInDesignDef: RuleDefinition = {
  id: "prototype-link-in-design",
  name: "Missing Prototype Interaction",
  category: "handoff-risk",
  why: "Interactive-looking elements without prototype interactions force developers to guess behavior",
  impact: "Developers cannot know the intended interaction (hover state, navigation, etc.)",
  fix: "Add prototype interactions to interactive elements, or use naming to clarify non-interactive intent",
};

/** Name patterns that suggest an interactive element */
const INTERACTIVE_NAME_PATTERNS = [
  /\bbtn\b/i, /\bbutton\b/i, /\blink\b/i, /\btab\b/i,
  /\bcta\b/i, /\btoggle\b/i, /\bswitch\b/i, /\bcheckbox\b/i,
  /\bradio\b/i, /\bdropdown\b/i, /\bselect\b/i, /\bmenu\b/i,
  /\bnav\b/i, /\bclickable\b/i, /\btappable\b/i,
];

/** Variant names that imply interactive states */
const STATE_VARIANT_PATTERNS = [
  /\bhover\b/i, /\bpressed\b/i, /\bactive\b/i, /\bfocused\b/i,
  /\bdisabled\b/i, /\bselected\b/i,
];

function looksInteractive(node: AnalysisNode): boolean {
  // Check name patterns
  if (node.name && INTERACTIVE_NAME_PATTERNS.some((p) => p.test(node.name))) {
    return true;
  }

  // Check if component has state variants (hover, pressed, etc.)
  if (node.componentPropertyDefinitions) {
    const propValues = Object.values(node.componentPropertyDefinitions);
    for (const prop of propValues) {
      const p = prop as Record<string, unknown>;
      // VARIANT type properties with state-like values
      if (p["type"] === "VARIANT" && p["variantOptions"]) {
        const options = p["variantOptions"] as string[];
        if (options.some((opt) => STATE_VARIANT_PATTERNS.some((pat) => pat.test(opt)))) {
          return true;
        }
      }
    }
  }

  return false;
}

const prototypeLinkInDesignCheck: RuleCheckFn = (node, context) => {
  // Only check components and instances (interactive elements are typically components)
  if (node.type !== "COMPONENT" && node.type !== "INSTANCE" && node.type !== "FRAME") return null;

  if (!looksInteractive(node)) return null;

  // If interactions exist, the element has prototype behavior defined
  if (node.interactions && node.interactions.length > 0) return null;

  return {
    ruleId: prototypeLinkInDesignDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" looks interactive but has no prototype interactions defined`,
  };
};

export const prototypeLinkInDesign = defineRule({
  definition: prototypeLinkInDesignDef,
  check: prototypeLinkInDesignCheck,
});

