import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";

// ============================================
// Helper functions
// ============================================

function hasAutoLayout(node: AnalysisNode): boolean {
  return node.layoutMode !== undefined && node.layoutMode !== "NONE";
}

function isContainerNode(node: AnalysisNode): boolean {
  return node.type === "FRAME" || node.type === "GROUP" || node.type === "COMPONENT";
}

function hasOverlappingBounds(a: AnalysisNode, b: AnalysisNode): boolean {
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

// ============================================
// ambiguous-structure
// ============================================

const ambiguousStructureDef: RuleDefinition = {
  id: "ambiguous-structure",
  name: "Ambiguous Structure",
  category: "ai-readability",
  why: "Overlapping nodes without Auto Layout create ambiguous visual hierarchy",
  impact: "AI cannot reliably determine the reading order or structure",
  fix: "Use Auto Layout to create clear, explicit structure",
};

const ambiguousStructureCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  if (hasAutoLayout(node)) return null; // Auto Layout provides clear structure
  if (!node.children || node.children.length < 2) return null;

  // Check for overlapping children
  for (let i = 0; i < node.children.length; i++) {
    for (let j = i + 1; j < node.children.length; j++) {
      const childA = node.children[i];
      const childB = node.children[j];

      if (childA && childB && hasOverlappingBounds(childA, childB)) {
        // Check if this is intentional layering (both visible)
        if (childA.visible !== false && childB.visible !== false) {
          return {
            ruleId: ambiguousStructureDef.id,
            nodeId: node.id,
            nodePath: context.path.join(" > "),
            message: `"${node.name}" has overlapping children without Auto Layout`,
          };
        }
      }
    }
  }

  return null;
};

export const ambiguousStructure = defineRule({
  definition: ambiguousStructureDef,
  check: ambiguousStructureCheck,
});

// ============================================
// z-index-dependent-layout
// ============================================

const zIndexDependentLayoutDef: RuleDefinition = {
  id: "z-index-dependent-layout",
  name: "Z-Index Dependent Layout",
  category: "ai-readability",
  why: "Using overlapping layers to create visual layout is hard to interpret",
  impact: "Code generation may misinterpret the intended layout",
  fix: "Restructure using Auto Layout to express the visual relationship explicitly",
};

const zIndexDependentLayoutCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  if (!node.children || node.children.length < 2) return null;

  // Look for patterns where position overlap is used to create visual effects
  // e.g., badge on card, avatar overlapping header
  let significantOverlapCount = 0;

  for (let i = 0; i < node.children.length; i++) {
    for (let j = i + 1; j < node.children.length; j++) {
      const childA = node.children[i];
      const childB = node.children[j];

      if (!childA || !childB) continue;
      if (childA.visible === false || childB.visible === false) continue;

      const boxA = childA.absoluteBoundingBox;
      const boxB = childB.absoluteBoundingBox;

      if (!boxA || !boxB) continue;

      if (hasOverlappingBounds(childA, childB)) {
        // Calculate overlap percentage
        const overlapX = Math.min(boxA.x + boxA.width, boxB.x + boxB.width) -
          Math.max(boxA.x, boxB.x);
        const overlapY = Math.min(boxA.y + boxA.height, boxB.y + boxB.height) -
          Math.max(boxA.y, boxB.y);

        if (overlapX > 0 && overlapY > 0) {
          const overlapArea = overlapX * overlapY;
          const smallerArea = Math.min(
            boxA.width * boxA.height,
            boxB.width * boxB.height
          );

          // If overlap is significant (> 20% of smaller element)
          if (overlapArea > smallerArea * 0.2) {
            significantOverlapCount++;
          }
        }
      }
    }
  }

  if (significantOverlapCount > 0) {
    return {
      ruleId: zIndexDependentLayoutDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" uses layer stacking for layout (${significantOverlapCount} overlaps)`,
    };
  }

  return null;
};

