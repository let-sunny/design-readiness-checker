import type {
  EvaluationAgentInput,
  EvaluationAgentOutput,
  MismatchCase,
  MismatchType,
} from "./contracts/evaluation-agent.js";
import type { Difficulty } from "./contracts/conversion-agent.js";
import type { Severity } from "@/core/contracts/severity.js";

/**
 * Difficulty-to-score range mapping.
 * Used to determine if a rule's current score aligns with actual conversion difficulty.
 *
 * easy    → score should be 0 to -3
 * moderate → score should be -4 to -7
 * hard    → score should be -8 to -12
 * failed  → score should be -8 to -12
 */
const DIFFICULTY_SCORE_RANGES: Record<Difficulty, { min: number; max: number }> = {
  easy: { min: -3, max: 0 },
  moderate: { min: -7, max: -4 },
  hard: { min: -12, max: -8 },
  failed: { min: -12, max: -8 },
};

/**
 * Check if a score falls within the expected range for a given difficulty
 */
function scoreMatchesDifficulty(score: number, difficulty: Difficulty): boolean {
  const range = DIFFICULTY_SCORE_RANGES[difficulty];
  return score >= range.min && score <= range.max;
}

/**
 * Determine mismatch type for a flagged rule based on conversion difficulty
 */
function classifyFlaggedRule(
  currentScore: number,
  actualDifficulty: Difficulty
): MismatchType {
  if (scoreMatchesDifficulty(currentScore, actualDifficulty)) {
    return "validated";
  }

  // If actual difficulty is easier than what the score suggests
  if (
    (actualDifficulty === "easy" && currentScore < -3) ||
    (actualDifficulty === "moderate" && currentScore < -7)
  ) {
    return "overscored";
  }

  // If actual difficulty is harder than what the score suggests
  return "underscored";
}

/**
 * Build reasoning string for a mismatch
 */
function buildReasoning(
  type: MismatchType,
  ruleId: string | undefined,
  currentScore: number | undefined,
  actualDifficulty: Difficulty
): string {
  const range = DIFFICULTY_SCORE_RANGES[actualDifficulty];

  switch (type) {
    case "validated":
      return `Rule "${ruleId}" score (${currentScore}) aligns with actual difficulty "${actualDifficulty}" (expected range: ${range.min} to ${range.max}).`;
    case "overscored":
      return `Rule "${ruleId}" score (${currentScore}) is too harsh for actual difficulty "${actualDifficulty}" (expected range: ${range.min} to ${range.max}).`;
    case "underscored":
      return `Rule "${ruleId}" score (${currentScore}) is too lenient for actual difficulty "${actualDifficulty}" (expected range: ${range.min} to ${range.max}).`;
    case "missing-rule":
      return `No rule covers this difficulty "${actualDifficulty}" (expected score range: ${range.min} to ${range.max}).`;
  }
}

/**
 * Evaluation Agent - Step 3 of calibration pipeline
 *
 * Deterministic comparison of analysis results vs conversion results.
 * No LLM required — pure algorithmic evaluation.
 */
export function runEvaluationAgent(
  input: EvaluationAgentInput
): EvaluationAgentOutput {
  const mismatches: MismatchCase[] = [];
  const validatedRuleSet = new Set<string>();

  // Build a lookup from nodeId to issue summary
  const nodeSummaryMap = new Map(
    input.nodeIssueSummaries.map((s) => [s.nodeId, s])
  );

  for (const record of input.conversionRecords) {
    const summary = nodeSummaryMap.get(record.nodeId);
    const difficulty = record.difficulty as Difficulty;

    // Process rule-related struggles from conversion
    for (const struggle of record.ruleRelatedStruggles) {
      const ruleInfo = input.ruleScores[struggle.ruleId];
      if (!ruleInfo) continue;

      const actualDifficulty = struggle.actualImpact as Difficulty;
      const type = classifyFlaggedRule(ruleInfo.score, actualDifficulty);

      if (type === "validated") {
        validatedRuleSet.add(struggle.ruleId);
      }

      mismatches.push({
        type,
        nodeId: record.nodeId,
        nodePath: record.nodePath,
        ruleId: struggle.ruleId,
        currentScore: ruleInfo.score,
        currentSeverity: ruleInfo.severity as Severity,
        actualDifficulty,
        reasoning: buildReasoning(type, struggle.ruleId, ruleInfo.score, actualDifficulty),
      });
    }

    // Process flagged rules that had NO struggle reported
    // Not mentioned ≠ overscored. Only classify as overscored when the Converter
    // explicitly reported actualImpact: "easy" for this rule. Otherwise validate.
    if (summary) {
      const struggledRuleIds = new Set(
        record.ruleRelatedStruggles.map((s) => s.ruleId)
      );

      for (const ruleId of summary.flaggedRuleIds) {
        if (struggledRuleIds.has(ruleId)) continue;

        const ruleInfo = input.ruleScores[ruleId];
        if (!ruleInfo) continue;

        // Rule was flagged but conversion had no struggle with it — validate conservatively
        validatedRuleSet.add(ruleId);
        mismatches.push({
          type: "validated",
          nodeId: record.nodeId,
          nodePath: record.nodePath,
          ruleId,
          currentScore: ruleInfo.score,
          currentSeverity: ruleInfo.severity as Severity,
          actualDifficulty: difficulty,
          reasoning: `Rule "${ruleId}" was flagged but not mentioned in conversion struggles (overall: "${difficulty}") — validated (no explicit easy signal).`,
        });
      }
    }

    // Process uncovered struggles (no existing rule)
    for (const uncovered of record.uncoveredStruggles) {
      const estimatedDifficulty = uncovered.estimatedImpact as Difficulty;

      mismatches.push({
        type: "missing-rule",
        nodeId: record.nodeId,
        nodePath: record.nodePath,
        actualDifficulty: estimatedDifficulty,
        reasoning: `Uncovered struggle: "${uncovered.description}" (category: ${uncovered.suggestedCategory}, impact: ${estimatedDifficulty}).`,
      });
    }
  }

  return {
    mismatches,
    validatedRules: [...validatedRuleSet],
  };
}
