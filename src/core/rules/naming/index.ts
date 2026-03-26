import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";
import { isExcludedName } from "../excluded-names.js";

// ============================================
// Helper functions
// ============================================

const DEFAULT_NAME_PATTERNS = [
  /^Frame\s*\d*$/i,
  /^Group\s*\d*$/i,
  /^Rectangle\s*\d*$/i,
  /^Ellipse\s*\d*$/i,
  /^Vector\s*\d*$/i,
  /^Line\s*\d*$/i,
  /^Text\s*\d*$/i,
  /^Image\s*\d*$/i,
  /^Component\s*\d*$/i,
  /^Instance\s*\d*$/i,
];

const NON_SEMANTIC_NAMES = [
  "rectangle",
  "ellipse",
  "vector",
  "line",
  "polygon",
  "star",
  "path",
  "shape",
  "image",
  "fill",
  "stroke",
];

function isDefaultName(name: string): boolean {
  return DEFAULT_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function isNonSemanticName(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  return NON_SEMANTIC_NAMES.includes(normalized);
}

function hasNumericSuffix(name: string): boolean {
  return /\s+\d+$/.test(name);
}

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
  category: "naming",
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
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `${node.type} "${node.name}" has a default name — rename to describe its purpose (e.g., "Header", "ProductCard")`,
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
  category: "naming",
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
    message: `${node.type} "${node.name}" is a non-semantic name — rename to describe its role (e.g., "Divider", "Background")`,
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
  category: "naming",
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
      message: `"${node.name}" uses ${nodeConvention} while siblings use ${dominantConvention} — rename to match ${dominantConvention} convention`,
    };
  }

  return null;
};

export const inconsistentNamingConvention = defineRule({
  definition: inconsistentNamingConventionDef,
  check: inconsistentNamingConventionCheck,
});

// ============================================
// numeric-suffix-name
// ============================================

const numericSuffixNameDef: RuleDefinition = {
  id: "numeric-suffix-name",
  name: "Numeric Suffix Name",
  category: "naming",
  why: "Names like 'Card 2', 'Card 3' signal copy-paste patterns that should be components",
  impact: "AI reproduces each copy independently instead of generating a reusable component",
  fix: "Remove the suffix and create a component, or rename to describe the difference",
};

const numericSuffixNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (isExcludedName(node.name)) return null;
  if (isDefaultName(node.name)) return null; // Already caught by default-name
  if (!hasNumericSuffix(node.name)) return null;

  return {
    ruleId: numericSuffixNameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has a numeric suffix — remove suffix and extract as component, or rename to describe the difference`,
  };
};

export const numericSuffixName = defineRule({
  definition: numericSuffixNameDef,
  check: numericSuffixNameCheck,
});

// ============================================
// too-long-name
// ============================================

const tooLongNameDef: RuleDefinition = {
  id: "too-long-name",
  name: "Too Long Name",
  category: "naming",
  why: "Excessively long names consume AI context tokens without adding proportional value",
  impact: "Wastes token budget in the design tree — especially costly in large pages with hundreds of nodes",
  fix: "Shorten the name while keeping it descriptive (under 50 characters)",
};

const tooLongNameCheck: RuleCheckFn = (node, context, options) => {
  if (!node.name) return null;

  const maxLength = (options?.["maxLength"] as number) ??
    getRuleOption("too-long-name", "maxLength", 50);

  if (node.name.length <= maxLength) return null;

  return {
    ruleId: tooLongNameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name.substring(0, 30)}..." is ${node.name.length} chars — shorten to under ${maxLength} characters`,
  };
};

export const tooLongName = defineRule({
  definition: tooLongNameDef,
  check: tooLongNameCheck,
});
