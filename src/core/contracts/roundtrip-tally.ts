import { z } from "zod";

/**
 * Structured per-question outcome counts the `canicode-roundtrip` SKILL
 * accumulates as Strategy A / B / C / D execute on each question in Step 4.
 * Replaces the free-form `✅ X / 📝 Y / 🌐 Z / ⏭️ W` emoji bullets the
 * Step 5 wrap-up used to re-parse from the LLM's own previous output —
 * see ADR-016.
 */
export const StepFourReportSchema = z.object({
  /** ✅ — Strategy A property write (or A's auto-fix branch) succeeded. */
  resolved: z.number().int().min(0),
  /** 📝 — Strategy C wrote a Figma annotation (or A/B fell back to one). */
  annotated: z.number().int().min(0),
  /**
   * 🌐 — `applyWithInstanceFallback` propagated the write up to the
   * source COMPONENT definition (only counted when
   * `allowDefinitionWrite: true`).
   */
  definitionWritten: z.number().int().min(0),
  /**
   * ⏭️ — User said "skip", "n/a", or otherwise declined a per-question
   * confirmation (Strategy B opt-out, etc.).
   */
  skipped: z.number().int().min(0),
});

export type StepFourReport = z.infer<typeof StepFourReportSchema>;

/**
 * The two fields `computeRoundtripTally` reads from the post-Step-5b
 * re-analyze response. Kept narrow on purpose — the helper doesn't need
 * grade movement, per-rule breakdowns, or the issues array, just enough
 * to derive `V`, `V_ack`, and `V_open`.
 */
export const ReanalyzeForTallySchema = z.object({
  /**
   * Total remaining issues from the re-analyze. Maps to the existing
   * `issueCount` (analyze JSON) / `questions.length` (gotcha-survey JSON)
   * field — both downstream channels populate it.
   */
  issueCount: z.number().int().min(0),
  /**
   * Issues the re-analyze flagged with `acknowledged: true` because they
   * matched a canicode-authored Figma annotation harvested in Step 5a.
   * From the analyze response's top-level `acknowledgedCount` (#371).
   */
  acknowledgedCount: z.number().int().min(0),
});

export type ReanalyzeForTally = z.infer<typeof ReanalyzeForTallySchema>;

export const RoundtripTallySchema = z.object({
  /** ✅ resolved (passthrough from `stepFourReport.resolved`). */
  X: z.number().int().min(0),
  /** 📝 annotated. */
  Y: z.number().int().min(0),
  /** 🌐 definition writes propagated. */
  Z: z.number().int().min(0),
  /** ⏭️ skipped. */
  W: z.number().int().min(0),
  /** `X + Y + Z + W` — questions the SKILL acted on in Step 4. */
  N: z.number().int().min(0),
  /** `reanalyzeResponse.issueCount` — total remaining after re-analyze. */
  V: z.number().int().min(0),
  /**
   * `reanalyzeResponse.acknowledgedCount` — the slice of `V` that carries
   * a canicode annotation (counted at half weight by the density score
   * per #371, but still surfaced as remaining).
   */
  V_ack: z.number().int().min(0),
  /** `V - V_ack` — issues with no annotation; the user's follow-up backlog. */
  V_open: z.number().int().min(0),
});

export type RoundtripTally = z.infer<typeof RoundtripTallySchema>;
