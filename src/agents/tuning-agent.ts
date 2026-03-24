import type { Severity } from "@/core/contracts/severity.js";
import type { Confidence } from "./contracts/tuning-agent.js";
import type {
  TuningAgentInput,
  TuningAgentOutput,
  ScoreAdjustment,
  NewRuleProposal,
} from "./contracts/tuning-agent.js";

/**
 * Difficulty-to-score midpoint mapping for proposing new scores
 */
const DIFFICULTY_MIDPOINT: Record<string, number> = {
  easy: -2,
  moderate: -5,
  hard: -10,
  failed: -12,
};

/**
 * Difficulty-to-severity mapping for new rule proposals
 */
const DIFFICULTY_SEVERITY: Record<string, Severity> = {
  easy: "suggestion",
  moderate: "risk",
  hard: "blocking",
  failed: "blocking",
};

/**
 * Determine confidence based on number of supporting cases
 */
function getConfidence(caseCount: number): Confidence {
  if (caseCount >= 3) return "high";
  if (caseCount >= 2) return "medium";
  return "low";
}

/**
 * Score range for worst-case floor clamping
 */
const DIFFICULTY_SCORE_MAX: Record<string, number> = {
  easy: 0,
  moderate: -4,
  hard: -8,
  failed: -8,
};

/**
 * Propose a score based on weighted average of actual difficulties,
 * with a worst-case floor so hard cases aren't drowned out by easy ones.
 */
function proposedScoreFromDifficulties(difficulties: string[]): number {
  if (difficulties.length === 0) return -5;

  // Weighted average: Σ(midpoint × count) / total
  let sum = 0;
  let worstFloor = 0;
  for (const d of difficulties) {
    const midpoint = DIFFICULTY_MIDPOINT[d] ?? -5;
    sum += midpoint;
    // Track the harshest floor from any observed difficulty
    const floor = DIFFICULTY_SCORE_MAX[d] ?? -5;
    if (floor < worstFloor) worstFloor = floor;
  }

  const weightedAvg = Math.round(sum / difficulties.length);

  // Clamp: proposed score must be at least as harsh as the worst observed difficulty's range start
  return Math.min(weightedAvg, worstFloor);
}

/**
 * Determine if severity should change based on proposed score
 */
function proposeSeverity(
  currentSeverity: Severity,
  proposedScore: number
): Severity | undefined {
  let expectedSeverity: Severity;
  if (proposedScore <= -8) {
    expectedSeverity = "blocking";
  } else if (proposedScore <= -4) {
    expectedSeverity = "risk";
  } else if (proposedScore <= -2) {
    expectedSeverity = "missing-info";
  } else {
    expectedSeverity = "suggestion";
  }

  if (expectedSeverity !== currentSeverity) {
    return expectedSeverity;
  }
  return undefined;
}

/**
 * Tuning Agent - Step 4 of calibration pipeline
 *
 * Deterministic aggregation algorithm. No LLM required.
 * Aggregates mismatch cases into score adjustment proposals.
 */
