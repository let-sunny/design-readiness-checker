import { generateGotchaSurvey } from "../core/gotcha/survey-generator.js";
import { GotchaSurveySchema } from "../core/contracts/gotcha-survey.js";
import type { AnalysisResult, AnalysisIssue } from "../core/engine/rule-engine.js";
import type { ScoreReport } from "../core/engine/scoring.js";
import type { AnalysisFile, AnalysisNode } from "../core/contracts/figma-node.js";
import type { Rule, RuleConfig, RuleViolation } from "../core/contracts/rule.js";
import type { Category } from "../core/contracts/category.js";
import type { Severity } from "../core/contracts/severity.js";
import { CATEGORIES } from "../core/contracts/category.js";

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
}): AnalysisIssue {
  return {
    violation: makeViolation(
      opts.ruleId,
      opts.nodeId ?? "1:1",
      opts.nodePath ?? "Root > Node",
    ),
    rule: makeRule({ id: opts.ruleId, category: opts.category }),
    config: makeConfig(opts.severity),
    depth: 0,
    maxDepth: 5,
    calculatedScore: -5,
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

describe("gotcha-survey MCP tool pipeline", () => {
  it("returns valid GotchaSurvey JSON for designs with issues", () => {
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

    const survey = generateGotchaSurvey(makeResult(issues), makeScoreReport("C"));

    const parsed = GotchaSurveySchema.safeParse(survey);
    expect(parsed.success).toBe(true);
    expect(survey.designGrade).toBe("C");
    expect(survey.isReadyForCodeGen).toBe(false);
    expect(survey.questions.length).toBeGreaterThan(0);
  });

  it("returns empty questions when isReadyForCodeGen is true", () => {
    const survey = generateGotchaSurvey(makeResult([]), makeScoreReport("S"));

    expect(survey.isReadyForCodeGen).toBe(true);
    expect(survey.questions).toEqual([]);
  });

  it("survey output can be serialized to JSON text (as MCP tool returns)", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Frame",
      }),
    ];

    const survey = generateGotchaSurvey(makeResult(issues), makeScoreReport("D"));
    const jsonText = JSON.stringify(survey, null, 2);
    const roundTripped = JSON.parse(jsonText) as unknown;

    const parsed = GotchaSurveySchema.safeParse(roundTripped);
    expect(parsed.success).toBe(true);
  });
});
