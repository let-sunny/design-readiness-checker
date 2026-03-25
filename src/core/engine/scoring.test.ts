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
  return { file, issues, maxDepth: 5, nodeCount, analyzedAt: new Date().toISOString() };
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
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
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

  it("applies severity density weights (blocking=3.0 > risk=2.0 > missing-info=1.0 > suggestion=0.5)", () => {
    // Single blocking issue on 100 nodes
    const blocking = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ], 100));

    // Single suggestion issue on 100 nodes
    const suggestion = calculateScores(makeResult([
      makeIssue({ ruleId: "numeric-suffix-name", category: "naming", severity: "suggestion" }),
    ], 100));

    // Blocking issue should reduce layout category score more than suggestion reduces naming
    expect(blocking.byCategory.layout.densityScore).toBeLessThan(
      suggestion.byCategory.naming.densityScore
    );
  });

  it("density score decreases as weighted issue count increases relative to node count", () => {
    const few = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ], 100));

    const many = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ], 100));

    expect(many.byCategory.layout.densityScore).toBeLessThan(
      few.byCategory.layout.densityScore
    );
  });

  it("diversity score penalizes more unique rules being triggered", () => {
    // 3 issues from 1 rule (low diversity = high diversity score)
    const concentrated = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "risk" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "risk" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "risk" }),
    ], 100));

    // 3 issues from 3 different rules (high diversity = low diversity score)
    const spread = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "risk" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
      makeIssue({ ruleId: "deep-nesting", category: "layout", severity: "risk" }),
    ], 100));

    expect(concentrated.byCategory.layout.diversityScore).toBeGreaterThan(
      spread.byCategory.layout.diversityScore
    );
  });

  it("combined score = density * 0.7 + diversity * 0.3", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues, 100));
    const layout = scores.byCategory.layout;

    const expected = Math.round(layout.densityScore * 0.7 + layout.diversityScore * 0.3);
    // Floor is 5, so clamp
    const clamped = Math.max(5, Math.min(100, expected));
    expect(layout.percentage).toBe(clamped);
  });

  it("score never goes below SCORE_FLOOR (5) when issues exist", () => {
    // To hit the floor, we need both density→0 AND diversity→0
    // Use many issues from many different rules to maximize both penalties
    const layoutRules = [
      "no-auto-layout", "group-usage", "deep-nesting", "fixed-size-in-auto-layout",
      "missing-responsive-behavior", "absolute-position-in-auto-layout",
      "fixed-width-in-responsive-context", "missing-min-width", "missing-max-width",
      "overflow-hidden-abuse", "inconsistent-sibling-layout-direction",
    ] as const;

    const issues: AnalysisIssue[] = [];
    for (const ruleId of layoutRules) {
      for (let i = 0; i < 50; i++) {
        issues.push(makeIssue({ ruleId, category: "layout", severity: "blocking" }));
      }
    }

    const scores = calculateScores(makeResult(issues, 10));

    // With density near 0 and diversity near 0, combined should clamp to floor
    expect(scores.byCategory.layout.percentage).toBe(5);
  });

  it("categories without issues get 100%", () => {
    // Issues only in layout category
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ]));

    expect(scores.byCategory.token.percentage).toBe(100);
    expect(scores.byCategory.component.percentage).toBe(100);
    expect(scores.byCategory.naming.percentage).toBe(100);
    expect(scores.byCategory["ai-readability"].percentage).toBe(100);
    expect(scores.byCategory["handoff-risk"].percentage).toBe(100);
  });

  it("overall score is weighted average of all 6 categories", () => {
    // With equal weights (all 1.0), overall = average of all category percentages
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ], 100));

    const categoryPercentages = [
      scores.byCategory.layout.percentage,
      scores.byCategory.token.percentage,
      scores.byCategory.component.percentage,
      scores.byCategory.naming.percentage,
      scores.byCategory["ai-readability"].percentage,
      scores.byCategory["handoff-risk"].percentage,
    ];
    const expectedOverall = Math.round(
      categoryPercentages.reduce((a, b) => a + b, 0) / 6
    );
    expect(scores.overall.percentage).toBe(expectedOverall);
  });

  it("handles nodeCount = 0 gracefully (no division by zero)", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ], 0));

    // With nodeCount 0, density stays at 100 (no density penalty applied)
    // But diversity still applies since there are issues
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
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    // 2 unique rules in layout, despite 3 issues
    expect(scores.byCategory.layout.uniqueRuleCount).toBe(2);
    expect(scores.byCategory.layout.issueCount).toBe(3);
  });

  it("bySeverity counts are accurate per category", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
      makeIssue({ ruleId: "group-usage", category: "layout", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.byCategory.layout.bySeverity.blocking).toBe(1);
    expect(scores.byCategory.layout.bySeverity.risk).toBe(2);
    expect(scores.byCategory.layout.bySeverity["missing-info"]).toBe(0);
    expect(scores.byCategory.layout.bySeverity.suggestion).toBe(0);
  });
});

