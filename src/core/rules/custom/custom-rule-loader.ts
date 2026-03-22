import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Rule, RuleConfig, RuleViolation, RuleContext } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { CustomRulesFileSchema, type CustomRule } from "./custom-rule-schema.js";

/**
 * Load custom rules from a JSON file and return Rule objects + their configs
 */
export async function loadCustomRules(filePath: string): Promise<{
  rules: Rule[];
  configs: Record<string, RuleConfig>;
}> {
  const absPath = resolve(filePath);
  const raw = await readFile(absPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  const customRules = CustomRulesFileSchema.parse(parsed);

  const rules: Rule[] = [];
  const configs: Record<string, RuleConfig> = {};

  for (const cr of customRules) {
    // Skip rules that only have a prompt (old format) and no match conditions
    if (!cr.match) continue;

    rules.push(toRule(cr));
    configs[cr.id] = {
      severity: cr.severity,
      score: cr.score,
      enabled: true,
    };
  }

  return { rules, configs };
}

function toRule(cr: CustomRule): Rule {
  return {
    definition: {
      id: cr.id,
      name: cr.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      category: cr.category,
      why: cr.why,
      impact: cr.impact,
      fix: cr.fix,
    },
    check: createPatternCheck(cr),
  };
}

/**
 * Create a check function that evaluates all match conditions against a node.
 * ALL conditions must pass (AND logic) for the rule to fire.
 */
function createPatternCheck(cr: CustomRule) {
  return (
    node: AnalysisNode,
    context: RuleContext,
  ): RuleViolation | null => {
    // Skip non-visual nodes
    if (node.type === "DOCUMENT" || node.type === "CANVAS") return null;

    const match = cr.match;

    // Type checks
    if (match.type && !match.type.includes(node.type)) return null;
    if (match.notType && match.notType.includes(node.type)) return null;

    // Name checks (case-insensitive)
    if (match.nameContains !== undefined && !node.name.toLowerCase().includes(match.nameContains.toLowerCase())) return null;
    if (match.nameNotContains !== undefined && node.name.toLowerCase().includes(match.nameNotContains.toLowerCase())) return null;
    if (match.namePattern !== undefined && !new RegExp(match.namePattern, "i").test(node.name)) return null;

    // Size checks
    const bbox = node.absoluteBoundingBox;
    if (match.minWidth !== undefined && (!bbox || bbox.width < match.minWidth)) return null;
    if (match.maxWidth !== undefined && (!bbox || bbox.width > match.maxWidth)) return null;
    if (match.minHeight !== undefined && (!bbox || bbox.height < match.minHeight)) return null;
    if (match.maxHeight !== undefined && (!bbox || bbox.height > match.maxHeight)) return null;

    // Layout checks
    if (match.hasAutoLayout === true && !node.layoutMode) return null;
    if (match.hasAutoLayout === false && node.layoutMode) return null;
    if (match.hasChildren === true && (!node.children || node.children.length === 0)) return null;
    if (match.hasChildren === false && node.children && node.children.length > 0) return null;
    if (match.minChildren !== undefined && (!node.children || node.children.length < match.minChildren)) return null;
    if (match.maxChildren !== undefined && node.children && node.children.length > match.maxChildren) return null;

    // Component checks
    if (match.isComponent === true && node.type !== "COMPONENT" && node.type !== "COMPONENT_SET") return null;
    if (match.isComponent === false && (node.type === "COMPONENT" || node.type === "COMPONENT_SET")) return null;
    if (match.isInstance === true && node.type !== "INSTANCE") return null;
    if (match.isInstance === false && node.type === "INSTANCE") return null;
    if (match.hasComponentId === true && !node.componentId) return null;
    if (match.hasComponentId === false && node.componentId) return null;

    // Visibility
    if (match.isVisible === true && !node.visible) return null;
    if (match.isVisible === false && node.visible) return null;

    // Fill/stroke/effect checks
    if (match.hasFills === true && (!node.fills || node.fills.length === 0)) return null;
    if (match.hasFills === false && node.fills && node.fills.length > 0) return null;
    if (match.hasStrokes === true && (!node.strokes || node.strokes.length === 0)) return null;
    if (match.hasStrokes === false && node.strokes && node.strokes.length > 0) return null;
    if (match.hasEffects === true && (!node.effects || node.effects.length === 0)) return null;
    if (match.hasEffects === false && node.effects && node.effects.length > 0) return null;

    // Depth checks
    if (match.minDepth !== undefined && context.depth < match.minDepth) return null;
    if (match.maxDepth !== undefined && context.depth > match.maxDepth) return null;

    // ALL conditions passed — flag this node
    const msg = (cr.message ?? `"${node.name}" matched custom rule "${cr.id}"`)
      .replace(/\{name\}/g, node.name)
      .replace(/\{type\}/g, node.type);

    return {
      ruleId: cr.id,
      nodeId: node.id,
      nodePath: context.path.join(" > "),
      message: msg,
    };
  };
}
