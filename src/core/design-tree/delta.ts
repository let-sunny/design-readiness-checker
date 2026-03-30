/**
 * Delta-based difficulty mapping for ablation experiments.
 * Converts pixel similarity delta (baseline - stripped) to a difficulty level.
 *
 * Used by calibration pipeline to objectively measure rule impact
 * instead of relying on Converter self-assessment.
 */

import type { Difficulty } from "../../agents/contracts/conversion-agent.js";

/**
 * Map a strip experiment's similarity delta to a difficulty level.
 *
 * Delta = baseline similarity - stripped similarity (percentage points).
 * Higher delta means removing that information caused more pixel degradation.
 *
 * Thresholds from issue #191:
 * - ≤ 5%p  → easy    (removing info barely matters)
 * - 6-15%p → moderate (noticeable degradation)
 * - 16-30%p → hard   (significant degradation)
 * - > 30%p → failed  (critical information)
 */
export function stripDeltaToDifficulty(delta: number): Difficulty {
  if (!Number.isFinite(delta)) {
    throw new TypeError(`Invalid strip delta: ${delta}`);
  }
  if (delta <= 5) return "easy";
  if (delta <= 15) return "moderate";
  if (delta <= 30) return "hard";
  return "failed";
}

/**
 * Map a token count delta percentage to a difficulty level.
 *
 * tokenDelta = baselineInputTokens - strippedInputTokens.
 * tokenDeltaPercent = tokenDelta / baselineInputTokens * 100.
 * Higher percentage means removing that info significantly reduces token cost,
 * i.e. the info contributed a lot of tokens — its absence matters for token management.
 *
 * Thresholds:
 * - ≤ 5%  → easy    (minimal token impact)
 * - 6-20% → moderate (noticeable token savings)
 * - 21-40% → hard   (significant token impact)
 * - > 40% → failed  (critical for token budget)
 */
export function tokenDeltaToDifficulty(baselineTokens: number, strippedTokens: number): Difficulty {
  if (!Number.isFinite(baselineTokens) || !Number.isFinite(strippedTokens)) {
    throw new TypeError(`Invalid token counts: baseline=${baselineTokens}, stripped=${strippedTokens}`);
  }
  if (baselineTokens <= 0) return "easy";
  const deltaPercent = ((baselineTokens - strippedTokens) / baselineTokens) * 100;
  if (deltaPercent <= 5) return "easy";
  if (deltaPercent <= 20) return "moderate";
  if (deltaPercent <= 40) return "hard";
  return "failed";
}