// ─── Grade boundaries ─────────────────────────────────────────────────────────

describe("calculateGrade (via calculateScores)", () => {
  it("100% -> S", () => {
    const scores = calculateScores(makeResult([], 100));
    expect(scores.overall.grade).toBe("S");
  });

  it("score < 50% -> F", () => {
    // Many blocking issues in all categories to push overall below 50%
    const issues: AnalysisIssue[] = [];
    const categories: Category[] = ["layout", "token", "component", "naming", "ai-readability", "handoff-risk"];
    const rulesPerCat: Record<Category, string[]> = {
      layout: ["no-auto-layout", "group-usage", "deep-nesting", "fixed-size-in-auto-layout", "missing-responsive-behavior"],
      token: ["raw-color", "raw-font", "inconsistent-spacing", "magic-number-spacing", "raw-shadow"],
      component: ["missing-component", "detached-instance", "variant-not-used", "component-property-unused", "single-use-component"],
      naming: ["default-name", "non-semantic-name", "inconsistent-naming-convention", "numeric-suffix-name", "too-long-name"],
      "ai-readability": ["ambiguous-structure", "z-index-dependent-layout", "missing-layout-hint", "invisible-layer", "empty-frame"],
      "handoff-risk": ["hardcode-risk", "text-truncation-unhandled", "image-no-placeholder", "prototype-link-in-design", "no-dev-status"],
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

  it("includes all 6 categories", () => {
    const scores = calculateScores(makeResult([]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("layout:");
    expect(summary).toContain("token:");
    expect(summary).toContain("component:");
    expect(summary).toContain("naming:");
    expect(summary).toContain("ai-readability:");
    expect(summary).toContain("handoff-risk:");
  });

  it("includes severity breakdown", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
    ]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("Blocking: 1");
    expect(summary).toContain("Total: 1");
  });
});

// ─── getCategoryLabel / getSeverityLabel ───────────────────────────────────────

describe("getCategoryLabel", () => {
  it("returns correct labels for all categories", () => {
    expect(getCategoryLabel("layout")).toBe("Layout");
    expect(getCategoryLabel("token")).toBe("Design Token");
    expect(getCategoryLabel("component")).toBe("Component");
    expect(getCategoryLabel("naming")).toBe("Naming");
    expect(getCategoryLabel("ai-readability")).toBe("AI Readability");
    expect(getCategoryLabel("handoff-risk")).toBe("Handoff Risk");
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
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(json.fileName).toBe("TestFile");
    expect(json.nodeCount).toBe(100);
    expect(json.issueCount).toBe(3);
    expect(json.version).toBeDefined();
    expect(json.scores).toBeDefined();
    expect(json.summary).toBeDefined();
    expect(typeof json.summary).toBe("string");
  });

  it("aggregates issuesByRule correctly", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "layout", severity: "blocking" }),
      makeIssue({ ruleId: "raw-color", category: "token", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issuesByRule = json.issuesByRule as Record<string, number>;

    expect(issuesByRule["no-auto-layout"]).toBe(2);
    expect(issuesByRule["raw-color"]).toBe(1);
  });
});
