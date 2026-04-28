import { calculateScores, formatScoreSummary, gradeToClassName, getCategoryLabel, getSeverityLabel, buildResultJson, isReadyForCodeGen, formatRoundtripOptOutHintLine, ROUNDTRIP_OPT_OUT_HINT, GRADE_ORDER, DEFAULT_CODEGEN_READY_MIN_GRADE } from "./scoring.js";
import type { Grade } from "./scoring.js";
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

function makeResult(
  issues: AnalysisIssue[],
  nodeCount = 100,
  overrides?: Partial<AnalysisResult>,
): AnalysisResult {
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
  return {
    file,
    issues,
    failedRules: [],
    maxDepth: 5,
    nodeCount,
    analyzedAt: new Date().toISOString(),
    scope: "page",
    ...overrides,
  };
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
      makeIssue({ ruleId: "non-semantic-name", category: "semantic", severity: "suggestion" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.summary.blocking).toBe(1);
    expect(scores.summary.risk).toBe(1);
    expect(scores.summary.missingInfo).toBe(1);
    expect(scores.summary.suggestion).toBe(1);
    expect(scores.summary.totalIssues).toBe(4);
  });

  it("uses base rule score with sqrt damping for density (#226)", () => {
    const heavyIssue = makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 });
    heavyIssue.calculatedScore = -15; // calculatedScore ignored for density — uses base score (-10), so |−10| × sqrt(1) = 10

    const lightIssue = makeIssue({ ruleId: "non-semantic-name", category: "semantic", severity: "suggestion", score: -1 });
    lightIssue.calculatedScore = -1;

    const heavy = calculateScores(makeResult([heavyIssue], 100));
    const light = calculateScores(makeResult([lightIssue], 100));

    // sqrt(1) = 1, so 1 issue = base score directly
    expect(heavy.byCategory["pixel-critical"].weightedIssueCount).toBe(10);
    expect(light.byCategory["semantic"].weightedIssueCount).toBe(1);
  });

  it("differentiates rules within the same severity by base score", () => {
    const highScoreIssue = makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 });
    const lowScoreIssue = makeIssue({ ruleId: "absolute-position-in-auto-layout", category: "pixel-critical", severity: "blocking", score: -3 });

    const highScore = calculateScores(makeResult([highScoreIssue], 100));
    const lowScore = calculateScores(makeResult([lowScoreIssue], 100));

    expect(highScore.byCategory["pixel-critical"].densityScore).toBeLessThan(
      lowScore.byCategory["pixel-critical"].densityScore
    );
    // sqrt(1) = 1, so single issue = base score
    expect(highScore.byCategory["pixel-critical"].weightedIssueCount).toBe(10);
    expect(lowScore.byCategory["pixel-critical"].weightedIssueCount).toBe(3);
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
    // Verify sqrt damping: 5 issues of score -5 → 5 × sqrt(5) ≈ 11.18
    expect(many.byCategory["pixel-critical"].weightedIssueCount).toBeCloseTo(5 * Math.sqrt(5), 1);
  });

  it("applies sqrt damping independently per rule", () => {
    const issues = [
      ...Array.from({ length: 4 }, () => makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -5 })),
      ...Array.from({ length: 9 }, () => makeIssue({ ruleId: "non-layout-container", category: "pixel-critical", severity: "risk", score: -3 })),
    ];
    const scores = calculateScores(makeResult(issues, 100));
    // 5×sqrt(4) + 3×sqrt(9) = 10 + 9 = 19
    expect(scores.byCategory["pixel-critical"].weightedIssueCount).toBeCloseTo(19, 1);
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
      makeIssue({ ruleId: "non-semantic-name", category: "semantic", severity: "suggestion", score: -1 }),
    ], 100));

    expect(heavyRule.byCategory["pixel-critical"].diversityScore).toBeLessThan(
      lightRule.byCategory["semantic"].diversityScore
    );
  });

  it("low-severity rules have minimal diversity impact (intentional)", () => {
    const lowSeverity = calculateScores(makeResult([
      makeIssue({ ruleId: "non-semantic-name", category: "semantic", severity: "suggestion", score: -1 }),
    ], 100));

    const highSeverity = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
    ], 100));

    expect(lowSeverity.byCategory["semantic"].diversityScore).toBeGreaterThan(50);
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
    expect(scores.byCategory["semantic"].percentage).toBe(100);
    expect(scores.byCategory["responsive-critical"].percentage).toBe(100);
  });

  it("overall score is simple average of all categories", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ], 100));

    const categories = Object.keys(scores.byCategory) as Category[];
    let sum = 0;
    for (const cat of categories) {
      sum += scores.byCategory[cat].percentage;
    }
    const expectedOverall = Math.round(sum / categories.length);
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

  it("acknowledged issues contribute half weight to density (#371)", () => {
    const baseIssue = (): AnalysisIssue =>
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 });

    const allUnack = calculateScores(makeResult([baseIssue(), baseIssue(), baseIssue(), baseIssue()], 100));
    // 4 issues × 1.0 weight each → sqrt(4) = 2 → score 10 × 2 = 20
    expect(allUnack.byCategory["pixel-critical"].weightedIssueCount).toBeCloseTo(20, 1);

    const ackOne = baseIssue();
    ackOne.acknowledged = true;
    const ackTwo = baseIssue();
    ackTwo.acknowledged = true;
    const allAck = calculateScores(makeResult([ackOne, ackTwo, baseIssue(), baseIssue()], 100));
    // 2 acknowledged × 0.5 + 2 unack × 1.0 = 3.0 → sqrt(3) → score 10 × sqrt(3) ≈ 17.32
    expect(allAck.byCategory["pixel-critical"].weightedIssueCount).toBeCloseTo(10 * Math.sqrt(3), 1);
    // Density score reflects the lighter weight — must be strictly higher
    expect(allAck.byCategory["pixel-critical"].densityScore).toBeGreaterThan(
      allUnack.byCategory["pixel-critical"].densityScore
    );
  });

  it("acknowledged issues are counted in summary.totalIssues and summary.acknowledgedCount (#371)", () => {
    const ack = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    ack.acknowledged = true;
    const issues = [
      ack,
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ];
    const scores = calculateScores(makeResult(issues));

    expect(scores.summary.totalIssues).toBe(2);
    expect(scores.summary.acknowledgedCount).toBe(1);
    expect(scores.summary.blocking).toBe(1);
    expect(scores.summary.missingInfo).toBe(1);
  });

  it("formatScoreSummary surfaces acknowledged/unaddressed split when count > 0 (#371)", () => {
    const ack = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    ack.acknowledged = true;
    const scores = calculateScores(makeResult([ack, makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" })]));
    expect(formatScoreSummary(scores)).toContain("Total: 2 (1 acknowledged via canicode annotations / 1 unaddressed)");
  });

  it("formatScoreSummary keeps the simple Total line when no acknowledgments", () => {
    const scores = calculateScores(makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ]));
    expect(formatScoreSummary(scores)).toContain("Total: 1");
    expect(formatScoreSummary(scores)).not.toContain("acknowledged");
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
    const categories: Category[] = ["pixel-critical", "responsive-critical", "code-quality", "token-management", "interaction", "semantic"];
    const rulesPerCat: Record<Category, string[]> = {
      "pixel-critical": ["no-auto-layout", "non-layout-container", "absolute-position-in-auto-layout"],
      "responsive-critical": ["fixed-size-in-auto-layout", "missing-size-constraint"],
      "code-quality": ["missing-component", "detached-instance", "variant-structure-mismatch", "deep-nesting"],
      "token-management": ["raw-value", "irregular-spacing"],
      "interaction": ["missing-interaction-state", "missing-prototype"],
      "semantic": ["non-standard-naming", "non-semantic-name", "inconsistent-naming-convention"],
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

  it("includes all categories", () => {
    const scores = calculateScores(makeResult([]));
    const summary = formatScoreSummary(scores);

    expect(summary).toContain("pixel-critical:");
    expect(summary).toContain("responsive-critical:");
    expect(summary).toContain("code-quality:");
    expect(summary).toContain("token-management:");
    expect(summary).toContain("interaction:");
    expect(summary).toContain("semantic:");
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
    expect(getCategoryLabel("semantic")).toBe("Semantic");
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
    // #404: scope is surfaced at the top level so downstream consumers
    // (report HTML, figma-implement-design) can branch on page vs
    // component without re-walking the tree.
    expect(json.scope).toBe("page");
  });

  it("propagates component scope into the JSON output (#404)", () => {
    const result = makeResult(
      [makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" })],
      100,
      { scope: "component" },
    );
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    expect(json.scope).toBe("component");
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
      detection: "rule-based",
      outputChannel: "score",
      persistenceIntent: "transient",
      purpose: "violation",
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
      purpose: "violation",
    });
  });

  it("tags info-collection rules with purpose 'info-collection' (#406)", () => {
    const result = makeResult([
      makeIssue({
        ruleId: "missing-prototype",
        category: "interaction",
        severity: "missing-info",
      }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<Record<string, unknown>>;

    expect(issues[0]).toMatchObject({
      ruleId: "missing-prototype",
      purpose: "info-collection",
      outputChannel: "score",
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

  it("includes isReadyForCodeGen field", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(typeof json.isReadyForCodeGen).toBe("boolean");
  });

  it("includes blockingIssueCount field", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(json.blockingIssueCount).toBe(2);
  });

  it("isReadyForCodeGen is true when no issues (S grade)", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(json.isReadyForCodeGen).toBe(true);
  });

  it("blockingIssueCount is 0 when no blocking issues", () => {
    const result = makeResult([
      makeIssue({ ruleId: "raw-value", category: "token-management", severity: "suggestion" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);

    expect(json.blockingIssueCount).toBe(0);
  });

  it("enriches each issue with applyStrategy, isInstanceChild, and targetProperty when known", () => {
    const namingIssue = makeIssue({ ruleId: "non-standard-naming", category: "semantic", severity: "suggestion" });
    namingIssue.violation.suggestedName = "Hover";

    const rawValueIssue = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    rawValueIssue.violation.subType = "color";

    const sizeIssue = makeIssue({
      ruleId: "missing-size-constraint",
      category: "responsive-critical",
      severity: "risk",
    });
    sizeIssue.violation.subType = "wrap";

    const result = makeResult([namingIssue, rawValueIssue, sizeIssue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<Record<string, unknown>>;

    expect(issues[0]).toMatchObject({
      ruleId: "non-standard-naming",
      applyStrategy: "auto-fix",
      targetProperty: "name",
      suggestedName: "Hover",
      isInstanceChild: false,
    });

    expect(issues[1]).toMatchObject({
      ruleId: "raw-value",
      applyStrategy: "auto-fix",
      isInstanceChild: false,
      annotationProperties: [{ type: "fills" }],
    });
    expect(issues[1]!["targetProperty"]).toBeUndefined();

    expect(issues[2]).toMatchObject({
      ruleId: "missing-size-constraint",
      applyStrategy: "property-mod",
      // #374: every missing-size-constraint subType targets both bounds.
      targetProperty: ["minWidth", "maxWidth"],
      isInstanceChild: false,
    });
  });

  it("derives isInstanceChild and sourceChildId from instance-child node ids", () => {
    const issue = makeIssue({
      ruleId: "missing-size-constraint",
      category: "responsive-critical",
      severity: "risk",
    });
    issue.violation.nodeId = "I175:8312;2299:23057";
    issue.violation.subType = "wrap";

    const result = makeResult([issue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<Record<string, unknown>>;

    expect(issues[0]).toMatchObject({
      isInstanceChild: true,
      sourceChildId: "2299:23057",
    });
  });

  it("surfaces acknowledgedCount on the JSON top level and per-issue acknowledged: true (#371)", () => {
    const ack = makeIssue({ ruleId: "raw-value", category: "token-management", severity: "missing-info" });
    ack.acknowledged = true;
    const unack = makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" });

    const result = makeResult([ack, unack]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<Record<string, unknown>>;

    expect(json.acknowledgedCount).toBe(1);
    expect(issues[0]).toMatchObject({ ruleId: "raw-value", acknowledged: true });
    expect(issues[1]).toMatchObject({ ruleId: "no-auto-layout" });
    expect(issues[1]).not.toHaveProperty("acknowledged");
  });

  it("acknowledgedCount is 0 and per-issue field omitted when no acknowledgments", () => {
    const result = makeResult([
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking" }),
    ]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    const issues = json.issues as Array<Record<string, unknown>>;

    expect(json.acknowledgedCount).toBe(0);
    expect(issues[0]).not.toHaveProperty("acknowledged");
  });

  it("emits codeConnectCoverage in the JSON and appends a coverage line to the summary when the option is provided (#526 sub-task 3)", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      codeConnectCoverage: { mapped: 2, total: 5 },
    });
    expect(json["codeConnectCoverage"]).toEqual({ mapped: 2, total: 5 });
    expect(json.summary).toMatch(/Code Connect coverage: 2\/5 components \(40%\) mapped/);
  });

  it("does not emit codeConnectCoverage when the option is omitted", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    expect(json["codeConnectCoverage"]).toBeUndefined();
    expect(json.summary).not.toMatch(/Code Connect coverage/);
  });

  it("renders 0% coverage cleanly when total is non-zero and mapped is zero (#526)", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      codeConnectCoverage: { mapped: 0, total: 4 },
    });
    expect(json.summary).toMatch(/0\/4 components \(0%\) mapped/);
  });

  it("renders 0% (not NaN) when both numerator and denominator are 0 — empty-component file with config present", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      codeConnectCoverage: { mapped: 0, total: 0 },
    });
    expect(json.summary).toMatch(/0\/0 components \(0%\) mapped/);
  });
});

// ─── isReadyForCodeGen helper ─────────────────────────────────────────────────

describe("isReadyForCodeGen helper", () => {
  const truthy: Grade[] = ["S", "A+", "A"];
  const falsy: Grade[] = ["B+", "B", "C+", "C", "D", "F"];

  for (const grade of truthy) {
    it(`returns true for grade ${grade}`, () => {
      expect(isReadyForCodeGen(grade)).toBe(true);
    });
  }

  for (const grade of falsy) {
    it(`returns false for grade ${grade}`, () => {
      expect(isReadyForCodeGen(grade)).toBe(false);
    });
  }
});


// ─── isReadyForCodeGen with minGrade parameter ────────────────────────────────

describe("isReadyForCodeGen with minGrade parameter", () => {
  it("GRADE_ORDER has all 9 grades in best-to-worst order", () => {
    expect(GRADE_ORDER).toEqual(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]);
  });

  it("DEFAULT_CODEGEN_READY_MIN_GRADE is A", () => {
    expect(DEFAULT_CODEGEN_READY_MIN_GRADE).toBe("A");
  });

  it("no-arg call still uses default (A) threshold", () => {
    expect(isReadyForCodeGen("A")).toBe(true);
    expect(isReadyForCodeGen("B+")).toBe(false);
  });

  describe("minGrade = S (tightest threshold)", () => {
    it("returns true only for S", () => {
      expect(isReadyForCodeGen("S", "S")).toBe(true);
    });

    it("returns false for A+ (one below S)", () => {
      expect(isReadyForCodeGen("A+", "S")).toBe(false);
    });

    it("returns false for A", () => {
      expect(isReadyForCodeGen("A", "S")).toBe(false);
    });

    it("returns false for F", () => {
      expect(isReadyForCodeGen("F", "S")).toBe(false);
    });
  });

  describe("minGrade = A+ (second tier)", () => {
    it("returns true for S (better than A+)", () => {
      expect(isReadyForCodeGen("S", "A+")).toBe(true);
    });

    it("returns true for A+", () => {
      expect(isReadyForCodeGen("A+", "A+")).toBe(true);
    });

    it("returns false for A (one below A+)", () => {
      expect(isReadyForCodeGen("A", "A+")).toBe(false);
    });
  });

  describe("minGrade = B+ (looser threshold)", () => {
    it("returns true for S", () => {
      expect(isReadyForCodeGen("S", "B+")).toBe(true);
    });

    it("returns true for A+", () => {
      expect(isReadyForCodeGen("A+", "B+")).toBe(true);
    });

    it("returns true for A", () => {
      expect(isReadyForCodeGen("A", "B+")).toBe(true);
    });

    it("returns true for B+", () => {
      expect(isReadyForCodeGen("B+", "B+")).toBe(true);
    });

    it("returns false for B (one below B+)", () => {
      expect(isReadyForCodeGen("B", "B+")).toBe(false);
    });

    it("returns false for F", () => {
      expect(isReadyForCodeGen("F", "B+")).toBe(false);
    });
  });

  describe("minGrade = F (most permissive threshold)", () => {
    it("returns true for all grades", () => {
      const allGrades: Grade[] = ["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"];
      for (const grade of allGrades) {
        expect(isReadyForCodeGen(grade, "F")).toBe(true);
      }
    });
  });
});

// ─── buildResultJson respects codegenReadyMinGrade ───────────────────────────

describe("buildResultJson respects codegenReadyMinGrade option", () => {
  it("uses default threshold (A) when codegenReadyMinGrade is not provided", () => {
    // Zero issues → S grade → true with default threshold
    const result = makeResult([]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores);
    expect(json.isReadyForCodeGen).toBe(true);
  });

  it("returns false for grade A when minGrade is S", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const mockScores = { ...scores, overall: { ...scores.overall, grade: "A" as Grade } };
    const json = buildResultJson("TestFile", result, mockScores, { codegenReadyMinGrade: "S" });
    expect(json.isReadyForCodeGen).toBe(false);
  });

  it("returns true for grade S when minGrade is S", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const mockScores = { ...scores, overall: { ...scores.overall, grade: "S" as Grade } };
    const json = buildResultJson("TestFile", result, mockScores, { codegenReadyMinGrade: "S" });
    expect(json.isReadyForCodeGen).toBe(true);
  });

  it("returns true for grade A when minGrade is B+", () => {
    const result = makeResult([]);
    const scores = calculateScores(result);
    const mockScores = { ...scores, overall: { ...scores.overall, grade: "A" as Grade } };
    const json = buildResultJson("TestFile", result, mockScores, { codegenReadyMinGrade: "B+" });
    expect(json.isReadyForCodeGen).toBe(true);
  });
});

// ─── formatRoundtripOptOutHintLine (ADR-022 / #526 sub-task 2) ────────────────

describe("formatRoundtripOptOutHintLine", () => {
  it("returns null when there are no unmapped-component issues (nothing to explain)", () => {
    const issue = makeIssue({
      ruleId: "no-auto-layout",
      category: "pixel-critical",
      severity: "blocking",
    });
    expect(formatRoundtripOptOutHintLine([issue], false)).toBeNull();
  });

  it("returns null when acknowledgments were provided (roundtrip mode — opt-outs already applied)", () => {
    const issue = makeIssue({
      ruleId: "unmapped-component",
      category: "code-quality",
      severity: "note",
    });
    expect(formatRoundtripOptOutHintLine([issue], true)).toBeNull();
  });

  it("returns the ADR-022 hint when an unmapped-component issue fires and no ack channel was provided", () => {
    const issue = makeIssue({
      ruleId: "unmapped-component",
      category: "code-quality",
      severity: "note",
    });
    expect(formatRoundtripOptOutHintLine([issue], false)).toBe(ROUNDTRIP_OPT_OUT_HINT);
  });

  it("returns null on empty issues regardless of ack channel state", () => {
    expect(formatRoundtripOptOutHintLine([], false)).toBeNull();
    expect(formatRoundtripOptOutHintLine([], true)).toBeNull();
  });
});

// ─── buildResultJson roundtripOptOutHint wiring (ADR-022) ─────────────────────

describe("buildResultJson — roundtripOptOutHint", () => {
  it("includes roundtripOptOutHint when eligible AND an unmapped-component issue fired", () => {
    const issue = makeIssue({
      ruleId: "unmapped-component",
      category: "code-quality",
      severity: "note",
    });
    const result = makeResult([issue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      roundtripOptOutHintEligible: true,
    });
    expect(json["roundtripOptOutHint"]).toBe(ROUNDTRIP_OPT_OUT_HINT);
    expect(String(json["summary"])).toContain(ROUNDTRIP_OPT_OUT_HINT);
  });

  it("omits roundtripOptOutHint when ineligible (acknowledgments channel provided)", () => {
    const issue = makeIssue({
      ruleId: "unmapped-component",
      category: "code-quality",
      severity: "note",
    });
    const result = makeResult([issue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      roundtripOptOutHintEligible: false,
    });
    expect(json["roundtripOptOutHint"]).toBeUndefined();
    expect(String(json["summary"])).not.toContain(ROUNDTRIP_OPT_OUT_HINT);
  });

  it("omits roundtripOptOutHint when eligible but no unmapped-component issue fired", () => {
    const issue = makeIssue({
      ruleId: "no-auto-layout",
      category: "pixel-critical",
      severity: "blocking",
    });
    const result = makeResult([issue]);
    const scores = calculateScores(result);
    const json = buildResultJson("TestFile", result, scores, {
      roundtripOptOutHintEligible: true,
    });
    expect(json["roundtripOptOutHint"]).toBeUndefined();
  });
});

