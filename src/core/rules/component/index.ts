import type { RuleCheckFn, RuleDefinition, RuleContext } from "../../contracts/rule.js";
import { getAnalysisState } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";
import { missingComponentMsg, detachedInstanceMsg, variantStructureMismatchMsg } from "../rule-messages.js";

// ============================================
// Helper functions
// ============================================


/** Style properties to compare between master and instance. */
const STYLE_COMPARE_KEYS = ["fills", "strokes", "effects", "cornerRadius", "strokeWeight", "individualStrokeWeights"] as const;

/**
 * Detect style overrides between a component master and an instance.
 * Returns list of property names that differ.
 */
function detectStyleOverrides(master: AnalysisNode, instance: AnalysisNode): string[] {
  const overrides: string[] = [];
  for (const key of STYLE_COMPARE_KEYS) {
    const masterVal = master[key];
    const instanceVal = instance[key];
    // Both undefined/null → no override
    if (masterVal == null && instanceVal == null) continue;
    // One exists, other doesn't → override
    if (masterVal == null || instanceVal == null) {
      overrides.push(key);
      continue;
    }
    // Deep compare via JSON
    if (JSON.stringify(masterVal) !== JSON.stringify(instanceVal)) {
      overrides.push(key);
    }
  }
  return overrides;
}

/**
 * Collect all frame names in the file for duplicate detection
 */
function collectFrameNames(
  node: AnalysisNode,
  names: Map<string, string[]> = new Map()
): Map<string, string[]> {
  if (node.type === "FRAME" && node.name) {
    const existing = names.get(node.name) ?? [];
    existing.push(node.id);
    names.set(node.name, existing);
  }

  if (node.children) {
    for (const child of node.children) {
      collectFrameNames(child, names);
    }
  }

  return names;
}

/**
 * Build a structural fingerprint for a node.
 * The fingerprint encodes type, layoutMode, and child types recursively up to maxDepth.
 */
function buildFingerprint(node: AnalysisNode, depth: number): string {
  if (depth <= 0 || !node.children || node.children.length === 0) {
    return `${node.type}:${node.layoutMode ?? "NONE"}`;
  }

  const childFingerprints = node.children
    .map((child) => buildFingerprint(child, depth - 1))
    .join(",");

  return `${node.type}:${node.layoutMode ?? "NONE"}:[${childFingerprints}]`;
}

/**
 * Check if the node is inside an INSTANCE subtree.
 * Currently checks immediate parent only — RuleContext does not expose the full
 * ancestor type chain (context.path contains names, not types).
 * TODO: When the engine exposes ancestor types, extend to full chain check.
 */
function isInsideInstance(context: {
  parent?: AnalysisNode | undefined;
}): boolean {
  return context.parent?.type === "INSTANCE";
}



// ============================================
// missing-component (unified 4-stage rule)
// ============================================

/** State keys for per-analysis deduplication via RuleContext.analysisState */
const SEEN_STAGE1_KEY = "missing-component:seenStage1ComponentNames";
const SEEN_STAGE4_KEY = "missing-component:seenStage4ComponentIds";

function getSeenStage1(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_STAGE1_KEY, () => new Set<string>());
}

function getSeenStage4(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_STAGE4_KEY, () => new Set<string>());
}

const missingComponentDef: RuleDefinition = {
  id: "missing-component",
  name: "Missing Component",
  category: "code-quality",
  why: "Repeated structures, unused components, and divergent instance overrides indicate missing or underutilized components. This inflates AI token consumption and forces manual maintenance.",
  impact: "AI code generators reproduce each repeated frame independently instead of emitting a reusable component. Divergent instance overrides produce inconsistent implementations.",
  fix: "Create components from repeated structures, use instances instead of duplicated frames, and create variants for instances with significantly different overrides.",
};

