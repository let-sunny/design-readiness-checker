import { calculateScores, formatScoreSummary, gradeToClassName, getCategoryLabel, getSeverityLabel, buildResultJson } from "./scoring.js";
import type { AnalysisIssue, AnalysisResult } from "./rule-engine.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type { Rule, RuleConfig, RuleViolation } from "../contracts/rule.js";
import type { Category } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";

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

function makeViolation(ruleId: string): RuleViolation {
  return { ruleId, nodeId: "1:1", nodePath: "Root > Node", message: "test" };
}

function makeIssue(opts: {
  ruleId: string;
  category: Category;
  severity: Severity;
  score?: number;
}): AnalysisIssue {
  return {
    violation: makeViolation(opts.ruleId),
    rule: makeRule({ id: opts.ruleId, category: opts.category }),
    config: makeConfig(opts.severity, opts.score ?? -5),
    depth: 0,
    maxDepth: 5,
    calculatedScore: opts.score ?? -5,
  };
}

function makeResult(issues: AnalysisIssue[], nodeCount = 100): AnalysisResult {
  const doc: AnalysisNode = { id: "0:1", name: "Document", type: "DOCUMENT", visible: true };
  const file: AnalysisFile = {
    fileKey: "test",
    name: "Test",
    lastModified: "",
    version: "1",
    document: doc,
    components: {},
    styles: {},
  };
  return { file, issues, failedRules: [], maxDepth: 5, nodeCount, analyzedAt: new Date().toISOString() };
}

// ─── calculateScores ──────────────────────────────────────────────────────────

