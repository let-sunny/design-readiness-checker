import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";

// ============================================
// Helper functions
// ============================================

function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

function isTextNode(node: AnalysisNode): boolean {
  return node.type === "TEXT";
}

// ============================================
// text-truncation-unhandled
// ============================================

const textTruncationUnhandledDef: RuleDefinition = {
  id: "text-truncation-unhandled",
  name: "Text Truncation Unhandled",
  category: "behavior",
  why: "Long text in a narrow container without truncation rules — AI doesn't know if it should clip, ellipsis, or grow",
  impact: "AI may generate code where text overflows the container, breaking the visual layout",
  fix: "Set text truncation (ellipsis) or ensure the container uses 'Hug' so the intent is explicit",
};

const textTruncationUnhandledCheck: RuleCheckFn = (node, context) => {
  if (!isTextNode(node)) return null;

  // Check if parent is Auto Layout with fixed size
  if (!context.parent) return null;
  if (!hasAutoLayout(context.parent)) return null;

  if (node.absoluteBoundingBox) {
    const { width } = node.absoluteBoundingBox;
    if (node.characters && node.characters.length > 50 && width < 300) {
      return {
        ruleId: textTruncationUnhandledDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has long text (${node.characters!.length} chars) in narrow container (${width}px) — set text truncation (ellipsis) or use HUG sizing`,
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
  category: "behavior",
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
        const options = p["variantOptions"];
        if (Array.isArray(options) && options.some((opt) => typeof opt === "string" && STATE_VARIANT_PATTERNS.some((pat) => pat.test(opt)))) {
          return true;
        }
      }
    }
  }

  return false;
}

/** Check if any descendant has interactions defined */
function hasDescendantInteractions(node: AnalysisNode): boolean {
  if (node.interactions && node.interactions.length > 0) return true;
  for (const child of node.children ?? []) {
    if (hasDescendantInteractions(child)) return true;
  }
  return false;
}

const prototypeLinkInDesignCheck: RuleCheckFn = (node, context) => {
  // Only check components and instances (interactive elements are typically components)
  if (node.type !== "COMPONENT" && node.type !== "INSTANCE" && node.type !== "FRAME") return null;

  if (!looksInteractive(node)) return null;

  // If interactions exist on this node, it's covered
  if (node.interactions && node.interactions.length > 0) return null;

  // Skip container frames whose children already have interactions (e.g., "Button Group" wrapping interactive buttons)
  if (node.type === "FRAME" && node.children && node.children.length > 0) {
    if (hasDescendantInteractions(node)) return null;
  }

  return {
    ruleId: prototypeLinkInDesignDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" looks interactive but has no prototype interactions — add prototype interactions or rename to clarify non-interactive intent`,
  };
};

export const prototypeLinkInDesign = defineRule({
  definition: prototypeLinkInDesignDef,
  check: prototypeLinkInDesignCheck,
});

// ============================================
// overflow-behavior-unknown
// ============================================

const overflowBehaviorUnknownDef: RuleDefinition = {
  id: "overflow-behavior-unknown",
  name: "Overflow Behavior Unknown",
  category: "behavior",
  why: "Children overflowing parent bounds without explicit clip/scroll behavior forces AI to guess overflow handling",
  impact: "AI may generate incorrect overflow: hidden, scroll, or visible — breaking the intended design",
  fix: "Enable 'Clip content' or set an explicit overflow/scroll behavior on the container",
};

const overflowBehaviorUnknownCheck: RuleCheckFn = (node, context) => {
  // Only check container nodes
  if (!["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE"].includes(node.type)) return null;
  // Must have children
  if (!node.children?.length) return null;
  // Check parent bounds
  const parentBox = node.absoluteBoundingBox;
  if (!parentBox) return null;
  // If clipsContent is true, behavior is explicit — skip
  if (node.clipsContent === true) return null;
  // Check if any visible child overflows
  const hasOverflow = node.children.some(child => {
    if (child.visible === false) return false;
    const childBox = child.absoluteBoundingBox;
    if (!childBox) return false;
    return (
      childBox.x < parentBox.x ||
      childBox.y < parentBox.y ||
      // +1 tolerance for floating-point rounding in Figma coordinates
      childBox.x + childBox.width > parentBox.x + parentBox.width + 1 ||
      childBox.y + childBox.height > parentBox.y + parentBox.height + 1
    );
  });
  if (!hasOverflow) return null;
  return {
    ruleId: overflowBehaviorUnknownDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has children overflowing bounds without explicit clip/scroll behavior — enable "Clip content" or set explicit scroll behavior`,
  };
};

export const overflowBehaviorUnknown = defineRule({
  definition: overflowBehaviorUnknownDef,
  check: overflowBehaviorUnknownCheck,
});

// ============================================
// wrap-behavior-unknown
// ============================================

const wrapBehaviorUnknownDef: RuleDefinition = {
  id: "wrap-behavior-unknown",
  name: "Wrap Behavior Unknown",
  category: "behavior",
  why: "Horizontal children exceeding container width without wrap behavior forces AI to guess if content should wrap or scroll",
  impact: "AI may generate incorrect flex-wrap or overflow behavior, breaking the layout on narrow screens",
  fix: "Set layoutWrap to WRAP if children should flow to the next line, or add explicit overflow/scroll behavior",
};

const wrapBehaviorUnknownCheck: RuleCheckFn = (node, context) => {
  // Only horizontal Auto Layout
  if (node.layoutMode !== "HORIZONTAL") return null;
  // Need 3+ visible children
  const visibleChildren = (node.children ?? []).filter(c => c.visible !== false);
  if (visibleChildren.length < 3) return null;
  // layoutWrap must be unset or NO_WRAP
  if (node.layoutWrap === "WRAP") return null;
  // Check if children total width exceeds parent
  const parentBox = node.absoluteBoundingBox;
  if (!parentBox) return null;
  // Skip if any child lacks bounding box data — can't reliably compare widths
  const childrenWithBox = visibleChildren.filter(c => c.absoluteBoundingBox);
  if (childrenWithBox.length !== visibleChildren.length) return null;
  const totalChildWidth = childrenWithBox.reduce((sum, child) => {
    return sum + child.absoluteBoundingBox!.width;
  }, 0);
  if (totalChildWidth <= parentBox.width) return null;
  return {
    ruleId: wrapBehaviorUnknownDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has ${visibleChildren.length} horizontal children exceeding container width without wrap behavior — set layoutWrap to WRAP or add horizontal scroll behavior`,
  };
};

export const wrapBehaviorUnknown = defineRule({
  definition: wrapBehaviorUnknownDef,
  check: wrapBehaviorUnknownCheck,
});
