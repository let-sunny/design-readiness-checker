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
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk" }),
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
      makeIssue({ ruleId: "non-semantic-name", category: "minor", severity: "suggestion" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.summary.blocking).toBe(1);
    expect(scores.summary.risk).toBe(1);
    expect(scores.summary.missingInfo).toBe(1);
    expect(scores.summary.suggestion).toBe(1);
    expect(scores.summary.totalIssues).toBe(4);
  });

  it("uses calculatedScore for density: higher score = more density impact", () => {
    const heavyIssue = makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 });
    heavyIssue.calculatedScore = -15; // Simulate depthWeight effect

    const lightIssue = makeIssue({ ruleId: "non-semantic-name", category: "minor", severity: "suggestion", score: -1 });
    lightIssue.calculatedScore = -1;

    const heavy = calculateScores(makeResult([heavyIssue], 100));
    const light = calculateScores(makeResult([lightIssue], 100));

    expect(heavy.byCategory["pixel-critical"].weightedIssueCount).toBe(15);
    expect(light.byCategory["minor"].weightedIssueCount).toBe(1);
  });

  it("differentiates rules within the same severity by score", () => {
    const highScoreIssue = makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 });
    highScoreIssue.calculatedScore = -15;

    const lowScoreIssue = makeIssue({ ruleId: "absolute-position-in-auto-layout", category: "pixel-critical", severity: "blocking", score: -3 });
    lowScoreIssue.calculatedScore = -5;

    const highScore = calculateScores(makeResult([highScoreIssue], 100));
    const lowScore = calculateScores(makeResult([lowScoreIssue], 100));

    expect(highScore.byCategory["pixel-critical"].densityScore).toBeLessThan(
      lowScore.byCategory["pixel-critical"].densityScore
    );
    expect(highScore.byCategory["pixel-critical"].weightedIssueCount).toBe(15);
    expect(lowScore.byCategory["pixel-critical"].weightedIssueCount).toBe(5);
  });

  it("density score decreases as weighted issue count increases relative to node count", () => {
    const few = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ], 100));

    const many = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ], 100));

    expect(many.byCategory["pixel-critical"].densityScore).toBeLessThan(
      few.byCategory["pixel-critical"].densityScore
    );
  });

  it("diversity score penalizes more unique rules being triggered", () => {
    const concentrated = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "risk", score: -5 }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "risk", score: -5 }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "risk", score: -5 }),
    ], 100));

    const spread = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "risk", score: -5 }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk", score: -5 }),
      makeIssue({ ruleId: "absolute-position-in-auto-layout", category: "pixel-critical", severity: "risk", score: -5 }),
    ], 100));

    expect(concentrated.byCategory["pixel-critical"].diversityScore).toBeGreaterThan(
      spread.byCategory["pixel-critical"].diversityScore
    );
  });

  it("diversity weights triggered rules by score severity", () => {
    const heavyRule = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
    ], 100));

    const lightRule = calculateScores(makeResult([
      makeIssue({ ruleId: "non-semantic-name", category: "minor", severity: "suggestion", score: -1 }),
    ], 100));

    expect(heavyRule.byCategory["pixel-critical"].diversityScore).toBeLessThan(
      lightRule.byCategory["minor"].diversityScore
    );
  });

  it("low-severity rules have minimal diversity impact (intentional)", () => {
    const lowSeverity = calculateScores(makeResult([
      makeIssue({ ruleId: "non-semantic-name", category: "minor", severity: "suggestion", score: -1 }),
    ], 100));

    const highSeverity = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
    ], 100));

    expect(lowSeverity.byCategory["minor"].diversityScore).toBeGreaterThan(50);
    expect(highSeverity.byCategory["pixel-critical"].diversityScore).toBeLessThan(80);
  });

  it("combined score = density * 0.7 + diversity * 0.3", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues, 100));
    const pixelCritical = scores.byCategory["pixel-critical"];

    const expected = Math.round(pixelCritical.densityScore * 0.7 + pixelCritical.diversityScore * 0.3);
    const clamped = Math.max(5, Math.min(100, expected));
    expect(pixelCritical.percentage).toBe(clamped);
  });

  it("score never goes below SCORE_FLOOR (5) when issues exist", () => {
    const pixelCriticalRules = [
      "no-auto-layout", "non-layout-container", "absolute-position-in-auto-layout",
    ] as const;

    const issues: AnalysisIssue[] = [];
    for (const ruleId of pixelCriticalRules) {
      for (let i = 0; i < 200; i++) {
        issues.push(makeIssue({ ruleId, category: "pixel-critical", severity: "blocking", score: -10 }));
      }
    }

    const scores = calculateScores(makeResult(issues, 5));
    expect(scores.byCategory["pixel-critical"].percentage).toBe(5);
  });

  it("categories without issues get 100%", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ]));

    expect(scores.byCategory["token-management"].percentage).toBe(100);
    expect(scores.byCategory["code-quality"].percentage).toBe(100);
    expect(scores.byCategory["interaction"].percentage).toBe(100);
    expect(scores.byCategory["minor"].percentage).toBe(100);
    expect(scores.byCategory["responsive-critical"].percentage).toBe(100);
  });

  it("overall score is weighted average of all 5 categories", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ], 100));

    const categoryPercentages = [
      scores.byCategory["pixel-critical"].percentage,
      scores.byCategory["responsive-critical"].percentage,
      scores.byCategory["code-quality"].percentage,
      scores.byCategory["token-management"].percentage,
      scores.byCategory["interaction"].percentage,
      scores.byCategory["minor"].percentage,
    ];
    const expectedOverall = Math.round(
      categoryPercentages.reduce((a, b) => a + b, 0) / 6
    );
    expect(scores.overall.percentage).toBe(expectedOverall);
  });

  it("handles nodeCount = 0 gracefully (no division by zero)", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
    ], 0));

    expect(scores.byCategory["token-management"].densityScore).toBe(100);
    expect(scores.byCategory["token-management"].percentage).toBeLessThan(100);
    expect(Number.isFinite(scores.overall.percentage)).toBe(true);
  });

  it("handles nodeCount = 1 without edge case issues", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
    ], 1));

    expect(Number.isFinite(scores.overall.percentage)).toBe(true);
    expect(scores.overall.percentage).toBeGreaterThanOrEqual(0);
    expect(scores.overall.percentage).toBeLessThanOrEqual(100);
  });

  it("tracks uniqueRuleCount per category", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.byCategory["pixel-critical"].uniqueRuleCount).toBe(2);
    expect(scores.byCategory["pixel-critical"].issueCount).toBe(3);
  });

  it("bySeverity counts are accurate per category", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk" }),
      makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.byCategory["pixel-critical"].bySeverity.blocking).toBe(1);
    expect(scores.byCategory["pixel-critical"].bySeverity.risk).toBe(2);
    expect(scores.byCategory["pixel-critical"].bySeverity["missing-info"]).toBe(0);
    expect(scores.byCategory["pixel-critical"].bySeverity.suggestion).toBe(0);
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
    const categories: Category[] = ["pixel-critical", "responsive-critical", "code-quality", "token-management", "interaction", "minor"];
    const rulesPerCat: Record<Category, string[]> = {
      "pixel-critical": ["no-auto-layout", "non-layout-container", "absolute-position-in-auto-layout"],
      "responsive-critical": ["fixed-size-in-auto-layout", "missing-size-constraint"],
      "code-quality": ["missing-component", "detached-instance", "variant-structure-mismatch", "deep-nesting"],
      "token-management": ["raw-value", "irregular-spacing"],
      "interaction": ["missing-interaction-state", "missing-prototype"],
      "minor": ["non-standard-naming", "non-semantic-name", "inconsistent-naming-convention"],
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

    expect(summary).toContain("pixel-critical:");
    expect(summary).toContain("responsive-critical:");
    expect(summary).toContain("code-quality:");
    expect(summary).toContain("token-management:");
    expect(summary).toContain("minor:");
  });

  it("includes severity breakdown", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("Blocking: 1");
    expect(summary).toContain("Total: 1");
  });
});

