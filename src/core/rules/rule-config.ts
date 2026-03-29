import type { Category } from "../contracts/category.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";

/**
 * Maps each rule ID to its category.
 * Categories are based on ablation experiment data (PR #149, #150):
 * - pixel-critical: ΔV ≥ 5% — layout info removal directly degrades pixel accuracy
 * - responsive-critical: ΔV ≥ 15% at expanded viewport — size info critical for responsive
 * - code-quality: ΔV ≈ 0% but CSS classes -8~15 — affects code structure, not pixels
 * - token-management: raw values without design tokens — wrong input = wrong output
 * - minor: ΔV < 2%, negligible code difference — naming and minor issues
 */
export const RULE_ID_CATEGORY: Record<RuleId, Category> = {
  // Pixel Critical
  "no-auto-layout": "pixel-critical",
  "absolute-position-in-auto-layout": "pixel-critical",
  "non-layout-container": "pixel-critical",
  // Responsive Critical
  "fixed-size-in-auto-layout": "responsive-critical",
  "missing-size-constraint": "responsive-critical",
  // Code Quality
  "missing-component": "code-quality",
  "detached-instance": "code-quality",
  "variant-structure-mismatch": "code-quality",
  "deep-nesting": "code-quality",
  // Token Management
  "raw-value": "token-management",
  "irregular-spacing": "token-management",
  // Interaction
  "missing-interaction-state": "interaction",
  "missing-prototype": "interaction",
  // Minor
  "non-standard-naming": "minor",
  "non-semantic-name": "minor",
  "inconsistent-naming-convention": "minor",
};

/**
 * Central configuration for all rules.
 * Scores based on ablation experiment impact data:
 * - pixel-critical: -10 ~ -7 (layout strip caused ΔV +5.4%)
 * - responsive-critical: -7 ~ -5 (size-constraints ΔV +15.9% at responsive viewports)
 * - code-quality: -5 ~ -3 (CSS classes -8~15, no pixel impact)
 * - token-management: -3 ~ -2 (wrong input = wrong output, but values still present)
 * - minor: -2 ~ -1 (ΔV < 2%, negligible)
 */
export const RULE_CONFIGS: Record<RuleId, RuleConfig> = {
  // ── Pixel Critical ──
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
  "non-layout-container": {
    severity: "blocking",
    score: -8,
    depthWeight: 1.2,
    enabled: true,
  },

  // ── Responsive Critical ──
  "fixed-size-in-auto-layout": {
    severity: "risk",
    score: -6,
    enabled: true,
  },
  "missing-size-constraint": {
    severity: "risk",
    score: -5,
    enabled: true,
  },

  // ── Code Quality ──
  "missing-component": {
    severity: "risk",
    score: -7,
    enabled: true,
    options: {
      minRepetitions: 2,
      structureMinRepetitions: 2,
      maxFingerprintDepth: 3,
    },
  },
  "detached-instance": {
    severity: "risk",
    score: -4,
    enabled: true,
  },
  "variant-structure-mismatch": {
    severity: "risk",
    score: -4,
    enabled: true,
  },
  "deep-nesting": {
    severity: "risk",
    score: -3,
    enabled: true,
    options: {
      maxDepth: 5,
    },
  },

  // ── Token Management ──
  "raw-value": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "irregular-spacing": {
    severity: "missing-info",
    score: -2,
    enabled: true,
    options: {
      gridBase: 2,
    },
  },

  // ── Interaction ──
  "missing-interaction-state": {
    severity: "missing-info",
    score: -3,
    enabled: true,
  },
  "missing-prototype": {
    severity: "missing-info",
    score: -3,
    enabled: false, // disabled: interactionDestinations data missing from fixtures (#139)
  },

  // ── Minor ──
  "non-standard-naming": {
    severity: "suggestion",
    score: -3, // higher than other naming rules: non-standard state names break interaction detection pipeline
    enabled: true,
  },
  "non-semantic-name": {
    severity: "suggestion",
    score: -1,
    enabled: true,
  },
  "inconsistent-naming-convention": {
    severity: "suggestion",
    score: -1,
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
      // Focus on pixel-critical and responsive-critical issues
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        const category = RULE_ID_CATEGORY[ruleId];
        if (category !== "pixel-critical" && category !== "responsive-critical") {
          configs[ruleId] = { ...config, enabled: false };
        }
      }
      break;

    case "ai-ready":
      // Boost pixel-critical and token-management rules
      for (const [id, config] of Object.entries(configs)) {
        const ruleId = id as RuleId;
        const category = RULE_ID_CATEGORY[ruleId];
        if (category === "pixel-critical" || category === "token-management") {
          configs[ruleId] = {
            ...config,
            score: Math.round(config.score * 1.5),
          };
        }
      }
      break;

    case "strict":
      // Increase scores but respect disabled rules
      for (const [id, config] of Object.entries(configs)) {
        configs[id as RuleId] = {
          ...config,
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
