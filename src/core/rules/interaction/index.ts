import type { RuleCheckFn, RuleDefinition, RuleContext } from "../../contracts/rule.js";
import { getAnalysisState } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import type { MissingInteractionStateSubType, MissingPrototypeSubType } from "../rule-messages.js";
import { missingInteractionStateMsg, missingPrototypeMsg } from "../rule-messages.js";

// ============================================
// Interactive component classification
// ============================================

type InteractiveType = "button" | "link" | "tab" | "input" | "toggle";

const INTERACTIVE_PATTERNS: Array<{ pattern: RegExp; type: InteractiveType }> = [
  { pattern: /\b(btn|button|cta)\b/i, type: "button" },
  { pattern: /\b(link|anchor)\b/i, type: "link" },
  { pattern: /\b(tab|tabs)\b/i, type: "tab" },
  { pattern: /\b(nav|navigation|menu|navbar)\b/i, type: "tab" },
  { pattern: /\b(input|text-?field|search-?bar|textarea)\b/i, type: "input" },
  { pattern: /\b(select|dropdown|combo-?box)\b/i, type: "input" },
  { pattern: /\b(toggle|switch|checkbox|radio)\b/i, type: "toggle" },
];

function getInteractiveType(node: AnalysisNode): InteractiveType | null {
  if (!node.name) return null;
  for (const entry of INTERACTIVE_PATTERNS) {
    if (entry.pattern.test(node.name)) return entry.type;
  }
  return null;
}

/** Expected state variants by interactive type */
const EXPECTED_STATES: Record<InteractiveType, MissingInteractionStateSubType[]> = {
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

  const interactiveType = getInteractiveType(node);
  if (!interactiveType) return null;

  const expectedStates = EXPECTED_STATES[interactiveType];
  if (!expectedStates) return null;

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
      message: missingInteractionStateMsg[state](node.name),
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
const PROTOTYPE_TYPES: Record<InteractiveType, MissingPrototypeSubType> = {
  button: "button",
  link: "navigation",
  tab: "tab",
  input: "input",
  toggle: "toggle",
};

/** Name patterns for overlay elements (open on top of current view) */
const OVERLAY_PATTERN = /\b(dropdown|select|combo-?box|popover|accordion|drawer|modal|bottom-?sheet|sheet|sidebar|panel|dialog|popup|toast)\b/i;

/** Name patterns for carousel elements (swipe/slide between items) */
const CAROUSEL_PATTERN = /\b(carousel|slider|swiper|slide-?show|gallery)\b/i;

function getPrototypeSubType(node: AnalysisNode): MissingPrototypeSubType | null {
  // Check dropdown pattern first — select/dropdown are classified as "input" in
  // INTERACTIVE_PATTERNS but need "dropdown" subType for prototype checks
  if (node.name && OVERLAY_PATTERN.test(node.name)) return "overlay";
  if (node.name && CAROUSEL_PATTERN.test(node.name)) return "carousel";
  const interactiveType = getInteractiveType(node);
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

/** Check if node (or its component master) has ON_CLICK prototype interaction */
function hasClickInteraction(node: AnalysisNode, context: RuleContext): boolean {
  if (hasInteractionTrigger(node, "ON_CLICK")) return true;
  // INSTANCE nodes don't inherit interactions from master — check master fallback
  if (node.componentId && context.file.componentDefinitions) {
    const master = context.file.componentDefinitions[node.componentId];
    if (master && hasInteractionTrigger(master, "ON_CLICK")) return true;
  }
  return false;
}

const missingPrototypeDef: RuleDefinition = {
  id: "missing-prototype",
  name: "Missing Prototype",
  category: "interaction",
  why: "Interactive elements without click prototypes give AI no information about navigation or behavior on click",
  impact: "AI cannot generate click handlers, routing, or state changes — interactive elements become static",
  fix: "Add ON_CLICK prototype interactions to define navigation targets or state changes",
};

const SEEN_PROTO_KEY = "missing-prototype:seen";

function getSeenProto(context: RuleContext): Set<string> {
  return getAnalysisState(context, SEEN_PROTO_KEY, () => new Set<string>());
}

const missingPrototypeCheck: RuleCheckFn = (node, context) => {
  if (node.type !== "INSTANCE" && node.type !== "COMPONENT" && node.type !== "FRAME") return null;

  const subType = getPrototypeSubType(node);
  if (!subType) return null;

  // Already has click interaction (check instance + master)
  if (hasClickInteraction(node, context)) return null;

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
    message: missingPrototypeMsg[subType](node.name),
  };
};

export const missingPrototype = defineRule({
  definition: missingPrototypeDef,
  check: missingPrototypeCheck,
});