describe("calculateScores", () => {
  it("returns 100% for zero issues", () => {
    const scores = calculateScores(makeResult([]));

    expect(scores.overall.percentage).toBe(100);
    expect(scores.overall.grade).toBe("S");
    expect(scores.summary.totalIssues).toBe(0);
  });

  it("counts issues by severity correctly", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
      makeIssue({ ruleId: "numeric-suffix-name", category: "naming", severity: "suggestion" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.summary.blocking).toBe(1);
    expect(scores.summary.risk).toBe(1);
    expect(scores.summary.missingInfo).toBe(1);
    expect(scores.summary.suggestion).toBe(1);
    expect(scores.summary.totalIssues).toBe(4);
  });

  it("uses calculatedScore for density: higher score = more density impact", () => {
    const heavy = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking", score: -10 }),
    ], 100));

    const light = calculateScores(makeResult([
      makeIssue({ ruleId: "unnecessary-node", category: "structure", severity: "suggestion", score: -2 }),
    ], 100));

    expect(heavy.byCategory.structure.densityScore).toBeLessThan(
      light.byCategory.structure.densityScore
    );
  });

  it("differentiates rules within the same severity by score", () => {
    const highScore = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking", score: -10 }),
    ], 100));

    const lowScore = calculateScores(makeResult([
      makeIssue({ ruleId: "absolute-position-in-auto-layout", category: "structure", severity: "blocking", score: -3 }),
    ], 100));

    expect(highScore.byCategory.structure.densityScore).toBeLessThan(
      lowScore.byCategory.structure.densityScore
    );
    expect(highScore.byCategory.structure.weightedIssueCount).toBe(10);
    expect(lowScore.byCategory.structure.weightedIssueCount).toBe(3);
  });

  it("density score decreases as weighted issue count increases relative to node count", () => {
    const few = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
    ], 100));

    const many = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
    ], 100));

    expect(many.byCategory.structure.densityScore).toBeLessThan(
      few.byCategory.structure.densityScore
    );
  });

  it("diversity score penalizes more unique rules being triggered", () => {
    const concentrated = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "risk" }),
    ], 100));

    const spread = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "deep-nesting", category: "structure", severity: "risk" }),
    ], 100));

    expect(concentrated.byCategory.structure.diversityScore).toBeGreaterThan(
      spread.byCategory.structure.diversityScore
    );
  });

  it("combined score = density * 0.7 + diversity * 0.3", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues, 100));
    const structure = scores.byCategory.structure;

    const expected = Math.round(structure.densityScore * 0.7 + structure.diversityScore * 0.3);
    const clamped = Math.max(5, Math.min(100, expected));
    expect(structure.percentage).toBe(clamped);
  });

  it("score never goes below SCORE_FLOOR (5) when issues exist", () => {
    const structureRules = [
      "no-auto-layout", "group-usage", "deep-nesting", "fixed-size-in-auto-layout",
      "missing-responsive-behavior", "absolute-position-in-auto-layout",
      "missing-size-constraint", "z-index-dependent-layout", "unnecessary-node",
    ] as const;

    const issues: AnalysisIssue[] = [];
    for (const ruleId of structureRules) {
      for (let i = 0; i < 50; i++) {
        issues.push(makeIssue({ ruleId, category: "structure", severity: "blocking" }));
      }
    }

    const scores = calculateScores(makeResult(issues, 10));
    expect(scores.byCategory.structure.percentage).toBe(5);
  });

  it("categories without issues get 100%", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
    ]));

    expect(scores.byCategory.token.percentage).toBe(100);
    expect(scores.byCategory.component.percentage).toBe(100);
    expect(scores.byCategory.naming.percentage).toBe(100);
    expect(scores.byCategory.behavior.percentage).toBe(100);
  });

  it("overall score is weighted average of all 5 categories", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
    ], 100));

    const categoryPercentages = [
      scores.byCategory.structure.percentage,
      scores.byCategory.token.percentage,
      scores.byCategory.component.percentage,
      scores.byCategory.naming.percentage,
      scores.byCategory.behavior.percentage,
    ];
    const expectedOverall = Math.round(
      categoryPercentages.reduce((a, b) => a + b, 0) / 5
    );
    expect(scores.overall.percentage).toBe(expectedOverall);
  });

  it("handles nodeCount = 0 gracefully (no division by zero)", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ], 0));

    expect(scores.byCategory.token.densityScore).toBe(100);
    expect(scores.byCategory.token.percentage).toBeLessThan(100);
    expect(Number.isFinite(scores.overall.percentage)).toBe(true);
  });

  it("handles nodeCount = 1 without edge case issues", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ], 1));

    expect(Number.isFinite(scores.overall.percentage)).toBe(true);
    expect(scores.overall.percentage).toBeGreaterThanOrEqual(0);
    expect(scores.overall.percentage).toBeLessThanOrEqual(100);
  });

  it("tracks uniqueRuleCount per category", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.byCategory.structure.uniqueRuleCount).toBe(2);
    expect(scores.byCategory.structure.issueCount).toBe(3);
  });

  it("bySeverity counts are accurate per category", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
      makeIssue({ ruleId: "group-usage", category: "structure", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.byCategory.structure.bySeverity.blocking).toBe(1);
    expect(scores.byCategory.structure.bySeverity.risk).toBe(2);
    expect(scores.byCategory.structure.bySeverity["missing-info"]).toBe(0);
    expect(scores.byCategory.structure.bySeverity.suggestion).toBe(0);
  });
});

// ─── Grade boundaries ─────────────────────────────────────────────────────────

describe("calculateGrade (via calculateScores)", () => {
  it("100% -> S", () => {
    const scores = calculateScores(makeResult([], 100));
    expect(scores.overall.grade).toBe("S");
  });

  it("score < 50% -> F", () => {
    const issues: AnalysisIssue[] = [];
    const categories: Category[] = ["structure", "token", "component", "naming", "behavior"];
    const rulesPerCat: Record<Category, string[]> = {
      structure: ["no-auto-layout", "group-usage", "deep-nesting", "fixed-size-in-auto-layout", "missing-responsive-behavior", "absolute-position-in-auto-layout", "missing-size-constraint", "z-index-dependent-layout", "unnecessary-node"],
      token: ["raw-color", "raw-font", "inconsistent-spacing", "magic-number-spacing", "raw-shadow", "raw-opacity", "multiple-fill-colors"],
      component: ["missing-component", "detached-instance", "missing-component-description", "variant-structure-mismatch"],
      naming: ["default-name", "non-semantic-name", "inconsistent-naming-convention", "numeric-suffix-name", "too-long-name"],
      behavior: ["text-truncation-unhandled", "prototype-link-in-design", "overflow-behavior-unknown", "wrap-behavior-unknown"],
    };

    for (const cat of categories) {
      const rules = rulesPerCat[cat];
      if (!rules) continue;
      for (const ruleId of rules) {
        for (let i = 0; i < 20; i++) {
          issues.push(makeIssue({ ruleId, category: cat, severity: "blocking" }));
        }
      }
    }

    const scores = calculateScores(makeResult(issues, 10));
    expect(scores.overall.grade).toBe("F");
    expect(scores.overall.percentage).toBeLessThan(50);
  });

  it("gradeToClassName converts + to plus", () => {
    expect(gradeToClassName("A+")).toBe("Aplus");
    expect(gradeToClassName("B+")).toBe("Bplus");
    expect(gradeToClassName("C+")).toBe("Cplus");
    expect(gradeToClassName("S")).toBe("S");
    expect(gradeToClassName("F")).toBe("F");
  });
});

