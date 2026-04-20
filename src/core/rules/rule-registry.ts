import type { Rule, RuleConfig, RuleId } from "../contracts/rule.js";
import type { Category } from "../contracts/category.js";
import { RULE_CONFIGS } from "./rule-config.js";

/**
 * Registry for all rules
 */
class RuleRegistry {
  private rules: Map<RuleId, Rule> = new Map();

  /**
   * Register a rule
   */
  register(rule: Rule): void {
    this.rules.set(rule.definition.id as RuleId, rule);
  }

  /**
   * Remove a rule by ID. Primarily used by tests that register a
   * throwaway rule and need to restore the registry afterwards. Returns
   * `true` if the rule was present.
   */
  unregister(id: RuleId): boolean {
    return this.rules.delete(id);
  }

  /**
   * Get a rule by ID
   */
  get(id: RuleId): Rule | undefined {
    return this.rules.get(id);
  }

  /**
   * Get all registered rules
   */
  getAll(): Rule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Get rules by category
   */
  getByCategory(category: Category): Rule[] {
    return this.getAll().filter((rule) => rule.definition.category === category);
  }

  /**
   * Get enabled rules with their configs
   */
  getEnabled(configs: Record<RuleId, RuleConfig> = RULE_CONFIGS): Rule[] {
    return this.getAll().filter((rule) => {
      const config = configs[rule.definition.id as RuleId];
      return config?.enabled ?? true;
    });
  }

  /**
   * Get config for a rule
   */
  getConfig(
    id: RuleId,
    configs: Record<RuleId, RuleConfig> = RULE_CONFIGS
  ): RuleConfig {
    return configs[id];
  }

  /**
   * Check if a rule is registered
   */
  has(id: RuleId): boolean {
    return this.rules.has(id);
  }

  /**
   * Get count of registered rules
   */
  get size(): number {
    return this.rules.size;
  }
}

/**
 * Global rule registry instance
 */
export const ruleRegistry = new RuleRegistry();

/**
 * Helper to create and register a rule
 */
export function defineRule(rule: Rule): Rule {
  ruleRegistry.register(rule);
  return rule;
}
