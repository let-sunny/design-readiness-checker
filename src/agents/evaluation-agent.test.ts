import type { EvaluationAgentInput } from "./contracts/evaluation-agent.js";
import { runEvaluationAgent } from "./evaluation-agent.js";

describe("runEvaluationAgent", () => {
  it("validates a rule whose score falls within the expected range for the actual difficulty", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["rule-a"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "hard",
          ruleRelatedStruggles: [
            { ruleId: "rule-a", description: "Hard to convert", actualImpact: "hard" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -10, severity: "blocking" },
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.ruleId === "rule-a" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    expect(match!.type).toBe("validated");
    expect(result.validatedRules).toContain("rule-a");
  });

  it("detects overscored when rule score is too harsh for actual easy difficulty", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["rule-a"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "rule-a", description: "Easy conversion", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -10, severity: "blocking" },
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.ruleId === "rule-a" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    expect(match!.type).toBe("overscored");
    expect(result.validatedRules).not.toContain("rule-a");
  });

  it("detects underscored when rule score is too lenient for actual hard difficulty", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["rule-a"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "hard",
          ruleRelatedStruggles: [
            { ruleId: "rule-a", description: "Very hard conversion", actualImpact: "hard" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -2, severity: "suggestion" },
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.ruleId === "rule-a" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    expect(match!.type).toBe("underscored");
    expect(result.validatedRules).not.toContain("rule-a");
  });

  it("creates missing-rule mismatch for uncovered struggles", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "hard",
          ruleRelatedStruggles: [],
          uncoveredStruggles: [
            {
              description: "Shadow not representable",
              suggestedCategory: "visual-effects",
              estimatedImpact: "hard",
            },
          ],
        },
      ],
      ruleScores: {},
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.type === "missing-rule" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    expect(match!.type).toBe("missing-rule");
    expect(match!.actualDifficulty).toBe("hard");
    expect(match!.ruleId).toBeUndefined();
    expect(result.validatedRules).toHaveLength(0);
  });

  it("validates a flagged rule with no struggle even when overall difficulty is easy", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["rule-a"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -6, severity: "risk" },
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.ruleId === "rule-a" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    // No explicit easy signal from Converter → validated, not overscored
    expect(match!.type).toBe("validated");
    expect(match!.actualDifficulty).toBe("easy");
    expect(result.validatedRules).toContain("rule-a");
  });

  it("conservatively validates a flagged rule with no struggle when overall difficulty is hard", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["rule-a"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "hard",
          ruleRelatedStruggles: [],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -8, severity: "blocking" },
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(
      (m) => m.ruleId === "rule-a" && m.nodeId === "node-1"
    );
    expect(match).toBeDefined();
    expect(match!.type).toBe("validated");
    expect(match!.actualDifficulty).toBe("hard");
    expect(result.validatedRules).toContain("rule-a");
  });

  it("overrides responsive-critical rule from validated to underscored when responsiveDelta is high", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["fixed-size-in-auto-layout"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "fixed-size-in-auto-layout", description: "Looked fine", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "fixed-size-in-auto-layout": { score: -6, severity: "risk" },
      },
      responsiveDelta: 25,
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "fixed-size-in-auto-layout");
    expect(match).toBeDefined();
    // AI said "easy" but responsiveDelta=25 → hard → score -6 is underscored (expected -8 to -12)
    expect(match!.type).toBe("underscored");
    expect(match!.actualDifficulty).toBe("hard");
    expect(match!.reasoning).toContain("responsive");
    // Must NOT be in validatedRules (was validated before override, removed after)
    expect(result.validatedRules).not.toContain("fixed-size-in-auto-layout");
  });

  it("keeps responsive-critical rule validated when responsiveDelta is low", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["missing-size-constraint"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "missing-size-constraint", description: "Fine", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "missing-size-constraint": { score: -2, severity: "suggestion" },
      },
      responsiveDelta: 3,
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "missing-size-constraint");
    expect(match).toBeDefined();
    expect(match!.type).toBe("validated");
    expect(match!.actualDifficulty).toBe("easy");
    expect(result.validatedRules).toContain("missing-size-constraint");
  });

  it("does not override non-responsive-critical rules even with high responsiveDelta", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["raw-value"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "raw-value", description: "Easy", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "raw-value": { score: -3, severity: "missing-info" },
      },
      responsiveDelta: 30,
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "raw-value");
    expect(match).toBeDefined();
    // raw-value is token-management, not responsive-critical — no override
    expect(match!.type).toBe("validated");
  });

  it("treats negative responsiveDelta as easy", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["fixed-size-in-auto-layout"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "fixed-size-in-auto-layout", description: "Fine", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "fixed-size-in-auto-layout": { score: -2, severity: "suggestion" },
      },
      responsiveDelta: -5,
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "fixed-size-in-auto-layout");
    expect(match).toBeDefined();
    expect(match!.actualDifficulty).toBe("easy");
  });

  it("returns empty mismatches and validatedRules for empty input", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [],
      conversionRecords: [],
      ruleScores: {},
    };

    const result = runEvaluationAgent(input);

    expect(result.mismatches).toHaveLength(0);
    expect(result.validatedRules).toHaveLength(0);
  });
});
