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
    check: createPromptBasedCheck(cr),
  };
}

/**
 * Custom rules use a prompt-based check that pattern-matches on node properties.
 * The prompt field describes what to look for - this is a simple heuristic check
 * that flags nodes matching the category/type pattern.
 *
 * For now, custom rules are registered as no-ops (they return null).
 * Future: integrate with LLM for prompt-based evaluation.
 */
function createPromptBasedCheck(_cr: CustomRule) {
  return (
    node: AnalysisNode,
    _context: RuleContext,
  ): RuleViolation | null => {
    // Custom rules are prompt-based - they need LLM evaluation or explicit matchers.
    // Skip non-visual nodes
    if (node.type === "DOCUMENT" || node.type === "CANVAS") return null;

    // Placeholder: custom rules need LLM evaluation or explicit matcher
    return null;
  };
}
