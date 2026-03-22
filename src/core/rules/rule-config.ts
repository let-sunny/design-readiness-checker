import type { RuleConfig, RuleId } from "../contracts/rule.js";

/**
 * Central configuration for all rules
 * Edit scores/severity here without touching rule logic
 */
export const RULE_CONFIGS: Record<RuleId, RuleConfig> = {
  // ============================================
  // Layout (11 rules)
  // ============================================
  "no-auto-layout": {
    severity: "blocking",
    score: -7,
    depthWeight: 1.5,
    enabled: true,
  },
  "absolute-position-in-auto-layout": {
    severity: "blocking",
    score: -10,
    depthWeight: 1.3,
    enabled: true,
  },
  "fixed-width-in-responsive-context": {
    severity: "risk",
    score: -4,
    depthWeight: 1.3,
    enabled: true,
  },
  "missing-responsive-behavior": {
    severity: "risk",
    score: -4,
    depthWeight: 1.5,
    enabled: true,
  },
  "group-usage": {
    severity: "risk",
    score: -5,
    depthWeight: 1.2,
    enabled: true,
  },
  "fixed-size-in-auto-layout": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "missing-min-width": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "missing-max-width": {
    severity: "risk",
    score: -4,
    enabled: true,
  },
  "deep-nesting": {
    severity: "risk",
    score: -4,
    enabled: true,
    options: {
      maxDepth: 5,
    },
  },
  "overflow-hidden-abuse": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "inconsistent-sibling-layout-direction": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },

  // ============================================
  // Token (7 rules)
  // ============================================
  "raw-color": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "raw-font": {
    severity: "blocking",
    score: -8,
    enabled: true,
  },
  "inconsistent-spacing": {
    severity: "missing-info",
    score: -2,
    enabled: true,
    options: {
      gridBase: 4,
    },
  },
  "magic-number-spacing": {
    severity: "risk",
    score: -4,
    enabled: true,
    options: {
      gridBase: 4,
    },
  },
  "raw-shadow": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "raw-opacity": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "multiple-fill-colors": {
    severity: "missing-info",
    score: -3,
    enabled: true,
    options: {
      tolerance: 10,
    },
  },

  // ============================================
  // Component (6 rules)
  // ============================================
  "missing-component": {
    severity: "risk",
    score: -7,
    enabled: true,
    options: {
      minRepetitions: 3,
    },
  },
  "detached-instance": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "nested-instance-override": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "variant-not-used": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "component-property-unused": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "single-use-component": {
    severity: "suggestion",
    score: -1,
    enabled: true,
  },

  // ============================================
  // Naming (5 rules)
  // ============================================
  "default-name": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "non-semantic-name": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "inconsistent-naming-convention": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "numeric-suffix-name": {
    severity: "suggestion",
    score: -1,
    enabled: true,
  },
  "too-long-name": {
    severity: "suggestion",
    score: -1,
    enabled: true,
    options: {
      maxLength: 50,
    },
  },

  // ============================================
  // AI Readability (5 rules)
  // ============================================
  "ambiguous-structure": {
    severity: "blocking",
    score: -10,
    depthWeight: 1.3,
    enabled: true,
  },
  "z-index-dependent-layout": {
    severity: "risk",
    score: -5,
    depthWeight: 1.3,
    enabled: true,
  },
  "missing-layout-hint": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "invisible-layer": {
    severity: "blocking",
    score: -10,
    enabled: true,
  },
  "empty-frame": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },

  // ============================================
  // Handoff Risk (5 rules)
  // ============================================
  "hardcode-risk": {
    severity: "risk",
    score: -5,
    depthWeight: 1.5,
    enabled: true,
  },
  "text-truncation-unhandled": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "image-no-placeholder": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "prototype-link-in-design": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "no-dev-status": {
    severity: "missing-info",
    score: -2,
    enabled: false, // Disabled by default
  },
};

/**
 * Preset types for different analysis modes
 */
export type Preset = "relaxed" | "dev-friendly" | "ai-ready" | "strict";

/**
 * Get rule configs with preset applied
 */
export function getConfigsWithPreset(
  preset: Preset
): Record<RuleId, RuleConfig> {
  const configs = { ...RULE_CONFIGS };

  switch (preset) {
    case "relaxed":
      // Disable blocking rules, reduce scores
      for (const [id, config] of Object.entries(configs)) {
        if (config.severity === "blocking") {
          configs[id as RuleId] = {
            ...config,
            severity: "risk",
            score: Math.round(config.score * 0.5),
          };
        }
      }
      break;

    case "dev-friendly":
      // Focus on layout and handoff issues
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        if (
          !ruleId.includes("layout") &&
          !ruleId.includes("handoff") &&
          !ruleId.includes("responsive")
        ) {
          configs[ruleId] = { ...config, enabled: false };
        }
      }
      break;

    case "ai-ready":
      // Boost AI readability and naming rules
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        if (
          ruleId.includes("ambiguous") ||
          ruleId.includes("structure") ||
          ruleId.includes("name")
        ) {
          configs[ruleId] = {
            ...config,
            score: Math.round(config.score * 1.5),
          };
        }
      }
      break;

    case "strict":
      // Enable all rules, increase scores
      for (const [id, config] of Object.entries(configs)) {
        configs[id as RuleId] = {
          ...config,
          enabled: true,
          score: Math.round(config.score * 1.5),
        };
      }
      break;
  }

  return configs;
}

/**
 * Get option value for a rule with type safety
 */
export function getRuleOption<T>(
  ruleId: RuleId,
  optionKey: string,
  defaultValue: T
): T {
  const config = RULE_CONFIGS[ruleId];
  if (!config.options) return defaultValue;
  const value = config.options[optionKey];
  return (value as T) ?? defaultValue;
}
