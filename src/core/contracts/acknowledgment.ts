import { z } from "zod";

/**
 * Acknowledgment marker — surfaced from a Figma Dev Mode annotation that
 * canicode itself wrote during a roundtrip. When the analysis pipeline
 * receives a list of acknowledgments, matching `(nodeId, ruleId)` issues are
 * flagged `acknowledged: true` and contribute half their normal weight to
 * the density score (#371).
 *
 * This contract is consumed by:
 * - The MCP `analyze` tool (`acknowledgments?: Acknowledgment[]` input)
 * - The CLI `analyze --acknowledgments <path>` flag
 * - `RuleEngineOptions.acknowledgments`
 *
 * It is produced by the Plugin-API helper
 * `extractAcknowledgmentsFromNode` / `readCanicodeAcknowledgments`
 * (see `src/core/roundtrip/read-acknowledgments.ts`).
 *
 * ADR-019 / #444: optional `intent`, `sceneWriteOutcome`, and `codegenDirective`
 * are read from a fenced canicode-json block when present; legacy annotations
 * omit them and remain valid for density scoring.
 *
 * ADR-022 / #526 sub-task 2: `intent` is a discriminated union on `kind`.
 * Per-property intents (the original ADR-019 shape) carry `kind: "property"`
 * with `field`, `value`, and `scope`; rule-level opt-outs carry
 * `kind: "rule-opt-out"` with a `ruleId`. The discriminator is optional on
 * the per-property variant — wire-compatible with legacy ack JSON that
 * omits `kind` — and required on the rule-opt-out variant so an old
 * consumer cannot accidentally read an opt-out as a property intent.
 */
export const PropertyAcknowledgmentIntentSchema = z.object({
  kind: z.literal("property").default("property"),
  field: z.string(),
  value: z.unknown(),
  scope: z.enum(["instance", "definition"]),
});

export const RuleOptOutAcknowledgmentIntentSchema = z
  .object({
    kind: z.literal("rule-opt-out"),
    ruleId: z.string(),
  })
  .strict();

export const AcknowledgmentIntentSchema = z.preprocess((raw) => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj["kind"] === undefined) {
      return { ...obj, kind: "property" };
    }
  }
  return raw;
}, z.discriminatedUnion("kind", [
  PropertyAcknowledgmentIntentSchema,
  RuleOptOutAcknowledgmentIntentSchema,
]));

export type PropertyAcknowledgmentIntent = z.infer<
  typeof PropertyAcknowledgmentIntentSchema
>;
export type RuleOptOutAcknowledgmentIntent = z.infer<
  typeof RuleOptOutAcknowledgmentIntentSchema
>;
export type AcknowledgmentIntent = z.infer<typeof AcknowledgmentIntentSchema>;

/** ADR-022: predicate for the rule-opt-out branch of `AcknowledgmentIntent`. */
export function isRuleOptOutIntent(
  intent: AcknowledgmentIntent | undefined
): intent is RuleOptOutAcknowledgmentIntent {
  return intent !== undefined && intent.kind === "rule-opt-out";
}

/** ADR-022: predicate for the property branch of `AcknowledgmentIntent`. */
export function isPropertyIntent(
  intent: AcknowledgmentIntent | undefined
): intent is PropertyAcknowledgmentIntent {
  return intent !== undefined && intent.kind === "property";
}

export const AcknowledgmentSceneWriteOutcomeSchema = z.object({
  result: z.enum([
    "succeeded",
    "silent-ignored",
    "api-rejected",
    "user-declined-propagation",
    "unknown",
  ]),
  reason: z.string().optional(),
});

export type AcknowledgmentSceneWriteOutcome = z.infer<
  typeof AcknowledgmentSceneWriteOutcomeSchema
>;

export const AcknowledgmentSchema = z.object({
  nodeId: z.string(),
  ruleId: z.string(),
  intent: AcknowledgmentIntentSchema.optional(),
  sceneWriteOutcome: AcknowledgmentSceneWriteOutcomeSchema.optional(),
  codegenDirective: z.string().optional(),
});

export type Acknowledgment = z.infer<typeof AcknowledgmentSchema>;

export const AcknowledgmentListSchema = z.array(AcknowledgmentSchema);

/**
 * Normalize a Figma node id into `:`-separated form so callers can pass
 * either URL-style (`123-456`) or Plugin-API-style (`123:456`) ids and the
 * engine matches them consistently. Non-instance ids stay unchanged; the
 * `I…;…` instance-child format keeps its semicolon — only `-` → `:`
 * happens.
 */
export function normalizeNodeId(id: string): string {
  return id.replace(/-/g, ":");
}
