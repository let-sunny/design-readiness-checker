import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import { defineRule } from "../rule-registry.js";
import { defaultNameMsg, getDefaultNameSubType, nonSemanticNameMsg, inconsistentNamingMsg, nonStandardNamingMsg } from "../rule-messages.js";
import { isExcludedName, isDefaultName, isNonSemanticName, STANDARD_STATE_NAMES, STATE_NAME_SUGGESTIONS, STATE_LIKE_PATTERN } from "../node-semantics.js";

function detectNamingConvention(name: string): string | null {
  if (/^[a-z]+(-[a-z]+)*$/.test(name)) return "kebab-case";
  if (/^[a-z]+(_[a-z]+)*$/.test(name)) return "snake_case";
  if (/^[a-z]+([A-Z][a-z]*)*$/.test(name)) return "camelCase";
  if (/^[A-Z][a-z]+([A-Z][a-z]*)*$/.test(name)) return "PascalCase";
  if (/^[A-Z]+(_[A-Z]+)*$/.test(name)) return "SCREAMING_SNAKE_CASE";
  if (/\s/.test(name)) return "Title Case";
  return null;
}

// ============================================
// default-name
// ============================================

const defaultNameDef: RuleDefinition = {
  id: "default-name",
  name: "Default Name",
  category: "minor",
  why: "Default names like 'Frame 123' give AI no semantic context to choose appropriate HTML tags or class names",
  impact: "AI generates generic <div> wrappers instead of semantic elements like <header>, <nav>, <article>",
  fix: "Rename with a descriptive name (e.g., 'Header', 'ProductCard') so AI can infer semantic structure",
};

const defaultNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (isExcludedName(node.name)) return null;
  if (!isDefaultName(node.name)) return null;

  return {
    ruleId: defaultNameDef.id,
    subType: getDefaultNameSubType(node.type),
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: defaultNameMsg(node.type, node.name),
  };
};

export const defaultName = defineRule({
  definition: defaultNameDef,
  check: defaultNameCheck,
});

// ============================================
// non-semantic-name
// ============================================

const nonSemanticNameDef: RuleDefinition = {
  id: "non-semantic-name",
  name: "Non-Semantic Name",
  category: "minor",
  why: "Shape names like 'Rectangle' tell AI nothing about the element's role in the UI",
  impact: "AI cannot distinguish a divider from a background from a border — all look like 'Rectangle'",
  fix: "Use purpose-driven names (e.g., 'Divider', 'Avatar') so AI generates meaningful markup",
};

const nonSemanticNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (isExcludedName(node.name)) return null;
  if (!isNonSemanticName(node.name)) return null;

  // Allow non-semantic names for actual shape primitives at leaf level
  if (!node.children || node.children.length === 0) {
    const shapeTypes = ["RECTANGLE", "ELLIPSE", "VECTOR", "LINE", "STAR", "REGULAR_POLYGON"];
    if (shapeTypes.includes(node.type)) return null;
  }

  return {
    ruleId: nonSemanticNameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: nonSemanticNameMsg(node.type, node.name),
  };
};

export const nonSemanticName = defineRule({
  definition: nonSemanticNameDef,
  check: nonSemanticNameCheck,
});

// ============================================
// inconsistent-naming-convention
// ============================================

const inconsistentNamingConventionDef: RuleDefinition = {
  id: "inconsistent-naming-convention",
  name: "Inconsistent Naming Convention",
  category: "minor",
  why: "Mixed naming conventions (camelCase + kebab-case + Title Case) at the same level confuse AI pattern recognition",
  impact: "AI generates inconsistent class/component names, making the codebase harder to maintain",
  fix: "Pick one convention for sibling elements (e.g., kebab-case: 'product-card', or PascalCase: 'ProductCard') — AI maps names to CSS classes and component names, so mixed conventions produce inconsistent code",
};

const inconsistentNamingConventionCheck: RuleCheckFn = (node, context) => {
  if (!context.siblings || context.siblings.length < 2) return null;

  // Detect conventions used by siblings
  const conventions = new Map<string, number>();

  for (const sibling of context.siblings) {
    if (!sibling.name) continue;
    const convention = detectNamingConvention(sibling.name);
    if (convention) {
      conventions.set(convention, (conventions.get(convention) ?? 0) + 1);
    }
  }

  // Skip if we can't detect clear conventions
  if (conventions.size < 2) return null;

  // Find the dominant convention
  let dominantConvention = "";
  let maxCount = 0;
  for (const [convention, count] of conventions) {
    if (count > maxCount) {
      maxCount = count;
      dominantConvention = convention;
    }
  }

  // Check if current node violates the dominant convention
  const nodeConvention = detectNamingConvention(node.name);
  if (nodeConvention && nodeConvention !== dominantConvention && maxCount >= 2) {
    return {
      ruleId: inconsistentNamingConventionDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: inconsistentNamingMsg(node.name, nodeConvention, dominantConvention),
    };
  }

  return null;
};

export const inconsistentNamingConvention = defineRule({
  definition: inconsistentNamingConventionDef,
  check: inconsistentNamingConventionCheck,
});

// ============================================
// non-standard-naming
// ============================================

const nonStandardNamingDef: RuleDefinition = {
  id: "non-standard-naming",
  name: "Non-Standard Naming",
  category: "minor",
  why: "Non-standard state names prevent interaction rules from detecting state variants — AI cannot generate correct :hover/:active/:disabled styles",
  impact: "Interaction state detection fails, resulting in static UI with no state transitions",
  fix: "Use platform-standard state names: hover, active, pressed, selected, highlighted, disabled, focus, focused",
};

const nonStandardNamingCheck: RuleCheckFn = (node, context) => {
  // Only check COMPONENT_SET (variant container)
  if (node.type !== "COMPONENT_SET") return null;
  if (!node.componentPropertyDefinitions) return null;

  for (const prop of Object.values(node.componentPropertyDefinitions)) {
    const p = prop as Record<string, unknown>;
    if (p["type"] !== "VARIANT") continue;
    const options = p["variantOptions"];
    if (!Array.isArray(options)) continue;

    for (const opt of options) {
      if (typeof opt !== "string") continue;
      const lower = opt.toLowerCase().trim();

      // Skip if it's a standard name
      if (STANDARD_STATE_NAMES.has(lower)) continue;

      // Check if it matches a known non-standard state name
      if (STATE_LIKE_PATTERN.test(opt)) {
        const suggestion = STATE_NAME_SUGGESTIONS[lower];
        if (suggestion) {
          return {
            ruleId: nonStandardNamingDef.id,
            subType: "state-name" as const,
            nodeId: node.id,
            nodePath: context.path.join(" > "),
            message: nonStandardNamingMsg.stateName(node.name, opt, suggestion),
          };
        }
      }
    }
  }

  return null;
};

export const nonStandardNaming = defineRule({
  definition: nonStandardNamingDef,
  check: nonStandardNamingCheck,
});

