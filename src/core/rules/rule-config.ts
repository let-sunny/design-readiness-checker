import type { Category } from "../contracts/category.js";
import type { RulePurpose } from "../contracts/channels.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";
import type { AnnotationProperty } from "../roundtrip/types.js";

/**
 * Maps each rule ID to its category.
 * Categories are based on ablation experiment data (PR #149, #150):
 * - pixel-critical: ΔV ≥ 5% — layout info removal directly degrades pixel accuracy
 * - responsive-critical: ΔV ≥ 15% at expanded viewport — size info critical for responsive
 * - code-quality: ΔV ≈ 0% but CSS classes -8~15 — affects code structure, not pixels
 * - token-management: raw values without design tokens — wrong input = wrong output
 * - semantic: ΔV < 2%, negligible code difference — naming and semantic issues
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
  // Semantic
  "non-standard-naming": "semantic",
  "non-semantic-name": "semantic",
  "inconsistent-naming-convention": "semantic",
};

/**
 * #406: Classifies each rule by primary output channel.
 *
 * - `violation` (default): score-primary. Rule fires when a best-practice
 *   expectation is broken; the score penalty is the main signal, gotcha
 *   questions are secondary context on how to resolve the violation.
 * - `info-collection`: annotation-primary. Rule fires on nodes that need
 *   implementation context Figma cannot encode natively (click target,
 *   state variants). The gotcha annotation IS the output; score impact is
 *   kept minimal (-1 range) so presence/absence of the annotation — not
 *   the penalty — differentiates designs.
 *
 * Sibling map (mirrors `RULE_ID_CATEGORY`) so existing `RuleDefinition`
 * call sites don't need to be touched. Look up via `getRulePurpose`.
 */
export const RULE_PURPOSE: Record<RuleId, RulePurpose> = {
  // Pixel Critical
  "no-auto-layout": "violation",
  "absolute-position-in-auto-layout": "violation",
  "non-layout-container": "violation",
  // Responsive Critical
  "fixed-size-in-auto-layout": "violation",
  "missing-size-constraint": "violation",
  // Code Quality
  "missing-component": "violation",
  "detached-instance": "violation",
  "variant-structure-mismatch": "violation",
  "deep-nesting": "violation",
  // Token Management
  "raw-value": "violation",
  "irregular-spacing": "violation",
  // Interaction — gotcha-primary: Figma cannot encode "what happens on
  // click" or "which states exist" in a way downstream code generation can
  // consume. Rules fire to trigger the annotation, not to flag a violation.
  "missing-interaction-state": "info-collection",
  "missing-prototype": "info-collection",
  // Semantic
  "non-standard-naming": "violation",
  "non-semantic-name": "violation",
  "inconsistent-naming-convention": "violation",
};

/**
 * Resolve a rule's purpose. Accepts `string` (not `RuleId`) because the
 * purpose concept must work for out-of-tree custom rules added via the
 * config loader — callers pass `issue.violation.ruleId` which is a plain
 * string. Defaults to `"violation"` for unknown ids. Keeping the cast
 * inside this helper (rather than forcing every caller to do `as RuleId`)
 * makes the fallback semantically honest.
 */
export function getRulePurpose(ruleId: string): RulePurpose {
  return RULE_PURPOSE[ruleId as RuleId] ?? "violation";
}

/**
 * Central configuration for all rules.
 * Scores based on ablation experiment + AI implementation interview (#200):
 * - pixel-critical: -10 ~ -7 (layout strip caused ΔV +5.4%)
 * - responsive-critical: -8 ~ -6 (size-constraints ΔV +15.9% at responsive viewports)
 * - code-quality: -7 ~ -3 (CSS classes -8~15, no pixel impact)
 * - token-management: -5 ~ -4 (wrong input = wrong output, irregular spacing actively causes errors)
 * - interaction: -1 (uncalibrated — no metric to validate, kept minimal #210)
 * - semantic: -4 ~ -1 (non-semantic-name upgraded per interview — causes actual implementation errors)
 *
 * Category weights removed (#196) — overall score is simple average of categories.
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
    score: -8,
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
    score: -6,
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
    score: -4,
    enabled: true,
  },
  "irregular-spacing": {
    severity: "risk",
    score: -5,
    enabled: true,
    options: {
      gridBase: 2,
    },
  },

  // ── Interaction ──
  // #406: both rules are `info-collection` — primary output is the gotcha
  // annotation, not the score. Severity is `missing-info` so they surface in
  // the gotcha survey (see `generateGotchaSurvey`) even though the penalty
  // is minimal. Score stays at -1 so re-enabling `missing-prototype` on
  // fixtures that lack `interactionDestinations` (#139) cannot swing grades.
  "missing-interaction-state": {
    severity: "missing-info",
    score: -1, // uncalibrated: no metric to validate score (#210), kept at -1 to preserve category visibility
    enabled: true,
  },
  "missing-prototype": {
    severity: "missing-info",
    score: -1, // #406: info-collection — annotation is primary output; score kept minimal so #139 fixtures don't skew calibration
    enabled: true,
  },

  // ── Semantic ──
  "non-standard-naming": {
    severity: "suggestion",
    score: -3, // higher than other naming rules: non-standard state names break interaction detection pipeline
    enabled: true,
  },
  "non-semantic-name": {
    severity: "risk",
    score: -4,
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
 * Per-rule annotation `properties` hints surfaced in Dev Mode. Kept as a
 * sibling map rather than a field on `RuleConfig` so the existing
 * `RuleConfigSchema` Zod contract and preset helpers stay untouched.
 *
 * `bySubType` takes precedence over `default` — mirrors the ruleId+subType
 * resolution pattern already used for `targetProperty` in apply-context.ts.
 * The Experiment 09 node-type matrix is enforced at write time by
 * `upsertCanicodeAnnotation`'s retry path, so hints can be passed
 * speculatively without server-side filtering.
 */
export const RULE_ANNOTATION_PROPERTIES: Partial<
  Record<
    RuleId,
    {
      default?: AnnotationProperty[];
      bySubType?: Record<string, AnnotationProperty[]>;
    }
  >
> = {
  "missing-size-constraint": {
    default: [{ type: "width" }, { type: "height" }],
  },
  "irregular-spacing": {
    bySubType: {
      gap: [{ type: "itemSpacing" }],
      padding: [{ type: "padding" }],
    },
  },
  "fixed-size-in-auto-layout": {
    default: [{ type: "width" }, { type: "height" }, { type: "layoutMode" }],
  },
  "raw-value": {
    bySubType: {
      color: [{ type: "fills" }],
      font: [
        { type: "fontSize" },
        { type: "fontFamily" },
        { type: "fontWeight" },
        { type: "lineHeight" },
      ],
      spacing: [{ type: "itemSpacing" }, { type: "padding" }],
    },
  },
  "absolute-position-in-auto-layout": {
    default: [{ type: "layoutMode" }],
  },
};

/**
 * Resolve the annotation `properties` hint for a ruleId (+ subType).
 * Returns `undefined` for rules with no entry.
 */
export function getAnnotationProperties(
  ruleId: RuleId,
  subType?: string
): AnnotationProperty[] | undefined {
  const entry = RULE_ANNOTATION_PROPERTIES[ruleId];
  if (!entry) return undefined;
  if (subType !== undefined && entry.bySubType) {
    const match = entry.bySubType[subType];
    if (match) return match;
  }
  return entry.default;
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
