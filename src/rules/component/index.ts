import type { RuleCheckFn, RuleDefinition } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { defineRule } from "../rule-registry.js";
import { getRuleOption } from "../rule-config.js";

// ============================================
// Helper functions
// ============================================

function isComponentInstance(node: AnalysisNode): boolean {
  return node.type === "INSTANCE";
}

function isComponent(node: AnalysisNode): boolean {
  return node.type === "COMPONENT" || node.type === "COMPONENT_SET";
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

// ============================================
// missing-component
// ============================================

const missingComponentDef: RuleDefinition = {
  id: "missing-component",
  name: "Missing Component",
  category: "component",
  why: "Repeated identical structures should be componentized",
  impact: "Changes require manual updates in multiple places",
  fix: "Create a component from the repeated structure",
};

const missingComponentCheck: RuleCheckFn = (node, context, options) => {
  // Only check at frame level
  if (node.type !== "FRAME") return null;

  const minRepetitions = (options?.["minRepetitions"] as number) ??
    getRuleOption("missing-component", "minRepetitions", 3);

  // Collect frame names in the file (cached per analysis run would be better)
  const frameNames = collectFrameNames(context.file.document);
  const sameNameFrames = frameNames.get(node.name);

  if (sameNameFrames && sameNameFrames.length >= minRepetitions) {
    // Only report on the first occurrence to avoid duplicate issues
    if (sameNameFrames[0] === node.id) {
      return {
        ruleId: missingComponentDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" appears ${sameNameFrames.length} times - consider making it a component`,
      };
    }
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
  category: "component",
  why: "Detached instances lose their connection to the source component",
  impact: "Updates to the component won't propagate to this instance",
  fix: "Reset the instance or create a new variant if customization is needed",
};

const detachedInstanceCheck: RuleCheckFn = (node, context) => {
  // A detached instance would be a FRAME that was once an INSTANCE
  // This is hard to detect without historical data
  // Heuristic: Frame with a name that looks like it came from a component
  if (node.type !== "FRAME") return null;

  // Check if there's a component in the file with a similar name
  const components = context.file.components;
  const nodeName = node.name.toLowerCase();

  for (const [, component] of Object.entries(components)) {
    if (nodeName.includes(component.name.toLowerCase())) {
      // This frame might be a detached instance of this component
      return {
        ruleId: detachedInstanceDef.id,
        nodeId: node.id,
        nodePath: context.path.join(" > "),
        message: `"${node.name}" may be a detached instance of component "${component.name}"`,
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
// nested-instance-override
// ============================================

const nestedInstanceOverrideDef: RuleDefinition = {
  id: "nested-instance-override",
  name: "Nested Instance Override",
  category: "component",
  why: "Excessive overrides in instances make components harder to maintain",
  impact: "Component updates may not work as expected",
  fix: "Create a variant or new component for significantly different use cases",
};

const nestedInstanceOverrideCheck: RuleCheckFn = (node, context) => {
  if (!isComponentInstance(node)) return null;

  // Check for component property overrides
  if (!node.componentProperties) return null;

  const overrideCount = Object.keys(node.componentProperties).length;

  // Flag if there are too many overrides
  if (overrideCount > 5) {
    return {
      ruleId: nestedInstanceOverrideDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `"${node.name}" has ${overrideCount} property overrides - consider creating a variant`,
    };
  }

  return null;
};

export const nestedInstanceOverride = defineRule({
  definition: nestedInstanceOverrideDef,
  check: nestedInstanceOverrideCheck,
});

// ============================================
// variant-not-used
// ============================================

const variantNotUsedDef: RuleDefinition = {
  id: "variant-not-used",
  name: "Variant Not Used",
  category: "component",
  why: "Using instances but not leveraging variants defeats their purpose",
  impact: "Manual changes instead of using designed variants",
  fix: "Use the appropriate variant instead of overriding the default",
};

const variantNotUsedCheck: RuleCheckFn = (_node, _context) => {
  // This would require checking if an instance is using default variant
  // when other variants exist that better match the current state
  // Needs more context from component definitions
  return null;
};

export const variantNotUsed = defineRule({
  definition: variantNotUsedDef,
  check: variantNotUsedCheck,
});

// ============================================
// component-property-unused
// ============================================

const componentPropertyUnusedDef: RuleDefinition = {
  id: "component-property-unused",
  name: "Component Property Unused",
  category: "component",
  why: "Component properties should be utilized to expose customization",
  impact: "Hardcoded values that should be configurable",
  fix: "Connect the value to a component property",
};

const componentPropertyUnusedCheck: RuleCheckFn = (node, _context) => {
  if (!isComponent(node)) return null;

  // Check if component has property definitions but children don't use them
  if (!node.componentPropertyDefinitions) return null;

  const definedProps = Object.keys(node.componentPropertyDefinitions);
  if (definedProps.length === 0) return null;

  // This would require checking if properties are actually bound
  // Simplified for now
  return null;
};

export const componentPropertyUnused = defineRule({
  definition: componentPropertyUnusedDef,
  check: componentPropertyUnusedCheck,
});

// ============================================
// single-use-component
// ============================================

const singleUseComponentDef: RuleDefinition = {
  id: "single-use-component",
  name: "Single Use Component",
  category: "component",
  why: "Components used only once add complexity without reuse benefit",
  impact: "Unnecessary abstraction increases maintenance overhead",
  fix: "Consider inlining if this component won't be reused",
};

const singleUseComponentCheck: RuleCheckFn = (node, context) => {
  if (!isComponent(node)) return null;

  // Count instances of this component in the file
  let instanceCount = 0;

  function countInstances(n: AnalysisNode): void {
    if (n.type === "INSTANCE" && n.componentId === node.id) {
      instanceCount++;
    }
    if (n.children) {
      for (const child of n.children) {
        countInstances(child);
      }
    }
  }

  countInstances(context.file.document);

  if (instanceCount === 1) {
    return {
      ruleId: singleUseComponentDef.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: `Component "${node.name}" is only used once`,
    };
  }

  return null;
};

export const singleUseComponent = defineRule({
  definition: singleUseComponentDef,
  check: singleUseComponentCheck,
});
