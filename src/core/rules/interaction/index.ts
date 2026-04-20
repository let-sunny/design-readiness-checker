import type { RuleCheckFn, RuleDefinition, RuleContext } from "../../contracts/rule.js";
import { getAnalysisState } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import type { MissingInteractionStateSubType, MissingPrototypeSubType } from "../rule-messages.js";
import { missingInteractionStateMsg, missingPrototypeMsg } from "../rule-messages.js";
import { getStatefulComponentType, isOverlayNode, isCarouselNode, type StatefulComponentType } from "../node-semantics.js";

/** Expected state variants by interactive type */
const EXPECTED_STATES: Record<StatefulComponentType, MissingInteractionStateSubType[]> = {
  button: ["hover", "active", "disabled"],
  link: ["hover"],
  tab: ["hover", "active"],
  input: ["focus", "disabled"],
  toggle: ["disabled"],
};

/** State name patterns — web + mobile platform standard names */
const STATE_PATTERNS: Record<MissingInteractionStateSubType, RegExp> = {
  hover: /\bhover\b/i,
  disabled: /\bdisabled\b/i,
  active: /\b(active|pressed|selected|highlighted)\b/i,
  focus: /\bfocus(ed)?\b/i,
};

// ============================================
// Helpers
// ============================================

/** Dedup key: emit at most one violation per componentId + subType */
const SEEN_KEY = "missing-interaction-state:seen";

function getSeen(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_KEY, () => new Set<string>());
}

/**
 * Check if a state variant exists via componentPropertyDefinitions.
 * Looks for VARIANT type properties where variantOptions contain the state name.
 */
function hasStateInVariantProps(node: AnalysisNode, statePattern: RegExp): boolean {
  if (!node.componentPropertyDefinitions) return false;
  for (const prop of Object.values(node.componentPropertyDefinitions)) {
    const p = prop as Record<string, unknown>;
    if (p["type"] !== "VARIANT") continue;
    const options = p["variantOptions"];
    if (!Array.isArray(options)) continue;
    if (options.some((opt) => typeof opt === "string" && statePattern.test(opt))) {
      return true;
    }
  }
  return false;
}

/**
 * Check if a state variant exists via component master's componentPropertyDefinitions.
 * Falls back to componentDefinitions (fetched masters) when the instance itself
 * doesn't carry the property definitions.
 */
function hasStateInComponentMaster(
  node: AnalysisNode,
  context: RuleContext,
  statePattern: RegExp,
): boolean {
  if (!node.componentId) return false;
  const defs = context.file.componentDefinitions;
  if (!defs) return false;
  const master = defs[node.componentId];
  if (!master) return false;
  return hasStateInVariantProps(master, statePattern);
}

/**
 * Master names that look like a single variant of a SET (e.g. `State=Default`,
 * `Variant=Primary, State=Default, Size=Medium`). When a fetched COMPONENT
 * carries this naming AND has no own `componentPropertyDefinitions`, the
 * variant axes live on the parent COMPONENT_SET — which the loader does not
 * fetch today (#397). Treat as undeterminable rather than asserting a missing
 * variant we cannot actually see.
 */
const VARIANT_POSITION_NAME_RE = /^[\w ]+=[^,]+(,\s*[\w ]+=[^,]+)*$/;

function hasUsablePropDefs(propDefs: unknown): boolean {
  // `undefined` = not fetched; `null` = REST returned blank (e.g. variant
  // INSIDE a SET — axes live on the SET parent, not here). Both are
  // non-evidence. `{}` (fetched-and-empty) IS positive evidence the master
  // truly has no axes — must keep firing per the test for #354.
  return propDefs != null && typeof propDefs === "object";
}

/**
 * Decide whether we have enough source data to assert a state variant is missing.
 *
 * The Figma REST API does not consistently mirror `componentPropertyDefinitions`
 * onto deeply-nested INSTANCE children, and `context.file.componentDefinitions`
 * only contains masters the loader actually fetched (external-library masters
 * stay null even after extra passes). When BOTH paths are empty for an INSTANCE
 * we cannot tell whether the master defines the variant or not — treat that as
 * "unknown" (return false here) rather than asserting a missing variant.
 *
 * The fetched master may also be a single variant of a SET (name like
 * `State=Default`); the variant axes live on the SET parent which we do not
 * fetch. Detect this via name pattern and treat as undeterminable too (#397).
 *
 * COMPONENT nodes are special: a COMPONENT IS the master, so the absence of
 * `componentPropertyDefinitions` on a COMPONENT is itself meaningful evidence
 * (standalone master with no variant axis at all) — UNLESS the COMPONENT name
 * follows the variant-position pattern, in which case the SET parent holds the
 * axes and we cannot decide.
 */
function canDetermineVariants(node: AnalysisNode, context: RuleContext): boolean {
  if (hasUsablePropDefs(node.componentPropertyDefinitions)) return true;
  if (node.type === "COMPONENT") {
    return !VARIANT_POSITION_NAME_RE.test(node.name);
  }
  if (node.componentId !== undefined) {
    const defs = context.file.componentDefinitions;
    const master = defs?.[node.componentId];
    if (master) {
      if (hasUsablePropDefs(master.componentPropertyDefinitions)) return true;
      return !VARIANT_POSITION_NAME_RE.test(master.name);
    }
  }
  return false;
}

// ============================================
// missing-interaction-state
// ============================================

