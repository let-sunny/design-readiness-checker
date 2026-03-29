import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import { defineRule } from "../rule-registry.js";
import { getDefaultNameSubType, nonSemanticNameMsg, inconsistentNamingMsg, nonStandardNamingMsg } from "../rule-messages.js";
import { isExcludedName, isDefaultName, isNonSemanticName, STANDARD_STATE_NAMES, STATE_NAME_SUGGESTIONS, STATE_LIKE_PATTERN } from "../node-semantics.js";

function detectNamingConvention(name: string): string | null {
  if (/^[a-z]+(-[a-z]+)*$/.test(name)) return "kebab-case";
  if (/^[a-z]+(_[a-z]+)*$/.test(name)) return "snake_case";
  if (/^[a-z]+([A-Z][a-z]*)*$/.test(name)) return "camelCase";
  // Single capitalized word (e.g., "Header") is ambiguous — compatible with both PascalCase and Title Case
  if (/^[A-Z][a-z]+$/.test(name)) return null;
  if (/^[A-Z][a-z]+([A-Z][a-z]*)+$/.test(name)) return "PascalCase";
  if (/^[A-Z]+(_[A-Z]+)*$/.test(name)) return "SCREAMING_SNAKE_CASE";
  if (/\s/.test(name)) return "Title Case";
  return null;
}

// ============================================
// non-semantic-name (merged: default-name + non-semantic-name)
// ============================================

const nonSemanticNameDef: RuleDefinition = {
  id: "non-semantic-name",
  name: "Non-Semantic Name",
  category: "minor",
  why: "Default or shape names give AI no semantic context — it cannot choose appropriate HTML tags or class names",
  impact: "AI generates generic <div> wrappers instead of semantic elements like <header>, <nav>, <article>",
  fix: "Rename with a descriptive, purpose-driven name (e.g., 'Header', 'ProductCard', 'Divider')",
};

const nonSemanticNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (isExcludedName(node.name)) return null;

  // Check 1: Figma default names (Frame 1, Group 2, etc.)
  if (isDefaultName(node.name)) {
    return {
      ruleId: nonSemanticNameDef.id,
      subType: getDefaultNameSubType(node.type),
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...nonSemanticNameMsg(node.type, node.name),
    };
  }

  // Check 2: Shape-only names (rectangle, ellipse, vector, etc.)
  if (isNonSemanticName(node.name)) {
    // Allow shape names for actual shape primitives at leaf level
    if (!node.children || node.children.length === 0) {
      const shapeTypes = ["RECTANGLE", "ELLIPSE", "VECTOR", "LINE", "STAR", "REGULAR_POLYGON"];
      if (shapeTypes.includes(node.type)) return null;
    }

    return {
      ruleId: nonSemanticNameDef.id,
      subType: "shape-name" as const,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      ...nonSemanticNameMsg(node.type, node.name),
    };
  }

  return null;
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
      ...inconsistentNamingMsg(node.name, nodeConvention, dominantConvention),
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
  fix: "Use platform-standard state names: default, hover, active, pressed, selected, highlighted, disabled, enabled, focus, focused, dragged",
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
            ...nonStandardNamingMsg.stateName(node.name, opt, suggestion),
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