const missingComponentCheck: RuleCheckFn = (node, context, options) => {
  // ========================================
  // FRAME stages (1, 2, 3) — ordered by priority
  // ========================================
  if (node.type === "FRAME") {
    // Stage 1: Component exists but not used — FRAME name matches a component in metadata AND frame is repeated
    const components = context.file.components;
    const matchingComponent = Object.values(components).find(
      (c) => c.name.toLowerCase() === node.name.toLowerCase()
    );

    // Collect frame names once for Stage 1 and Stage 2
    const frameNames = collectFrameNames(context.file.document);
    const sameNameFrames = frameNames.get(node.name);
    const firstFrame = sameNameFrames?.[0];

    if (matchingComponent) {
      const seenStage1 = getSeenStage1(context);
      if (
        sameNameFrames &&
        firstFrame !== undefined &&
        sameNameFrames.length >= 2 &&
        !seenStage1.has(node.name.toLowerCase()) &&
        firstFrame === node.id
      ) {
        seenStage1.add(node.name.toLowerCase());
        return {
          ruleId: missingComponentDef.id,
          subType: "unused-component" as const,
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          ...missingComponentMsg.unusedComponent(matchingComponent.name, sameNameFrames.length),
        };
      }
    }

    // Stage 2: Name-based repetition (existing logic)
    const minRepetitions =
      (options?.["minRepetitions"] as number | undefined) ??
      getRuleOption("missing-component", "minRepetitions", 3);

    if (sameNameFrames && firstFrame !== undefined && sameNameFrames.length >= minRepetitions) {
      if (firstFrame === node.id) {
        return {
          ruleId: missingComponentDef.id,
          subType: "name-repetition" as const,
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          ...missingComponentMsg.nameRepetition(node.name, sameNameFrames.length),
        };
      }
    }

    // Stage 3: Structure-based repetition (absorbed from repeated-frame-structure)
    // Skip if node is inside an INSTANCE subtree
    if (isInsideInstance(context)) return null;

    // Skip if parent is COMPONENT_SET
    if (context.parent?.type === "COMPONENT_SET") return null;

    // Skip if node has no children
    if (!node.children || node.children.length === 0) return null;

    const structureMinRepetitions =
      (options?.["structureMinRepetitions"] as number | undefined) ??
      getRuleOption("missing-component", "structureMinRepetitions", 2);

    const maxFingerprintDepth =
      (options?.["maxFingerprintDepth"] as number | undefined) ??
      getRuleOption("missing-component", "maxFingerprintDepth", 3);

    // Compute fingerprint for this node
    const fingerprint = buildFingerprint(node, maxFingerprintDepth);

    // Access siblings (may be undefined)
    const siblings = context.siblings ?? [];

    // Filter siblings to qualifying frames (type === FRAME, not inside INSTANCE, has children)
    const qualifyingSiblings = siblings.filter(
      (s) =>
        s.type === "FRAME" &&
        s.children !== undefined &&
        s.children.length > 0
    );

    // Count siblings (including self) sharing the same fingerprint
    const matchingNodes = qualifyingSiblings.filter(
      (s) => buildFingerprint(s, maxFingerprintDepth) === fingerprint
    );

    // Ensure self is counted (it should be in siblings, but add a guard)
    const selfIsInSiblings = qualifyingSiblings.some((s) => s.id === node.id);
    const count = selfIsInSiblings
      ? matchingNodes.length
      : matchingNodes.length + 1;

    if (count >= structureMinRepetitions) {
      // Only emit for the first sibling (by array order) with this fingerprint
      const firstMatch = qualifyingSiblings.find(
        (s) => buildFingerprint(s, maxFingerprintDepth) === fingerprint
      );

      // If self is not in siblings list, treat self as first match when no earlier match exists
      const firstMatchId = firstMatch?.id ?? node.id;
      if (firstMatchId === node.id) {
        return {
          ruleId: missingComponentDef.id,
          subType: "structure-repetition" as const,
          nodeId: node.id,
          nodePath: context.path.join(" > "),
          ...missingComponentMsg.structureRepetition(node.name, count - 1),
        };
      }
    }

    return null;
  }

  // ========================================
  // Stage 4: Instance style override detection
  // Compares instance styles against component master.
  // Any style override (fills, strokes, effects, cornerRadius) means
  // the designer should use a variant instead.
  // ========================================
  if (node.type === "INSTANCE" && node.componentId) {
    const seenStage4 = getSeenStage4(context);
    if (seenStage4.has(node.componentId)) return null;

    const componentDefs = context.file.componentDefinitions;
    if (!componentDefs) return null;

    const master = componentDefs[node.componentId];
    if (!master) return null;

    // Compare style properties between master and instance
    const overrides = detectStyleOverrides(master, node);
    if (overrides.length > 0) {
      // Only mark as seen when we actually flag — allows other instances to be checked
      seenStage4.add(node.componentId);
      const componentMeta = context.file.components[node.componentId];
      const componentName = componentMeta?.name ?? node.name;

      return {
        ruleId: missingComponentDef.id,
        subType: "style-override" as const,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        ...missingComponentMsg.styleOverride(componentName, overrides),
      };
    }
    return null;
  }

  return null;
};

