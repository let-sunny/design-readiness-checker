import type {
  ReanalyzeForTally,
  RoundtripTally,
  StepFourReport,
} from "../contracts/roundtrip-tally.js";

/**
 * Combine the structured Step 4 outcome counts with the re-analyze
 * response into the final `RoundtripTally` the SKILL renders in the
 * Step 5 wrap-up.
 *
 * The previous shape asked the LLM to count its own emoji bullets — the
 * highest-risk drift surface in the entire skill, since one missed `📝`
 * silently undercounts the annotated total. By emitting the structured
 * `stepFourReport` as Strategy A/B/C/D execute and then calling this
 * helper at the top of Step 5, every count is derived from explicit data,
 * not the LLM's re-parse of its own prose. ADR-016.
 *
 * Throws when `reanalyzeResponse.acknowledgedCount > issueCount` — that
 * shape is impossible (acknowledged issues are a subset of remaining
 * issues), so seeing it means an upstream serialization bug rather than
 * a render-time defensive concern.
 */
export function computeRoundtripTally(args: {
  stepFourReport: StepFourReport;
  reanalyzeResponse: ReanalyzeForTally;
}): RoundtripTally {
  const { stepFourReport, reanalyzeResponse } = args;
  const { resolved, annotated, definitionWritten, skipped } = stepFourReport;
  const { issueCount, acknowledgedCount } = reanalyzeResponse;

  if (acknowledgedCount > issueCount) {
    throw new Error(
      `computeRoundtripTally: reanalyzeResponse.acknowledgedCount (${acknowledgedCount}) cannot exceed issueCount (${issueCount}). Acknowledged issues are a subset of remaining issues.`,
    );
  }

  return {
    X: resolved,
    Y: annotated,
    Z: definitionWritten,
    W: skipped,
    N: resolved + annotated + definitionWritten + skipped,
    V: issueCount,
    V_ack: acknowledgedCount,
    V_open: issueCount - acknowledgedCount,
  };
}
