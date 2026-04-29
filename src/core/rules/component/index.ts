import { existsSync } from "node:fs";
import { join } from "node:path";

import type { RuleCheckFn, RuleDefinition, RuleContext } from "../../contracts/rule.js";
import { getAnalysisState } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";
import { missingComponentMsg, detachedInstanceMsg, variantStructureMismatchMsg, unmappedComponentMsg } from "../rule-messages.js";

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
 * Walks the full ancestor type chain to detect INSTANCE at any level.
 */
function isInsideInstance(context: {
  ancestorTypes: string[];
}): boolean {
  return context.ancestorTypes.includes("INSTANCE");
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

/**
 * Phase 3 (#508 / #556) — Stage 3 group lookup table.
 *
 * One-time scope-wide pass that maps each fingerprint to the list of
 * qualifying FRAME ids. Built lazily on the first Stage 3 invocation in an
 * analysis run and cached on `context.analysisState` so subsequent per-node
 * calls just look up — O(1) per node instead of re-walking siblings every
 * time. Cached separately per `maxFingerprintDepth` so the rare per-call
 * option override stays correct.
 */
interface Stage3GroupInfo {
  /** Document-order id of the first qualifying FRAME in this group. */
  firstNodeId: string;
  /** Total qualifying FRAMEs in this group across the entire analysis scope. */
  count: number;
}

function stage3GroupsKey(maxDepth: number): string {
  return `missing-component:stage3Groups:depth=${maxDepth}`;
}

function nodeQualifiesForStage3(
  node: AnalysisNode,
  parent: AnalysisNode | null,
  insideInstance: boolean
): boolean {
  if (insideInstance) return false;
  if (node.type !== "FRAME") return false;
  if (parent?.type === "COMPONENT_SET") return false;
  if (!node.children || node.children.length === 0) return false;
  return true;
}

function buildStage3Groups(
  root: AnalysisNode,
  maxFingerprintDepth: number
): Map<string, Stage3GroupInfo> {
  const groups = new Map<string, Stage3GroupInfo>();
  const walk = (
    node: AnalysisNode,
    parent: AnalysisNode | null,
    ancestorIsInstance: boolean
  ): void => {
    const insideInstance = ancestorIsInstance || node.type === "INSTANCE";
    if (nodeQualifiesForStage3(node, parent, ancestorIsInstance)) {
      const fp = buildFingerprint(node, maxFingerprintDepth);
      const existing = groups.get(fp);
      if (existing) existing.count++;
      else groups.set(fp, { firstNodeId: node.id, count: 1 });
    }
    if (node.children) {
      for (const child of node.children) walk(child, node, insideInstance);
    }
  };
  walk(root, null, false);
  return groups;
}

function getStage3Groups(
  context: RuleContext,
  maxFingerprintDepth: number
): Map<string, Stage3GroupInfo> {
  return getAnalysisState(context, stage3GroupsKey(maxFingerprintDepth), () =>
    buildStage3Groups(context.file.document, maxFingerprintDepth)
  );
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

    // Stage 3: scope-wide structure-based repetition (#508 / #556)
    //
    // Pre-#556 the check restricted matching to `context.siblings` — same-
    // parent only. The cross-parent fingerprint pass (delta 3) replaces the
    // sibling walk with a one-time scope-wide pass cached on
    // `analysisState`, so duplicates spread across different parents now
    // land in the same fingerprint group and emit a single issue on the
    // document-order first qualifying FRAME.
    //
    // The per-node guards stay (`isInsideInstance`, `COMPONENT_SET` parent,
    // empty children) so a cheap reject path short-circuits before any map
    // lookup.
    if (isInsideInstance(context)) return null;
    if (context.parent?.type === "COMPONENT_SET") return null;
    if (!node.children || node.children.length === 0) return null;

    const structureMinRepetitions =
      (options?.["structureMinRepetitions"] as number | undefined) ??
      getRuleOption("missing-component", "structureMinRepetitions", 2);

    const maxFingerprintDepth =
      (options?.["maxFingerprintDepth"] as number | undefined) ??
      getRuleOption("missing-component", "maxFingerprintDepth", 3);

    const groups = getStage3Groups(context, maxFingerprintDepth);
    const fingerprint = buildFingerprint(node, maxFingerprintDepth);
    const group = groups.get(fingerprint);
    if (!group) return null;
    if (group.count < structureMinRepetitions) return null;
    if (group.firstNodeId !== node.id) return null;

    return {
      ruleId: missingComponentDef.id,
      subType: "structure-repetition" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...missingComponentMsg.structureRepetition(node.name, group.count - 1),
    };
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

// ============================================
// unmapped-component (#520, v1.5: #526)
// ============================================
//
// Fires once per main component (COMPONENT / COMPONENT_SET) when the consuming
// repo has Code Connect set up at all (figma.config.json present in cwd). The
// gotcha drives the user to /canicode-roundtrip for actual mapping
// registration via the Figma MCP tools.
//
// v1.5 (#526 sub-task 1): we now parse Code Connect mapping declarations from
// the project's `*.figma.tsx?` files (sourced from `figma.config.json`'s
// `codeConnect.include` paths) so already-mapped components are skipped. This
// addresses the v1 false-positive complaint without changing the rule's scope
// or severity. Parser failures are non-fatal and degrade to v1 behaviour
// (fire on every main).

import {
  parseCodeConnectMappings,
  type CodeConnectMappingResult,
} from "./code-connect-mapping-parser.js";
import { isRuleOptOutIntent } from "../../contracts/acknowledgment.js";

const CODE_CONNECT_SETUP_KEY = "unmapped-component:setup-detected";
const CODE_CONNECT_MAPPINGS_KEY = "unmapped-component:mappings";
const SEEN_MAIN_IDS_KEY = "unmapped-component:seen-main-ids";

function codeConnectIsSetUp(context: RuleContext): boolean {
  return getAnalysisState(context, CODE_CONNECT_SETUP_KEY, () => {
    return existsSync(join(process.cwd(), "figma.config.json"));
  });
}

function codeConnectMappings(context: RuleContext): CodeConnectMappingResult {
  return getAnalysisState(context, CODE_CONNECT_MAPPINGS_KEY, () =>
    parseCodeConnectMappings(process.cwd()),
  );
}

function seenMainIds(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_MAIN_IDS_KEY, () => new Set<string>());
}

const unmappedComponentDef: RuleDefinition = {
  id: "unmapped-component",
  name: "Unmapped Component",
  category: "code-quality",
  why: "Without a Code Connect mapping, figma-implement-design regenerates the same markup every time this component appears in a screen — wasting tokens and risking drift.",
  impact: "Future roundtrips on screens containing this component cannot reuse your existing code; they regenerate markup that may not match the canonical implementation.",
  fix: "Run /canicode-roundtrip on this component to register a mapping. Figma's get_code_connect_map will skip if a mapping already exists.",
};

const unmappedComponentCheck: RuleCheckFn = (node, context) => {
  if (!codeConnectIsSetUp(context)) return null;

  // #548: collapse three traversal entry points onto a single "main
  // component" axis. The rule previously fired only on COMPONENT /
  // COMPONENT_SET nodes inside the analyzed scope, which left every
  // screen-level analysis blind: a screen frame contains INSTANCEs whose
  // main definition lives elsewhere in the file, and the rule never saw
  // the main. Now an INSTANCE's `componentId` short-circuits to the same
  // (mapping / opt-out) checks against the main id, so screen-scope
  // analyze surfaces the rule and the gotcha survey can pick it up.
  let mainId: string | null = null;
  let mainName = node.name;
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    if (isInsideInstance(context)) return null;
    mainId = node.id;
  } else if (node.type === "INSTANCE" && node.componentId) {
    mainId = node.componentId;
    const meta = context.file.components[node.componentId];
    if (meta?.name) mainName = meta.name;
  } else {
    return null;
  }

  // Dedupe so multiple INSTANCEs of the same main (and a COMPONENT seen
  // alongside its INSTANCEs in the same scope) yield exactly one finding,
  // matching the existing "one annotation per main" assumption that the
  // ADR-022 opt-out write path encodes.
  const seen = seenMainIds(context);
  if (seen.has(mainId)) return null;
  seen.add(mainId);

  // v1.5 (#526 sub-task 1): consult parsed Code Connect declarations and
  // skip components that already carry a mapping. Parser failures return an
  // empty set, in which case this short-circuit is a no-op and the rule
  // fires v1-style on every main.
  const mappings = codeConnectMappings(context);
  if (mappings.mappedNodeIds.has(mainId)) return null;

  // ADR-022 / #526 sub-task 2: roundtrip-recorded opt-out short-circuit.
  // When the user marked this component as intentionally unmapped, the
  // canicode:intentionally-unmapped annotation arrives here as an
  // Acknowledgment whose `intent.kind === "rule-opt-out"` and
  // `intent.ruleId === "unmapped-component"`. The two skip paths are
  // independent — parser handles standalone analyze, ack handles the
  // roundtrip leg.
  const ack = context.findAcknowledgment(mainId, unmappedComponentDef.id);
  if (
    ack &&
    isRuleOptOutIntent(ack.intent) &&
    ack.intent.ruleId === unmappedComponentDef.id
  ) {
    return null;
  }

  return {
    ruleId: unmappedComponentDef.id,
    nodeId: mainId,
    nodePath: context.path.join(" > "),
    ...unmappedComponentMsg(mainName),
  };
};

export const unmappedComponent = defineRule({
  definition: unmappedComponentDef,
  check: unmappedComponentCheck,
});
