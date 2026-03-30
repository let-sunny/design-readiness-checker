import type {
  EvaluationAgentInput,
  EvaluationAgentOutput,
  MismatchCase,
  MismatchType,
} from "./contracts/evaluation-agent.js";
import type { Difficulty } from "./contracts/conversion-agent.js";
import type { Severity } from "../core/contracts/severity.js";
import type { RuleId } from "../core/contracts/rule.js";
import { RULE_ID_CATEGORY } from "../core/rules/rule-config.js";
import type { DesignTreeInfoType } from "../core/design-tree/strip.js";
import { stripDeltaToDifficulty } from "../core/design-tree/delta.js";

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
 * Merge all node issue summaries into a single virtual summary.
 * Used when whole-design conversion produces a single root record but analysis
 * flags rules on individual child nodes. Without merging, rules only flagged on
 * non-root nodes would be silently dropped from evaluation.
 */
function mergeAllSummaries(
  summaries: Array<{ nodeId: string; nodePath: string; flaggedRuleIds: string[] }>,
  rootNodeId: string,
  rootNodePath: string,
): { nodeId: string; nodePath: string; flaggedRuleIds: string[] } {
  const allRuleIds = new Set<string>();
  for (const s of summaries) {
    for (const id of s.flaggedRuleIds) {
      allRuleIds.add(id);
    }
  }
  return { nodeId: rootNodeId, nodePath: rootNodePath, flaggedRuleIds: [...allRuleIds] };
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
    const summary = input.wholeDesign
      ? mergeAllSummaries(input.nodeIssueSummaries, record.nodeId, record.nodePath)
      : nodeSummaryMap.get(record.nodeId);
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
        category: uncovered.suggestedCategory,
        description: uncovered.description,
      });
    }
  }

  // Override responsive-critical rule evaluations with measured responsiveDelta
  if (input.responsiveDelta != null) {
    const responsiveDifficulty = responsiveDeltaToDifficulty(input.responsiveDelta);
    for (const mismatch of mismatches) {
      if (!mismatch.ruleId) continue;
      if (!(mismatch.ruleId in RULE_ID_CATEGORY)) continue;
      const category = RULE_ID_CATEGORY[mismatch.ruleId as RuleId];
      if (category !== "responsive-critical") continue;

      const prevType = mismatch.type;
      const newType = classifyFlaggedRule(mismatch.currentScore ?? 0, responsiveDifficulty);
      mismatch.type = newType;
      mismatch.actualDifficulty = responsiveDifficulty;
      mismatch.reasoning = buildReasoning(newType, mismatch.ruleId, mismatch.currentScore, responsiveDifficulty)
        + ` (responsive: delta=${input.responsiveDelta}%p, overrides AI opinion "${prevType}")`;

      if (newType === "validated") {
        validatedRuleSet.add(mismatch.ruleId);
      } else {
        validatedRuleSet.delete(mismatch.ruleId);
      }
    }
  }

  // Override rule evaluations with objective strip ablation deltas
  if (input.stripDeltas) {
    for (const mismatch of mismatches) {
      if (!mismatch.ruleId) continue;
      const stripDifficulty = getStripDifficultyForRule(mismatch.ruleId, input.stripDeltas);
      if (!stripDifficulty) continue;

      const prevType = mismatch.type;
      const newType = classifyFlaggedRule(mismatch.currentScore ?? 0, stripDifficulty);
      mismatch.type = newType;
      mismatch.actualDifficulty = stripDifficulty;
      mismatch.reasoning = buildReasoning(newType, mismatch.ruleId, mismatch.currentScore, stripDifficulty)
        + ` (strip-ablation: overrides AI opinion "${prevType}")`;

      if (newType === "validated") {
        validatedRuleSet.add(mismatch.ruleId);
      } else {
        validatedRuleSet.delete(mismatch.ruleId);
      }
    }
  }

  return {
    mismatches,
    validatedRules: [...validatedRuleSet],
  };
}

/**
 * Map strip type to related rule IDs.
 * Based on what information each strip type removes and which rules detect those issues.
 */
const STRIP_TYPE_RULES: Record<DesignTreeInfoType, RuleId[]> = {
  "layout-direction-spacing": ["no-auto-layout", "absolute-position-in-auto-layout", "non-layout-container", "irregular-spacing"],
  "component-references": ["missing-component", "detached-instance", "variant-structure-mismatch"],
  "node-names-hierarchy": ["non-standard-naming", "non-semantic-name", "inconsistent-naming-convention"],
  "variable-references": ["raw-value"],
  "style-references": ["raw-value"],
};

/**
 * Get the objective strip-based difficulty for a rule.
 * If multiple strip types affect the same rule, take the maximum delta (worst case).
 */
function getStripDifficultyForRule(
  ruleId: string,
  stripDeltas: Record<string, number>,
): Difficulty | null {
  let maxDelta = -1;
  for (const [stripType, ruleIds] of Object.entries(STRIP_TYPE_RULES)) {
    if (!ruleIds.includes(ruleId as RuleId)) continue;
    const delta = stripDeltas[stripType];
    if (delta != null && delta > maxDelta) {
      maxDelta = delta;
    }
  }
  if (maxDelta < 0) return null;
  return stripDeltaToDifficulty(maxDelta);
}

/**
 * Map responsiveDelta to difficulty.
 * Based on ablation Experiment 04: structure drops -32%p at different viewport.
 * Higher delta = more responsive breakage = harder to implement.
 */
function responsiveDeltaToDifficulty(delta: number): Difficulty {
  // Negative delta = expanded viewport matches better than original (unusual).
  // Treat as easy — the design is not breaking at wider viewport.
  const d = Math.max(0, delta);
  if (d <= 5) return "easy";      // minimal responsive breakage
  if (d <= 15) return "moderate";  // noticeable breakage
  if (d <= 30) return "hard";      // severe breakage
  return "failed";                  // completely broken at expanded viewport
}
