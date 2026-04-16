import { generateGotchaSurvey } from "./survey-generator.js";
import { GotchaSurveySchema } from "../contracts/gotcha-survey.js";
import type { AnalysisIssue, AnalysisResult } from "../engine/rule-engine.js";
import type { ScoreReport } from "../engine/scoring.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type { Rule, RuleConfig, RuleViolation } from "../contracts/rule.js";
import type { Category } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";
import { CATEGORIES } from "../contracts/category.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: { id: string; category: Category }): Rule {
  return {
    definition: {
      id: overrides.id,
      name: overrides.id,
      category: overrides.category,
      why: "",
      impact: "",
      fix: "",
    },
    check: () => null,
  };
}

function makeConfig(severity: Severity, score = -5): RuleConfig {
  return { severity, score, enabled: true };
}

function makeViolation(
  ruleId: string,
  nodeId: string,
  nodePath: string,
): RuleViolation {
  return { ruleId, nodeId, nodePath, message: "test", suggestion: "" };
}

function makeIssue(opts: {
  ruleId: string;
  category: Category;
  severity: Severity;
  nodeId?: string;
  nodePath?: string;
  score?: number;
}): AnalysisIssue {
  return {
    violation: makeViolation(
      opts.ruleId,
      opts.nodeId ?? "1:1",
      opts.nodePath ?? "Root > Node",
    ),
    rule: makeRule({ id: opts.ruleId, category: opts.category }),
    config: makeConfig(opts.severity, opts.score ?? -5),
    depth: 0,
    maxDepth: 5,
    calculatedScore: opts.score ?? -5,
  };
}

function makeResult(issues: AnalysisIssue[]): AnalysisResult {
  const doc: AnalysisNode = {
    id: "0:1",
    name: "Document",
    type: "DOCUMENT",
    visible: true,
  };
  const file: AnalysisFile = {
    fileKey: "test",
    name: "Test",
    lastModified: "",
    version: "1",
    document: doc,
    components: {},
    styles: {},
  };
  return {
    file,
    issues,
    failedRules: [],
    maxDepth: 5,
    nodeCount: 100,
    analyzedAt: new Date().toISOString(),
  };
}

function makeScoreReport(grade: ScoreReport["overall"]["grade"]): ScoreReport {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      {
        category: c,
        score: 50,
        maxScore: 100,
        percentage: 50,
        issueCount: 0,
        uniqueRuleCount: 0,
        weightedIssueCount: 0,
        densityScore: 100,
        diversityScore: 100,
        bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
      },
    ]),
  ) as ScoreReport["byCategory"];

  return {
    overall: { score: 50, maxScore: 100, percentage: 50, grade },
    byCategory,
    summary: {
      totalIssues: 0,
      blocking: 0,
      risk: 0,
      missingInfo: 0,
      suggestion: 0,
      nodeCount: 100,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateGotchaSurvey", () => {
  it("returns empty questions for zero issues", () => {
    const survey = generateGotchaSurvey(makeResult([]), makeScoreReport("S"));

    expect(survey.questions).toEqual([]);
    expect(survey.designGrade).toBe("S");
    expect(survey.isReadyForCodeGen).toBe(true);
  });

  it("includes only blocking and risk severity issues", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "2:2",
        nodePath: "Root > Card",
      }),
      makeIssue({
        ruleId: "raw-value",
        category: "token-management",
        severity: "missing-info",
        nodeId: "3:3",
        nodePath: "Root > Label",
      }),
      makeIssue({
        ruleId: "non-semantic-name",
        category: "semantic",
        severity: "suggestion",
        nodeId: "4:4",
        nodePath: "Root > Frame 1",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("C"),
    );

    expect(survey.questions).toHaveLength(2);
    expect(survey.questions.map((q) => q.ruleId)).toEqual([
      "no-auto-layout",
      "fixed-size-in-auto-layout",
    ]);
  });

  it("orders blocking issues before risk issues", () => {
    const issues = [
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "1:1",
        nodePath: "Root > Card",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "2:2",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "missing-size-constraint",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "3:3",
        nodePath: "Root > Banner",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.severity).toBe("blocking");
    expect(survey.questions[1]!.severity).toBe("risk");
    expect(survey.questions[2]!.severity).toBe("risk");
  });

  it("deduplicates same ruleId on sibling nodes (same parent)", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child A",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:2",
        nodePath: "Root > Section > Child B",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:3",
        nodePath: "Root > Section > Child C",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    // 3 siblings with same rule → 1 question
    expect(survey.questions).toHaveLength(1);
    expect(survey.questions[0]!.nodeId).toBe("1:1");
  });

  it("keeps separate questions for same ruleId in different parents", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section A > Child",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "2:1",
        nodePath: "Root > Section B > Child",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    expect(survey.questions).toHaveLength(2);
  });

  it("keeps separate questions for different ruleIds on same node", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child",
      }),
      makeIssue({
        ruleId: "non-layout-container",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    expect(survey.questions).toHaveLength(2);
    expect(survey.questions.map((q) => q.ruleId)).toEqual([
      "no-auto-layout",
      "non-layout-container",
    ]);
  });

  it("extracts nodeName from the last segment of nodePath", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Hero Banner",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.nodeName).toBe("Hero Banner");
    expect(survey.questions[0]!.question).toContain("Hero Banner");
  });

  it("substitutes {nodeName} in question text", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > MyFrame",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.question).toBe(
      'Frame "MyFrame" has no Auto Layout. How should this area be laid out?',
    );
  });

  it("output passes GotchaSurveySchema validation", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "2:2",
        nodePath: "Root > Card",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("C"),
    );

    const result = GotchaSurveySchema.safeParse(survey);
    expect(result.success).toBe(true);
  });

  it("sets isReadyForCodeGen based on grade", () => {
    const empty = makeResult([]);

    const sGrade = generateGotchaSurvey(empty, makeScoreReport("S"));
    expect(sGrade.isReadyForCodeGen).toBe(true);

    const aGrade = generateGotchaSurvey(empty, makeScoreReport("A"));
    expect(aGrade.isReadyForCodeGen).toBe(true);

    const cGrade = generateGotchaSurvey(empty, makeScoreReport("C"));
    expect(cGrade.isReadyForCodeGen).toBe(false);

    const fGrade = generateGotchaSurvey(empty, makeScoreReport("F"));
    expect(fGrade.isReadyForCodeGen).toBe(false);
  });
});
