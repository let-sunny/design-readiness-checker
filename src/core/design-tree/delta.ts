/**
 * Delta-based difficulty mapping for ablation experiments.
 * Converts pixel similarity delta (baseline - stripped) to a difficulty level.
 *
 * Used by calibration pipeline to objectively measure rule impact
 * instead of relying on Converter self-assessment.
 */

import type { Difficulty } from "../../agents/contracts/conversion-agent.js";

/**
 * Map a strip experiment's pixel-similarity delta to a Difficulty level.
 *
 * @param delta - Pixel-similarity degradation in percentage points (baseline similarity minus stripped similarity).
 * @returns `'easy'` if `delta` is less than or equal to 5, `'moderate'` if `delta` is greater than 5 and less than or equal to 15, `'hard'` if `delta` is greater than 15 and less than or equal to 30, `'failed'` if `delta` is greater than 30.
 * @throws TypeError if `delta` is not a finite number.
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