export const zIndexDependentLayout = defineRule({
  definition: zIndexDependentLayoutDef,
  check: zIndexDependentLayoutCheck,
});

// ============================================
// missing-layout-hint
// ============================================

const missingLayoutHintDef: RuleDefinition = {
  id: "missing-layout-hint",
  name: "Missing Layout Hint",
  category: "ai-readability",
  why: "Complex nesting without Auto Layout makes structure unpredictable",
  impact: "AI may generate incorrect code due to ambiguous relationships",
  fix: "Add Auto Layout or simplify the nesting structure",
};

const missingLayoutHintCheck: RuleCheckFn = (node, context) => {
  if (!isContainerNode(node)) return null;
  if (hasAutoLayout(node)) return null;
  if (!node.children || node.children.length === 0) return null;

  // Check for nested containers without layout hints
  const nestedContainers = node.children.filter((c) => isContainerNode(c));

  // If there are multiple nested containers without layout direction
  if (nestedContainers.length >= 2) {
    const withoutLayout = nestedContainers.filter((c) => !hasAutoLayout(c));

    if (withoutLayout.length >= 2) {
      return {
        ruleId: missingLayoutHintDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" has ${withoutLayout.length} nested containers without layout hints`,
      };
    }
  }

  return null;
};

export const missingLayoutHint = defineRule({
  definition: missingLayoutHintDef,
  check: missingLayoutHintCheck,
});

// ============================================
// invisible-layer
// ============================================

const invisibleLayerDef: RuleDefinition = {
  id: "invisible-layer",
  name: "Invisible Layer",
  category: "ai-readability",
  why: "Hidden layers increase API response size and node count but are skipped during code generation. They are a normal part of the Figma workflow (version history, A/B options, state layers) and do not block implementation.",
  impact: "Minor token overhead from larger API responses. No impact on code generation accuracy since hidden nodes are excluded from the design tree.",
  fix: "No action required if hidden layers are intentional. Clean up unused hidden layers to reduce file size. If a frame has many hidden children representing states, consider using Figma's Slot feature for cleaner state management.",
};

const invisibleLayerCheck: RuleCheckFn = (node, context) => {
  if (node.visible !== false) return null;

  // Skip if parent is also invisible (only report top-level invisible)
  if (context.parent?.visible === false) return null;

  // Check if parent has many hidden children — suggest Slot
  const slotThreshold =
    getRuleOption("invisible-layer", "slotRecommendationThreshold", 3);
  const hiddenSiblingCount = context.siblings
    ? context.siblings.filter((s) => s.visible === false).length
    : 0;

  if (hiddenSiblingCount >= slotThreshold) {
    return {
      ruleId: invisibleLayerDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" is hidden (${hiddenSiblingCount} hidden siblings) — if these represent states, consider using Figma Slots instead`,
    };
  }

  return {
    ruleId: invisibleLayerDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" is hidden — no impact on code generation, clean up if unused`,
  };
};

export const invisibleLayer = defineRule({
  definition: invisibleLayerDef,
  check: invisibleLayerCheck,
});

// ============================================
// empty-frame
// ============================================

const emptyFrameDef: RuleDefinition = {
  id: "empty-frame",
  name: "Empty Frame",
  category: "ai-readability",
  why: "Empty frames add noise and may indicate incomplete design",
  impact: "Generates unnecessary wrapper elements in code",
  fix: "Remove the frame or add content",
};

const emptyFrameCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "FRAME") return null;
  if (node.children && node.children.length > 0) return null;

  // Allow empty frames that are clearly placeholders (small size)
  if (node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox;
    // Allow small placeholder frames (icons, spacers)
    if (width <= 48 && height <= 48) return null;
  }

  return {
    ruleId: emptyFrameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" is an empty frame`,
  };
};

export const emptyFrame = defineRule({
  definition: emptyFrameDef,
  check: emptyFrameCheck,
});
