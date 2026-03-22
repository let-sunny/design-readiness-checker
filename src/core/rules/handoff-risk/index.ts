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

function isImageNode(node: AnalysisNode): boolean {
  // Images are often rectangles with image fills
  if (node.type === "RECTANGLE" && node.fills) {
    for (const fill of node.fills) {
      const fillObj = fill as Record<string, unknown>;
      if (fillObj["type"] === "IMAGE") return true;
    }
  }
  return false;
}

// ============================================
// hardcode-risk
// ============================================

const hardcodeRiskDef: RuleDefinition = {
  id: "hardcode-risk",
  name: "Hardcode Risk",
  category: "handoff-risk",
  why: "Absolute positioning with fixed values creates inflexible layouts",
  impact: "Layout will break when content changes or on different screens",
  fix: "Use Auto Layout with relative positioning",
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
  why: "Text nodes without truncation handling may overflow",
  impact: "Long text will break the layout",
  fix: "Set text truncation (ellipsis) or ensure container can grow",
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
// image-no-placeholder
// ============================================

const imageNoPlaceholderDef: RuleDefinition = {
  id: "image-no-placeholder",
  name: "Image No Placeholder",
  category: "handoff-risk",
  why: "Images without placeholder state may cause layout shifts",
  impact: "Poor user experience during image loading",
  fix: "Define a placeholder state or background color",
};

const imageNoPlaceholderCheck: RuleCheckFn = (node, context) => {
  if (!isImageNode(node)) return null;

  // Check if there's a background color or placeholder indicator
  // This is a heuristic - images should have fallback fills
  if (node.fills && Array.isArray(node.fills) && node.fills.length === 1) {
    const fill = node.fills[0] as Record<string, unknown>;
    if (fill["type"] === "IMAGE") {
      return {
        ruleId: imageNoPlaceholderDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" image has no placeholder fill`,
      };
    }
  }

  return null;
};

export const imageNoPlaceholder = defineRule({
  definition: imageNoPlaceholderDef,
  check: imageNoPlaceholderCheck,
});

// ============================================
// prototype-link-in-design
// ============================================

const prototypeLinkInDesignDef: RuleDefinition = {
  id: "prototype-link-in-design",
  name: "Prototype Link in Design",
  category: "handoff-risk",
  why: "Prototype connections may affect how the design is interpreted",
  impact: "Developers may misunderstand which elements should be interactive",
  fix: "Document interactions separately or use clear naming",
};

const prototypeLinkInDesignCheck: RuleCheckFn = (_node, _context) => {
  // This would require checking prototype/interaction data
  // Not available in basic node structure - needs more Figma API data
  return null;
};

export const prototypeLinkInDesign = defineRule({
  definition: prototypeLinkInDesignDef,
  check: prototypeLinkInDesignCheck,
});

// ============================================
// no-dev-status
// ============================================

const noDevStatusDef: RuleDefinition = {
  id: "no-dev-status",
  name: "No Dev Status",
  category: "handoff-risk",
  why: "Without dev status, developers cannot know if a design is ready",
  impact: "May implement designs that are still in progress",
  fix: "Mark frames as 'Ready for Dev' or 'Completed' when appropriate",
};

const noDevStatusCheck: RuleCheckFn = (node, context) => {
  // Only check top-level frames (likely screens/pages)
  if (node.type !== "FRAME") return null;
  if (context.depth > 1) return null;

  // Check for devStatus
  if (node.devStatus) return null;

  return {
    ruleId: noDevStatusDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has no dev status set`,
  };
};

export const noDevStatus = defineRule({
  definition: noDevStatusDef,
  check: noDevStatusCheck,
});
