import { runTuningAgent } from "./tuning-agent.js";
import type { TuningAgentInput } from "./contracts/tuning-agent.js";

function makeMismatch(
  overrides: Partial<TuningAgentInput["mismatches"][number]> & {
    type: string;
    actualDifficulty: string;
  }
): TuningAgentInput["mismatches"][number] {
  return {
    nodeId: "node-1",
    nodePath: "Page > Frame",
    reasoning: "test reasoning",
    ...overrides,
  };
}

describe("runTuningAgent", () => {
  it("proposes score reduction for overscored mismatches", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "overscored",
          ruleId: "no-auto-layout",
          currentScore: -8,
          currentSeverity: "blocking",
          actualDifficulty: "easy",
          reasoning: "Was easy to implement without auto layout",
        }),
        makeMismatch({
          type: "overscored",
          ruleId: "no-auto-layout",
          nodeId: "node-2",
          currentScore: -8,
          currentSeverity: "blocking",
          actualDifficulty: "easy",
          reasoning: "Simple manual layout worked fine",
        }),
      ],
      ruleScores: {
        "no-auto-layout": { score: -8, severity: "blocking" },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(1);
    const adj = result.adjustments[0]!;
    expect(adj.ruleId).toBe("no-auto-layout");
    expect(adj.proposedScore).toBe(-2);
    expect(adj.currentScore).toBe(-8);
    expect(adj.confidence).toBe("medium");
    expect(adj.supportingCases).toBe(2);
    expect(result.newRuleProposals).toHaveLength(0);
  });

  it("proposes score increase for underscored mismatches with severity change", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "underscored",
          ruleId: "magic-number-spacing",
          currentScore: -2,
          currentSeverity: "missing-info",
          actualDifficulty: "hard",
          reasoning: "Very difficult to guess correct spacing",
        }),
        makeMismatch({
          type: "underscored",
          ruleId: "magic-number-spacing",
          nodeId: "node-2",
          currentScore: -2,
          currentSeverity: "missing-info",
          actualDifficulty: "hard",
          reasoning: "Required multiple attempts",
        }),
        makeMismatch({
          type: "underscored",
          ruleId: "magic-number-spacing",
          nodeId: "node-3",
          currentScore: -2,
          currentSeverity: "missing-info",
          actualDifficulty: "hard",
          reasoning: "Spacing was completely off",
        }),
      ],
      ruleScores: {
        "magic-number-spacing": { score: -2, severity: "missing-info" },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(1);
    const adj = result.adjustments[0]!;
    expect(adj.ruleId).toBe("magic-number-spacing");
    expect(adj.proposedScore).toBe(-10);
    expect(adj.confidence).toBe("high");
    expect(adj.supportingCases).toBe(3);
    // Score -10 maps to "blocking", current is "missing-info" → severity change proposed
    expect(adj.proposedSeverity).toBe("blocking");
    expect(adj.currentSeverity).toBe("missing-info");
    expect(result.newRuleProposals).toHaveLength(0);
  });

  it("generates new rule proposals for missing-rule mismatches grouped by category", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "missing-rule",
          actualDifficulty: "hard",
          reasoning:
            'Uncovered struggle: "inconsistent border radius". category: border-radius',
          category: "border-radius",
          description: "inconsistent border radius",
        }),
        makeMismatch({
          type: "missing-rule",
          nodeId: "node-2",
          actualDifficulty: "hard",
          reasoning:
            'Uncovered struggle: "mixed border radius values". category: border-radius',
          category: "border-radius",
          description: "mixed border radius values",
        }),
        makeMismatch({
          type: "missing-rule",
          nodeId: "node-3",
          actualDifficulty: "moderate",
          reasoning:
            'Uncovered struggle: "no text truncation rule". category: text-overflow',
          category: "text-overflow",
          description: "no text truncation rule",
        }),
      ],
      ruleScores: {},
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(0);
    expect(result.newRuleProposals).toHaveLength(2);

    const borderRadiusProposal = result.newRuleProposals.find(
      (p) => p.category === "border-radius"
    );
    expect(borderRadiusProposal).toBeDefined();
    expect(borderRadiusProposal!.suggestedId).toBe("new-border-radius-rule");
    expect(borderRadiusProposal!.suggestedSeverity).toBe("blocking");
    expect(borderRadiusProposal!.suggestedScore).toBe(-10);
    expect(borderRadiusProposal!.supportingCases).toBe(2);

    const textOverflowProposal = result.newRuleProposals.find(
      (p) => p.category === "text-overflow"
    );
    expect(textOverflowProposal).toBeDefined();
    expect(textOverflowProposal!.suggestedId).toBe("new-text-overflow-rule");
    expect(textOverflowProposal!.suggestedSeverity).toBe("risk");
    expect(textOverflowProposal!.suggestedScore).toBe(-5);
    expect(textOverflowProposal!.supportingCases).toBe(1);
  });

  it("assigns confidence levels based on supporting case count", () => {
    const input: TuningAgentInput = {
      mismatches: [
        // 1 case → low
        makeMismatch({
          type: "overscored",
          ruleId: "rule-a",
          actualDifficulty: "easy",
          reasoning: "single case",
        }),
        // 2 cases → medium
        makeMismatch({
          type: "overscored",
          ruleId: "rule-b",
          actualDifficulty: "moderate",
          reasoning: "case 1",
        }),
        makeMismatch({
          type: "overscored",
          ruleId: "rule-b",
          nodeId: "node-2",
          actualDifficulty: "moderate",
          reasoning: "case 2",
        }),
        // 3 cases → high
        makeMismatch({
          type: "overscored",
          ruleId: "rule-c",
          actualDifficulty: "hard",
          reasoning: "case 1",
        }),
        makeMismatch({
          type: "overscored",
          ruleId: "rule-c",
          nodeId: "node-2",
          actualDifficulty: "hard",
          reasoning: "case 2",
        }),
        makeMismatch({
          type: "overscored",
          ruleId: "rule-c",
          nodeId: "node-3",
          actualDifficulty: "hard",
          reasoning: "case 3",
        }),
      ],
      ruleScores: {
        "rule-a": { score: -6, severity: "risk" },
        "rule-b": { score: -6, severity: "risk" },
        "rule-c": { score: -6, severity: "risk" },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(3);

    const adjA = result.adjustments.find((a) => a.ruleId === "rule-a");
    expect(adjA!.confidence).toBe("low");
    expect(adjA!.supportingCases).toBe(1);

    const adjB = result.adjustments.find((a) => a.ruleId === "rule-b");
    expect(adjB!.confidence).toBe("medium");
    expect(adjB!.supportingCases).toBe(2);

    const adjC = result.adjustments.find((a) => a.ruleId === "rule-c");
    expect(adjC!.confidence).toBe("high");
    expect(adjC!.supportingCases).toBe(3);
  });

  it("returns empty adjustments and proposals for empty mismatches", () => {
    const input: TuningAgentInput = {
      mismatches: [],
      ruleScores: {
        "some-rule": { score: -5, severity: "risk" },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(0);
    expect(result.newRuleProposals).toHaveLength(0);
  });

  it("merges prior evidence to boost supportingCases and confidence", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "overscored",
          ruleId: "no-auto-layout",
          currentScore: -8,
          currentSeverity: "blocking",
          actualDifficulty: "easy",
          reasoning: "Single current case",
        }),
      ],
      ruleScores: {
        "no-auto-layout": { score: -8, severity: "blocking" },
      },
      priorEvidence: {
        "no-auto-layout": {
          overscoredCount: 2,
          underscoredCount: 0,
          overscoredDifficulties: ["easy", "easy"],
          underscoredDifficulties: [],
        },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(1);
    const adj = result.adjustments[0]!;
    expect(adj.ruleId).toBe("no-auto-layout");
    // 1 current + 2 prior = 3 → high confidence
    expect(adj.supportingCases).toBe(3);
    expect(adj.confidence).toBe("high");
    expect(adj.reasoning).toContain("+ 2 case(s) from prior runs");
  });

  it("generates prior-only proposals when no current mismatches but strong prior evidence", () => {
    const input: TuningAgentInput = {
      mismatches: [],
      ruleScores: {
        "raw-color": { score: -6, severity: "risk" },
      },
      priorEvidence: {
        "raw-color": {
          overscoredCount: 3,
          underscoredCount: 0,
          overscoredDifficulties: ["easy", "easy", "easy"],
          underscoredDifficulties: [],
        },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(1);
    const adj = result.adjustments[0]!;
    expect(adj.ruleId).toBe("raw-color");
    expect(adj.supportingCases).toBe(3);
    expect(adj.confidence).toBe("high");
    expect(adj.reasoning).toContain("+ 3 case(s) from prior runs");
  });


  it("includes elasticity data in adjustments when profiles are provided", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "overscored",
          ruleId: "no-auto-layout",
          currentScore: -8,
          currentSeverity: "blocking",
          actualDifficulty: "easy",
          reasoning: "Was easy",
        }),
      ],
      ruleScores: {
        "no-auto-layout": { score: -8, severity: "blocking" },
      },
      elasticityProfiles: [
        {
          ruleId: "no-auto-layout",
          measurements: 3,
          meanDelta: 4.5,
          minDelta: 2,
          maxDelta: 7,
          confidence: "high",
          fixtures: ["fx1", "fx2", "fx3"],
        },
      ],
    };

    const result = runTuningAgent(input);
    const adj = result.adjustments[0]!;

    expect(adj.elasticity).toBeDefined();
    expect(adj.elasticity!.meanDelta).toBe(4.5);
    expect(adj.elasticity!.measurements).toBe(3);
    expect(adj.elasticity!.confidence).toBe("high");
    expect(adj.reasoning).toContain("Elasticity: +4.5%");
  });

  it("omits elasticity field when no matching profile exists", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "overscored",
          ruleId: "raw-color",
          currentScore: -6,
          currentSeverity: "risk",
          actualDifficulty: "easy",
          reasoning: "Easy color",
        }),
      ],
      ruleScores: {
        "raw-color": { score: -6, severity: "risk" },
      },
      elasticityProfiles: [],
    };

    const result = runTuningAgent(input);
    const adj = result.adjustments[0]!;

    expect(adj.elasticity).toBeUndefined();
    expect(adj.reasoning).not.toContain("Elasticity");
  });

  it("ignores validated mismatches and only processes overscored/underscored/missing-rule", () => {
    const input: TuningAgentInput = {
      mismatches: [
        makeMismatch({
          type: "validated",
          ruleId: "no-auto-layout",
          actualDifficulty: "hard",
          reasoning: "Score was accurate",
        }),
        makeMismatch({
          type: "validated",
          ruleId: "magic-number-spacing",
          nodeId: "node-2",
          actualDifficulty: "moderate",
          reasoning: "Matched expected difficulty",
        }),
        makeMismatch({
          type: "correct",
          ruleId: "no-auto-layout",
          nodeId: "node-3",
          actualDifficulty: "easy",
          reasoning: "No mismatch detected",
        }),
      ],
      ruleScores: {
        "no-auto-layout": { score: -8, severity: "blocking" },
        "magic-number-spacing": { score: -5, severity: "risk" },
      },
    };

    const result = runTuningAgent(input);

    expect(result.adjustments).toHaveLength(0);
    expect(result.newRuleProposals).toHaveLength(0);
  });
});