export const missingComponent = defineRule({
  definition: missingComponentDef,
  check: missingComponentCheck,
});

// ============================================
// detached-instance
// ============================================

const detachedInstanceDef: RuleDefinition = {
  id: "detached-instance",
  name: "Detached Instance",
  category: "code-quality",
  why: "Detached instances lose component relationship — AI sees a one-off frame instead of a reusable component reference",
  impact: "AI generates duplicate code instead of reusing the component, inflating output and causing inconsistencies",
  fix: "Reset the instance or create a new variant if customization is needed",
};

const detachedInstanceCheck: RuleCheckFn = (node, context) => {
  // A detached instance would be a FRAME that was once an INSTANCE
  // This is hard to detect without historical data
  // Heuristic: Frame with a name that looks like it came from a component
  if (node.type !== "FRAME") return null;

  // Check if there's a component in the file with a matching name (word boundary)
  const components = context.file.components;

  for (const [, component] of Object.entries(components)) {
    const pattern = new RegExp(`\\b${component.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    if (pattern.test(node.name)) {
      // This frame might be a detached instance of this component
      return {
        ruleId: detachedInstanceDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        ...detachedInstanceMsg(node.name, component.name),
      };
    }
  }

  return null;
};

export const detachedInstance = defineRule({
  definition: detachedInstanceDef,
  check: detachedInstanceCheck,
});

// ============================================
// variant-structure-mismatch
// ============================================

const variantStructureMismatchDef: RuleDefinition = {
  id: "variant-structure-mismatch",
  name: "Variant Structure Mismatch",
  category: "code-quality",
  why: "Variants with different child structures prevent AI from creating a unified component template",
  impact: "AI must generate separate implementations for each variant instead of a single parameterized component",
  fix: "Ensure all variants share the same child structure, using visibility toggles for optional elements",
};

const variantStructureMismatchCheck: RuleCheckFn = (node, context) => {
  // Only COMPONENT_SET
  if (node.type !== "COMPONENT_SET") return null;
  if (!node.children?.length || node.children.length < 2) return null;

  // Build fingerprint for each variant child
  const fingerprints = node.children
    .filter(child => child.type === "COMPONENT")
    .map(child => buildFingerprint(child, 2));

  if (fingerprints.length < 2) return null;

  // Compare all fingerprints to the first one
  const base = fingerprints[0];
  const mismatched = fingerprints.filter(fp => fp !== base);

  if (mismatched.length === 0) return null;

  const mismatchCount = mismatched.length;
  const totalVariants = fingerprints.length;

  return {
    ruleId: variantStructureMismatchDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...variantStructureMismatchMsg(node.name, mismatchCount, totalVariants),
  };
};

export const variantStructureMismatch = defineRule({
  definition: variantStructureMismatchDef,
  check: variantStructureMismatchCheck,
});

