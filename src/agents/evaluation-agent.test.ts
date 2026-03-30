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

  it("overrides layout rule from validated to underscored when strip delta is high", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["no-auto-layout"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "no-auto-layout", description: "Seemed easy", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "no-auto-layout": { score: -3, severity: "blocking" },
      },
      stripDeltas: {
        "layout-direction-spacing": 20,
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "no-auto-layout");
    expect(match).toBeDefined();
    // AI said "easy" but strip delta=20 → hard → score -3 is underscored (expected -8 to -12)
    expect(match!.type).toBe("underscored");
    expect(match!.actualDifficulty).toBe("hard");
    expect(match!.reasoning).toContain("strip-ablation");
    expect(result.validatedRules).not.toContain("no-auto-layout");
  });

  it("validates a rule when strip delta is low", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["missing-component"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "missing-component", description: "Fine", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "missing-component": { score: -3, severity: "risk" },
      },
      stripDeltas: {
        "component-references": 2,
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "missing-component");
    expect(match).toBeDefined();
    expect(match!.type).toBe("validated");
    expect(match!.actualDifficulty).toBe("easy");
    expect(result.validatedRules).toContain("missing-component");
  });

  it("does not override rules unrelated to any strip type", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["deep-nesting"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "deep-nesting", description: "Easy", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "deep-nesting": { score: -3, severity: "risk" },
      },
      stripDeltas: {
        "layout-direction-spacing": 25,
        "component-references": 20,
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "deep-nesting");
    expect(match).toBeDefined();
    // deep-nesting has no strip type mapping — no override
    expect(match!.type).toBe("validated");
  });

  it("takes max delta when multiple strip types affect the same rule", () => {
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
        "raw-value": { score: -2, severity: "missing-info" },
      },
      stripDeltas: {
        "variable-references": 3,   // easy
        "style-references": 18,     // hard
      },
    };

    const result = runEvaluationAgent(input);

    const match = result.mismatches.find(m => m.ruleId === "raw-value");
    expect(match).toBeDefined();
    // max delta is 18 (style-references) → hard → score -2 is underscored
    expect(match!.type).toBe("underscored");
    expect(match!.actualDifficulty).toBe("hard");
  });

  it("strip delta overrides apply after responsive delta overrides", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Frame", flaggedRuleIds: ["no-auto-layout", "fixed-size-in-auto-layout"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Frame",
          difficulty: "easy",
          ruleRelatedStruggles: [
            { ruleId: "no-auto-layout", description: "Fine", actualImpact: "easy" },
            { ruleId: "fixed-size-in-auto-layout", description: "Fine", actualImpact: "easy" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "no-auto-layout": { score: -10, severity: "blocking" },
        "fixed-size-in-auto-layout": { score: -6, severity: "risk" },
      },
      responsiveDelta: 25,
      stripDeltas: {
        "layout-direction-spacing": 8,
      },
    };

    const result = runEvaluationAgent(input);

    // no-auto-layout: strip delta=8 → moderate → score -10 overscored
    const layoutMatch = result.mismatches.find(m => m.ruleId === "no-auto-layout");
    expect(layoutMatch).toBeDefined();
    expect(layoutMatch!.actualDifficulty).toBe("moderate");
    expect(layoutMatch!.reasoning).toContain("strip-ablation");

    // fixed-size-in-auto-layout: responsive delta applied first, but no strip mapping for responsive-critical
    const responsiveMatch = result.mismatches.find(m => m.ruleId === "fixed-size-in-auto-layout");
    expect(responsiveMatch).toBeDefined();
    expect(responsiveMatch!.actualDifficulty).toBe("hard");
    expect(responsiveMatch!.reasoning).toContain("responsive");
  });

  it("merges all nodeIssueSummaries when wholeDesign is true", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "root", nodePath: "Page", flaggedRuleIds: ["rule-a"] },
        { nodeId: "child-1", nodePath: "Page > Card", flaggedRuleIds: ["rule-b"] },
        { nodeId: "child-2", nodePath: "Page > Header", flaggedRuleIds: ["rule-c"] },
      ],
      conversionRecords: [
        {
          nodeId: "root",
          nodePath: "Page",
          difficulty: "moderate",
          ruleRelatedStruggles: [
            { ruleId: "rule-a", description: "Struggled", actualImpact: "hard" },
          ],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -10, severity: "blocking" },
        "rule-b": { score: -5, severity: "risk" },
        "rule-c": { score: -3, severity: "suggestion" },
      },
      wholeDesign: true,
    };

    const result = runEvaluationAgent(input);

    // rule-b and rule-c from child nodes should appear as validated (not silently dropped)
    const ruleB = result.mismatches.find(m => m.ruleId === "rule-b");
    const ruleC = result.mismatches.find(m => m.ruleId === "rule-c");
    expect(ruleB).toBeDefined();
    expect(ruleB!.type).toBe("validated");
    expect(ruleC).toBeDefined();
    expect(ruleC!.type).toBe("validated");
    expect(result.validatedRules).toContain("rule-b");
    expect(result.validatedRules).toContain("rule-c");
  });

  it("does not merge summaries when wholeDesign is false", () => {
    const input: EvaluationAgentInput = {
      nodeIssueSummaries: [
        { nodeId: "node-1", nodePath: "Page > Card", flaggedRuleIds: ["rule-a"] },
        { nodeId: "node-2", nodePath: "Page > Header", flaggedRuleIds: ["rule-b"] },
      ],
      conversionRecords: [
        {
          nodeId: "node-1",
          nodePath: "Page > Card",
          difficulty: "easy",
          ruleRelatedStruggles: [],
          uncoveredStruggles: [],
        },
        {
          nodeId: "node-2",
          nodePath: "Page > Header",
          difficulty: "easy",
          ruleRelatedStruggles: [],
          uncoveredStruggles: [],
        },
      ],
      ruleScores: {
        "rule-a": { score: -3, severity: "risk" },
        "rule-b": { score: -3, severity: "risk" },
      },
    };

    const result = runEvaluationAgent(input);

    // Each record should only see its own summary's rules (no cross-contamination)
    const ruleAMatches = result.mismatches.filter(m => m.ruleId === "rule-a");
    const ruleBMatches = result.mismatches.filter(m => m.ruleId === "rule-b");
    expect(ruleAMatches).toHaveLength(1);
    expect(ruleAMatches[0]!.nodeId).toBe("node-1");
    expect(ruleBMatches).toHaveLength(1);
    expect(ruleBMatches[0]!.nodeId).toBe("node-2");
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
