import type { RuleConfig, RuleId } from "../contracts/rule.js";

/**
 * Central configuration for all rules
 * Edit scores/severity here without touching rule logic
 */
export const RULE_CONFIGS: Record<RuleId, RuleConfig> = {
  // ── Structure ──
  "no-auto-layout": {
    severity: "blocking",
    score: -10,
    depthWeight: 1.5,
    enabled: true,
  },
  "absolute-position-in-auto-layout": {
    severity: "blocking",
    score: -7,
    depthWeight: 1.3,
    enabled: true,
  },
  "fixed-size-in-auto-layout": {
    severity: "risk",
    score: -3,
    enabled: true,
  },
  "missing-size-constraint": {
    severity: "risk",
    score: -3,
    enabled: true,
  },
  "missing-responsive-behavior": {
    severity: "risk",
    score: -3,
    depthWeight: 1.5,
    enabled: true,
  },
  "group-usage": {
    severity: "risk",
    score: -5,
    depthWeight: 1.2,
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
  "z-index-dependent-layout": {
    severity: "risk",
    score: -5,
    depthWeight: 1.3,
    enabled: true,
  },
  "unnecessary-node": {
    severity: "suggestion",
    score: -2,
    enabled: true,
    options: {
      slotRecommendationThreshold: 3,
    },
  },

  // ── Token ──
  "raw-color": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "raw-font": {
    severity: "risk",
    score: -4,
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
    score: -3,
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

  // ── Component ──
  "missing-component": {
    severity: "risk",
    score: -7,
    enabled: true,
    options: {
      minRepetitions: 3,
      structureMinRepetitions: 2,
      maxFingerprintDepth: 3,
    },
  },
  "detached-instance": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "missing-component-description": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "variant-structure-mismatch": {
    severity: "risk",
    score: -4,
    enabled: true,
  },

  // ── Naming ──
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

  // ── Behavior ──
  "text-truncation-unhandled": {
    severity: "risk",
    score: -5,
    enabled: true,
  },
  "prototype-link-in-design": {
    severity: "missing-info",
    score: -2,
    enabled: true,
  },
  "overflow-behavior-unknown": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "wrap-behavior-unknown": {
    severity: "missing-info",
    score: -3,
    enabled: true,
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
      // Focus on structure and behavior issues
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        if (
          !ruleId.includes("auto-layout") &&
          !ruleId.includes("responsive") &&
          !ruleId.includes("truncation") &&
          !ruleId.includes("overflow") &&
          !ruleId.includes("wrap") &&
          !ruleId.includes("size")
        ) {
          configs[ruleId] = { ...config, enabled: false };
        }
      }
      break;

    case "ai-ready":
      // Boost structure and naming rules
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        if (
          ruleId.includes("auto-layout") ||
          ruleId.includes("structure") ||
          ruleId.includes("name") ||
          ruleId.includes("unnecessary")
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