// ─── formatScoreSummary ───────────────────────────────────────────────────────

describe("formatScoreSummary", () => {
  it("includes overall grade and percentage", () => {
    const scores = calculateScores(makeResult([]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("Overall: S (100%)");
  });

  it("includes all 5 categories", () => {
    const scores = calculateScores(makeResult([]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("structure:");
    expect(summary).toContain("token:");
    expect(summary).toContain("component:");
    expect(summary).toContain("naming:");
    expect(summary).toContain("behavior:");
  });

  it("includes severity breakdown", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
    ]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("Blocking: 1");
    expect(summary).toContain("Total: 1");
  });
});

// ─── getCategoryLabel / getSeverityLabel ───────────────────────────────────────

describe("getCategoryLabel", () => {
  it("returns correct labels for all categories", () => {
    expect(getCategoryLabel("structure")).toBe("Structure");
    expect(getCategoryLabel("token")).toBe("Design Token");
    expect(getCategoryLabel("component")).toBe("Component");
    expect(getCategoryLabel("naming")).toBe("Naming");
    expect(getCategoryLabel("behavior")).toBe("Behavior");
  });
});

describe("getSeverityLabel", () => {
  it("returns correct labels for all severities", () => {
    expect(getSeverityLabel("blocking")).toBe("Blocking");
    expect(getSeverityLabel("risk")).toBe("Risk");
    expect(getSeverityLabel("missing-info")).toBe("Missing Info");
    expect(getSeverityLabel("suggestion")).toBe("Suggestion");
  });
});

// ─── buildResultJson ──────────────────────────────────────────────────────────

describe("buildResultJson", () => {
  it("includes all expected fields", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(json.fileName).toBe("TestFile");
    expect(json.nodeCount).toBe(100);
    expect(json.issueCount).toBe(3);
    expect(json.version).toBeDefined();
    expect(json.analyzedAt).toBeDefined();
    expect(json.scores).toBeDefined();
    expect(json.summary).toBeDefined();
    expect(typeof json.summary).toBe("string");
  });

  it("aggregates issuesByRule correctly", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issuesByRule = json.issuesByRule as Record<string, number>;

    expect(issuesByRule["no-auto-layout"]).toBe(2);
    expect(issuesByRule["raw-color"]).toBe(1);
  });

  it("includes detailed issues list with severity and node info", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "structure", severity: "blocking" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<{ ruleId: string; severity: string; nodeId: string; nodePath: string; message: string }>;

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      ruleId: "no-auto-layout",
      severity: "blocking",
      nodeId: expect.any(String),
      nodePath: expect.any(String),
      message: expect.any(String),
    });
    expect(issues[1]).toMatchObject({
      ruleId: "raw-color",
      severity: "missing-info",
    });
  });

  it("includes fileKey when provided", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);

    const withKey = buildResultJson("TestFile", result, scores, { fileKey: "abc123" });
    expect(withKey.fileKey).toBe("abc123");

    const withoutKey = buildResultJson("TestFile", result, scores);
    expect(withoutKey.fileKey).toBeUndefined();
  });
});