// ─── getCategoryLabel / getSeverityLabel ───────────────────────────────────────

describe("getCategoryLabel", () => {
  it("returns correct labels for all categories", () => {
    expect(getCategoryLabel("pixel-critical")).toBe("Pixel Critical");
    expect(getCategoryLabel("responsive-critical")).toBe("Responsive Critical");
    expect(getCategoryLabel("code-quality")).toBe("Code Quality");
    expect(getCategoryLabel("token-management")).toBe("Token Management");
    expect(getCategoryLabel("minor")).toBe("Minor");
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
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
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
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issuesByRule = json.issuesByRule as Record<string, number>;

    expect(issuesByRule["no-auto-layout"]).toBe(2);
    expect(issuesByRule["raw-value"]).toBe(1);
  });

  it("includes detailed issues list with severity and node info", () => {
    const tokenIssue = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    tokenIssue.violation.subType = "color";

    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      tokenIssue,
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<{ ruleId: string; subType?: string; severity: string; nodeId: string; nodePath: string; message: string }>;

    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({
      ruleId: "no-auto-layout",
      severity: "blocking",
      nodeId: expect.any(String),
      nodePath: expect.any(String),
      message: expect.any(String),
    });
    expect(issues[0]!["subType"]).toBeUndefined();
    expect(issues[1]).toMatchObject({
      ruleId: "raw-value",
      subType: "color",
      severity: "missing-info",
    });
  });

  it("omits subType when it is an empty string", () => {
    const emptySubTypeIssue = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    emptySubTypeIssue.violation.subType = "";

    const result = makeResult([emptySubTypeIssue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<{ ruleId: string; subType?: string }>;

    expect(issues).toHaveLength(1);
    expect(issues[0]!["subType"]).toBeUndefined();
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
