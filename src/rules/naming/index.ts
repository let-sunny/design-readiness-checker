import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
// AnalysisNode type used in helper functions
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";

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
  why: "Default names like 'Frame 123' provide no context about the element's purpose",
  impact: "Designers and developers cannot understand the structure",
  fix: "Rename with a descriptive, semantic name (e.g., 'Header', 'ProductCard')",
};

const defaultNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (!isDefaultName(node.name)) return null;

  return {
    ruleId: defaultNameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" is a default name - provide a meaningful name`,
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
  why: "Names like 'Rectangle' describe shape, not purpose",
  impact: "Structure is hard to understand without context",
  fix: "Use names that describe what the element represents (e.g., 'Divider', 'Avatar')",
};

const nonSemanticNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
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
    message: `"${node.name}" is a non-semantic name - describe its purpose`,
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
  why: "Mixed naming conventions at the same level create confusion",
  impact: "Harder to navigate and maintain the design",
  fix: "Use a consistent naming convention for sibling elements",
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
      message: `"${node.name}" uses ${nodeConvention} while siblings use ${dominantConvention}`,
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
  why: "Names with numeric suffixes often indicate copy-paste duplication",
  impact: "Suggests the element might need componentization",
  fix: "Remove the suffix or create a component if duplicated",
};

const numericSuffixNameCheck: RuleCheckFn = (node, context) => {
  if (!node.name) return null;
  if (isDefaultName(node.name)) return null; // Already caught by default-name
  if (!hasNumericSuffix(node.name)) return null;

  return {
    ruleId: numericSuffixNameDef.id,
    nodeId: node.id,
    nodePath: context.path.join(" > "),
    message: `"${node.name}" has a numeric suffix - consider renaming`,
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
  why: "Very long names are hard to read and use in code",
  impact: "Clutters the layer panel and makes selectors unwieldy",
  fix: "Shorten the name while keeping it descriptive",
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
    message: `"${node.name.substring(0, 30)}..." is ${node.name.length} chars (max: ${maxLength})`,
  };
};

export const tooLongName = defineRule({
  definition: tooLongNameDef,
  check: tooLongNameCheck,
});