export function runTuningAgent(
  input: TuningAgentInput
): TuningAgentOutput {
  const adjustments: ScoreAdjustment[] = [];
  const newRuleProposals: NewRuleProposal[] = [];

  // Group mismatches by ruleId for overscored and underscored
  const overscoredByRule = new Map<string, typeof input.mismatches>();
  const underscoredByRule = new Map<string, typeof input.mismatches>();
  const missingRuleCases: typeof input.mismatches = [];

  for (const mismatch of input.mismatches) {
    switch (mismatch.type) {
      case "overscored": {
        if (!mismatch.ruleId) break;
        const existing = overscoredByRule.get(mismatch.ruleId);
        if (existing) {
          existing.push(mismatch);
        } else {
          overscoredByRule.set(mismatch.ruleId, [mismatch]);
        }
        break;
      }
      case "underscored": {
        if (!mismatch.ruleId) break;
        const existing = underscoredByRule.get(mismatch.ruleId);
        if (existing) {
          existing.push(mismatch);
        } else {
          underscoredByRule.set(mismatch.ruleId, [mismatch]);
        }
        break;
      }
      case "missing-rule":
        missingRuleCases.push(mismatch);
        break;
    }
  }

  // Generate score reduction proposals for overscored rules
  for (const [ruleId, cases] of overscoredByRule) {
    const ruleInfo = input.ruleScores[ruleId];
    if (!ruleInfo) continue;

    const difficulties = cases.map((c) => c.actualDifficulty);
    const proposedScore = proposedScoreFromDifficulties(difficulties);
    const currentSeverity = ruleInfo.severity as Severity;
    const newSeverity = proposeSeverity(currentSeverity, proposedScore);

    adjustments.push({
      ruleId,
      currentScore: ruleInfo.score,
      proposedScore,
      currentSeverity,
      proposedSeverity: newSeverity,
      reasoning: `Overscored in ${cases.length} case(s). Actual difficulties: [${difficulties.join(", ")}]. Current score ${ruleInfo.score} is too harsh.`,
      confidence: getConfidence(cases.length),
      supportingCases: cases.length,
    });
  }

  // Generate score increase proposals for underscored rules
  for (const [ruleId, cases] of underscoredByRule) {
    const ruleInfo = input.ruleScores[ruleId];
    if (!ruleInfo) continue;

    const difficulties = cases.map((c) => c.actualDifficulty);
    const proposedScore = proposedScoreFromDifficulties(difficulties);
    const currentSeverity = ruleInfo.severity as Severity;
    const newSeverity = proposeSeverity(currentSeverity, proposedScore);

    adjustments.push({
      ruleId,
      currentScore: ruleInfo.score,
      proposedScore,
      currentSeverity,
      proposedSeverity: newSeverity,
      reasoning: `Underscored in ${cases.length} case(s). Actual difficulties: [${difficulties.join(", ")}]. Current score ${ruleInfo.score} is too lenient.`,
      confidence: getConfidence(cases.length),
      supportingCases: cases.length,
    });
  }

  // Generate new rule proposals from missing-rule cases
  // Group by suggestedCategory extracted from reasoning
  const missingGrouped = new Map<string, typeof input.mismatches>();

  for (const c of missingRuleCases) {
    // Extract category from reasoning pattern: "category: <value>"
    const categoryMatch = c.reasoning.match(/category:\s*([^,)]+)/);
    const category = categoryMatch?.[1]?.trim() ?? "unknown";

    const existing = missingGrouped.get(category);
    if (existing) {
      existing.push(c);
    } else {
      missingGrouped.set(category, [c]);
    }
  }

  for (const [category, cases] of missingGrouped) {
    const difficulties = cases.map((c) => c.actualDifficulty);
    const dominantDifficulty = getDominantDifficulty(difficulties);
    const descriptions = cases.map((c) => {
      const descMatch = c.reasoning.match(/Uncovered struggle: "([^"]+)"/);
      return descMatch?.[1] ?? c.reasoning;
    });

    newRuleProposals.push({
      suggestedId: `new-${category}-rule`,
      category,
      description: descriptions.join("; "),
      suggestedSeverity: DIFFICULTY_SEVERITY[dominantDifficulty] ?? "risk",
      suggestedScore: DIFFICULTY_MIDPOINT[dominantDifficulty] ?? -5,
      reasoning: `${cases.length} uncovered struggle(s) in category "${category}". Difficulties: [${difficulties.join(", ")}].`,
      supportingCases: cases.length,
    });
  }

  return { adjustments, newRuleProposals };
}

function getDominantDifficulty(difficulties: string[]): string {
  const counts: Record<string, number> = {};
  for (const d of difficulties) {
    counts[d] = (counts[d] ?? 0) + 1;
  }

  let dominant = difficulties[0] ?? "moderate";
  let maxCount = 0;
  for (const [difficulty, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominant = difficulty;
    }
  }
  return dominant;
}