const missingInteractionStateDef: RuleDefinition = {
  id: "missing-interaction-state",
  name: "Missing Interaction State",
  category: "interaction",
  why: "Interactive components without state variants force AI to guess hover/focus/disabled appearances — or skip them entirely",
  impact: "Generated code has no :hover, :focus, or :disabled styles, making the UI feel static and unresponsive",
  fix: "Add state variants (Hover, Disabled, Focus, Active) to interactive components in Figma",
};

const missingInteractionStateCheck: RuleCheckFn = (node, context) => {
  // Only check component instances and components
  if (node.type !== "INSTANCE" && node.type !== "COMPONENT") return null;

  const interactiveType = getStatefulComponentType(node);
  if (!interactiveType) return null;

  const expectedStates = EXPECTED_STATES[interactiveType];
  if (!expectedStates) return null;

  // Probe gate: only assert a missing variant when we can actually observe the
  // master's variant axes. For nested INSTANCE children whose master was not
  // fetched into `componentDefinitions` and whose own `componentPropertyDefinitions`
  // is undefined, treat the verdict as unknown and skip — this avoids the
  // false-positive class described in #354. The data-availability check is
  // per-node (not per-state), so it lives outside the for-loop below.
  if (!canDetermineVariants(node, context)) return null;

  const seen = getSeen(context);
  const nodePath = context.path.join(" > ");

  for (const state of expectedStates) {
    const dedupeKey = `${node.componentId ?? node.id}:${state}`;
    if (seen.has(dedupeKey)) continue;

    const pattern = STATE_PATTERNS[state];

    // Check variant properties on instance
    if (hasStateInVariantProps(node, pattern)) continue;

    // Check variant properties on component master (fetched definitions)
    if (hasStateInComponentMaster(node, context, pattern)) continue;

    // Missing state — report first missing one
    seen.add(dedupeKey);
    return {
      ruleId: missingInteractionStateDef.id,
      subType: state,
      nodeId: node.id,
      nodePath,
      ...missingInteractionStateMsg[state](node.name),
    };
  }

  return null;
};

export const missingInteractionState = defineRule({
  definition: missingInteractionStateDef,
  check: missingInteractionStateCheck,
});

// ============================================
// missing-prototype
// ============================================

/** Interactive types that need click prototype */
const PROTOTYPE_TYPES: Record<StatefulComponentType, MissingPrototypeSubType> = {
  button: "button",
  link: "navigation",
  tab: "tab",
  input: "input",
  toggle: "toggle",
};

function getPrototypeSubType(node: AnalysisNode): MissingPrototypeSubType | null {
  // Check overlay/carousel first — select/dropdown are classified as "input" in
  // STATEFUL_PATTERNS but need "overlay" subType for prototype checks
  if (isOverlayNode(node)) return "overlay";
  if (isCarouselNode(node)) return "carousel";
  const interactiveType = getStatefulComponentType(node);
  if (interactiveType) {
    const mapped = PROTOTYPE_TYPES[interactiveType];
    if (mapped) return mapped;
  }
  return null;
}

function hasInteractionTrigger(node: AnalysisNode, triggerType: string): boolean {
  if (!node.interactions || !Array.isArray(node.interactions)) return false;
  return node.interactions.some((interaction) => {
    const i = interaction as { trigger?: { type?: string } };
    return i.trigger?.type === triggerType;
  });
}

/** Check if node (or its component master) has any of the given trigger types */
function hasAnyInteraction(node: AnalysisNode, context: RuleContext, triggers: string[]): boolean {
  for (const trigger of triggers) {
    if (hasInteractionTrigger(node, trigger)) return true;
  }
  // INSTANCE nodes don't inherit interactions from master — check master fallback
  if (node.componentId && context.file.componentDefinitions) {
    const master = context.file.componentDefinitions[node.componentId];
    if (master) {
      for (const trigger of triggers) {
        if (hasInteractionTrigger(master, trigger)) return true;
      }
    }
  }
  return false;
}

/** Trigger types to check per subType */
const PROTOTYPE_TRIGGERS: Record<string, string[]> = {
  carousel: ["ON_CLICK", "ON_DRAG"],
};

const DEFAULT_TRIGGERS = ["ON_CLICK"];

const missingPrototypeDef: RuleDefinition = {
  id: "missing-prototype",
  name: "Missing Prototype",
  category: "interaction",
  why: "Interactive elements without prototype interactions give AI no information about navigation or behavior",
  impact: "AI cannot generate interaction handlers, routing, or state changes — interactive elements become static",
  fix: "Add prototype interactions (ON_CLICK, ON_DRAG) to define navigation targets or state changes",
};

const SEEN_PROTO_KEY = "missing-prototype:seen";

function getSeenProto(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_PROTO_KEY, () => new Set<string>());
}

const missingPrototypeCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "INSTANCE" && node.type !== "COMPONENT" && node.type !== "FRAME") return null;

  const subType = getPrototypeSubType(node);
  if (!subType) return null;

  // Already has relevant interaction (click, or drag for carousel)
  const triggers = PROTOTYPE_TRIGGERS[subType] ?? DEFAULT_TRIGGERS;
  if (hasAnyInteraction(node, context, triggers)) return null;

  // Dedup per componentId + subType
  const seen = getSeenProto(context);
  const dedupeKey = `${node.componentId ?? node.id}:${subType}`;
  if (seen.has(dedupeKey)) return null;
  seen.add(dedupeKey);

  return {
    ruleId: missingPrototypeDef.id,
    subType,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    ...missingPrototypeMsg[subType](node.name),
  };
};

export const missingPrototype = defineRule({
  definition: missingPrototypeDef,
  check: missingPrototypeCheck,
});
