import { runAnalysisAgent, extractRuleScores } from "./analysis-agent.js";
import type { AnalysisResult, AnalysisIssue } from "../core/engine/rule-engine.js";
import type { AnalysisFile } from "../core/contracts/figma-node.js";

const mockFile = {
  fileKey: "test",
  name: "Test",
  lastModified: "",
  version: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    visible: true,
  },
  components: {},
  styles: {},
} as unknown as AnalysisFile;

function createMockIssue(overrides: {
  nodeId: string;
  ruleId: string;
  severity?: string;
  calculatedScore?: number;
  nodePath?: string;
  configScore?: number;
}): AnalysisIssue {
  return {
    violation: {
      ruleId: overrides.ruleId,
      nodeId: overrides.nodeId,
      nodePath: overrides.nodePath ?? `Page > Frame > ${overrides.nodeId}`,
      message: `Issue from ${overrides.ruleId}`,
    },
    rule: {
      definition: {
        id: overrides.ruleId,
        name: `Rule ${overrides.ruleId}`,
        category: "pixel-critical",
        why: "test reason",
        impact: "test impact",
        fix: "test fix",
      },
      check: () => null,
    },
    config: {
      severity: overrides.severity ?? "risk",
      score: overrides.configScore ?? 5,
      enabled: true,
    },
    depth: 2,
    maxDepth: 5,
    calculatedScore: overrides.calculatedScore ?? -3,
  } as unknown as AnalysisIssue;
}

function createMockResult(issues: AnalysisIssue[]): AnalysisResult {
  return {
    file: mockFile,
    issues,
    failedRules: [],
    maxDepth: 5,
    nodeCount: 10,
    analyzedAt: "2026-01-01T00:00:00Z",
    scope: "page",
  };
}

describe("runAnalysisAgent", () => {
  it("groups issues by nodeId correctly", () => {
    const issues = [
      createMockIssue({ nodeId: "1:1", ruleId: "rule-a", calculatedScore: -2 }),
      createMockIssue({ nodeId: "1:1", ruleId: "rule-b", calculatedScore: -3 }),
      createMockIssue({ nodeId: "2:1", ruleId: "rule-a", calculatedScore: -1 }),
    ];

    const result = runAnalysisAgent({ analysisResult: createMockResult(issues) });

    const summaryForNode1 = result.nodeIssueSummaries.find(
      (s) => s.nodeId === "1:1"
    );
    const summaryForNode2 = result.nodeIssueSummaries.find(
      (s) => s.nodeId === "2:1"
    );

    expect(summaryForNode1).toBeDefined();
    expect(summaryForNode1!.issueCount).toBe(2);
    expect(summaryForNode1!.totalScore).toBe(-5);

    expect(summaryForNode2).toBeDefined();
    expect(summaryForNode2!.issueCount).toBe(1);
    expect(summaryForNode2!.totalScore).toBe(-1);
  });

  it("sorts by totalScore with most negative first", () => {
    const issues = [
      createMockIssue({ nodeId: "1:1", ruleId: "rule-a", calculatedScore: -1 }),
      createMockIssue({ nodeId: "2:1", ruleId: "rule-a", calculatedScore: -10 }),
      createMockIssue({ nodeId: "3:1", ruleId: "rule-a", calculatedScore: -5 }),
    ];

    const result = runAnalysisAgent({ analysisResult: createMockResult(issues) });

    expect(result.nodeIssueSummaries[0]!.nodeId).toBe("2:1");
    expect(result.nodeIssueSummaries[1]!.nodeId).toBe("3:1");
    expect(result.nodeIssueSummaries[2]!.nodeId).toBe("1:1");
  });

  it("deduplicates flaggedRuleIds within a node", () => {
    const issues = [
      createMockIssue({ nodeId: "1:1", ruleId: "rule-a", calculatedScore: -2 }),
      createMockIssue({ nodeId: "1:1", ruleId: "rule-a", calculatedScore: -3 }),
      createMockIssue({ nodeId: "1:1", ruleId: "rule-b", calculatedScore: -1 }),
    ];

    const result = runAnalysisAgent({ analysisResult: createMockResult(issues) });

    const summary = result.nodeIssueSummaries.find((s) => s.nodeId === "1:1");
    expect(summary).toBeDefined();
    expect(summary!.issueCount).toBe(3);
    expect(summary!.flaggedRuleIds).toHaveLength(2);
    expect(summary!.flaggedRuleIds).toContain("rule-a");
    expect(summary!.flaggedRuleIds).toContain("rule-b");
  });

  it("returns empty summaries for zero issues", () => {
    const result = runAnalysisAgent({ analysisResult: createMockResult([]) });

    expect(result.nodeIssueSummaries).toEqual([]);
    expect(result.analysisResult.issues).toHaveLength(0);
  });
});

describe("extractRuleScores", () => {
  it("returns unique rule scores keyed by ruleId", () => {
    const issues = [
      createMockIssue({
        nodeId: "1:1",
        ruleId: "rule-a",
        severity: "blocking",
        configScore: 10,
      }),
      createMockIssue({
        nodeId: "2:1",
        ruleId: "rule-a",
        severity: "blocking",
        configScore: 10,
      }),
      createMockIssue({
        nodeId: "1:1",
        ruleId: "rule-b",
        severity: "suggestion",
        configScore: 2,
      }),
    ];

    const scores = extractRuleScores(createMockResult(issues));

    expect(Object.keys(scores)).toHaveLength(2);
    expect(scores["rule-a"]).toEqual({ score: 10, severity: "blocking" });
    expect(scores["rule-b"]).toEqual({ score: 2, severity: "suggestion" });
  });
});
