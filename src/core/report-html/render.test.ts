import type { Category } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";
import type { Rule, RuleViolation } from "../contracts/rule.js";
import type { RuleConfig } from "../contracts/rule.js";
import type { AnalysisIssue } from "../engine/rule-engine.js";
import type { ScoreReport, CategoryScoreResult } from "../engine/scoring.js";
import {
  renderReportBody,
  renderSummaryDot,
  renderOpportunities,
  renderRuleSection,
  renderIssueRow,
} from "./render.js";
import type { ReportData } from "./render.js";
import { CATEGORIES } from "../contracts/category.js";

// ---- Test helpers ----

function makeRule(id: string, category: Category): Rule {
  return {
    definition: {
      id,
      name: id.replace(/-/g, " "),
      category,
      why: "Because it matters",
      impact: "Affects implementation",
      fix: "Fix it in Figma",
    },
    check: () => null,
  };
}

function makeConfig(severity: Severity, score = -5): RuleConfig {
  return { severity, score, enabled: true };
}

function makeViolation(ruleId: string, nodeId = "1-1"): RuleViolation {
  return {
    ruleId,
    nodeId,
    nodePath: "Root > Frame > Node",
    message: `Issue: ${ruleId}`,
    suggestion: `Fix: ${ruleId}`,
  };
}

function makeIssue(opts: {
  ruleId: string;
  category: Category;
  severity: Severity;
  score?: number;
  nodeId?: string;
  guide?: string;
}): AnalysisIssue {
  const v = makeViolation(opts.ruleId, opts.nodeId);
  if (opts.guide) v.guide = opts.guide;
  return {
    violation: v,
    rule: makeRule(opts.ruleId, opts.category),
    config: makeConfig(opts.severity, opts.score ?? -5),
    depth: 0,
    maxDepth: 5,
    calculatedScore: opts.score ?? -5,
  };
}

function makeCategoryScore(
  category: Category,
  percentage: number,
  issueCount: number
): CategoryScoreResult {
  return {
    category,
    score: 0,
    maxScore: 0,
    percentage,
    issueCount,
    uniqueRuleCount: issueCount,
    weightedIssueCount: issueCount,
    densityScore: 0,
    diversityScore: 0,
    bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
  };
}

function makeScores(overrides?: Partial<ScoreReport>): ScoreReport {
  const byCategory = {} as Record<Category, CategoryScoreResult>;
  for (const cat of CATEGORIES) {
    byCategory[cat] = makeCategoryScore(cat, 80, 1);
  }
  return {
    overall: { score: -20, maxScore: 0, percentage: 80, grade: "A" },
    byCategory,
    summary: {
      totalIssues: 6,
      blocking: 1,
      risk: 2,
      missingInfo: 1,
      suggestion: 2,
      nodeCount: 100,
    },
    ...overrides,
  };
}

function makeReportData(overrides?: Partial<ReportData>): ReportData {
  return {
    fileName: "Test Design",
    fileKey: "abc123",
    scores: makeScores(),
    issues: [
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
      makeIssue({ ruleId: "hardcoded-color", category: "token-management", severity: "risk", nodeId: "2-1" }),
    ],
    nodeCount: 100,
    maxDepth: 5,
    ...overrides,
  };
}

// ---- renderReportBody ----

describe("renderReportBody", () => {
  it("renders overall score section", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-overall"');
    expect(html).toContain('class="rpt-score-value"');
    expect(html).toContain(">80<");
  });

  it("renders category gauge buttons", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-gauges-grid"');
    expect(html).toContain('data-tab="pixel-critical"');
    expect(html).toContain('class="rpt-gauge-label"');
  });

  it("renders issue summary", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-summary-inner"');
    expect(html).toContain("sev-blocking");
    expect(html).toContain("sev-risk");
    expect(html).toContain("Total");
  });

  it("renders category tabs", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-tab-list"');
    for (const cat of CATEGORIES) {
      expect(html).toContain(`data-tab="${cat}"`);
      expect(html).toContain(`data-panel="${cat}"`);
    }
  });

  it("first tab is active by default", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-tab active"');
    expect(html).toContain('class="rpt-tab-panel active"');
  });

  it("renders opportunities as rule groups", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain("Opportunities");
    expect(html).toContain("no auto layout");
    expect(html).toContain("data-opp-rule");
    expect(html).toContain("data-opp-cat");
  });

  it("skips opportunities when no issues", () => {
    const data = makeReportData({ issues: [] });
    const html = renderReportBody(data);
    expect(html).not.toContain("Opportunities");
  });

  it("does not embed inline script (interactions initialized by caller)", () => {
    const html = renderReportBody(makeReportData());
    expect(html).not.toContain("<script>");
  });

  it("renders footer", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-footer"');
    expect(html).toContain("100 nodes");
  });

  it("does not contain Tailwind classes", () => {
    const html = renderReportBody(makeReportData());
    expect(html).not.toMatch(/class="[^"]*\bflex\b/);
    expect(html).not.toMatch(/class="[^"]*\bbg-card\b/);
    expect(html).not.toMatch(/class="[^"]*\btext-sm\b/);
  });
});

// ---- renderSummaryDot ----

describe("renderSummaryDot", () => {
  it("renders dot with severity class and count", () => {
    const html = renderSummaryDot("sev-blocking", 3, "Blocking");
    expect(html).toContain('class="rpt-dot sev-blocking"');
    expect(html).toContain(">3<");
    expect(html).toContain("Blocking");
  });

  it("renders zero count", () => {
    const html = renderSummaryDot("sev-suggestion", 0, "Suggestion");
    expect(html).toContain(">0<");
  });
});

// ---- renderOpportunities ----

describe("renderOpportunities", () => {
  it("renders rule-based opportunity items with navigation data", () => {
    const issues = [
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
      makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10, nodeId: "2-1" }),
    ];
    // Build rule groups manually (same as getTopRules)
    const rg = {
      ruleId: "no-auto-layout",
      ruleName: "no auto layout",
      severity: "blocking" as const,
      severityClass: "sev-blocking",
      why: "w", impact: "i", fix: "f",
      issues,
      totalScore: -20,
    };
    const html = renderOpportunities([rg]);
    expect(html).toContain("no auto layout");
    expect(html).toContain("2 issues");
    expect(html).toContain("-20");
    expect(html).toContain('data-opp-rule="no-auto-layout"');
    expect(html).toContain('data-opp-cat="pixel-critical"');
  });
});

// ---- renderRuleSection ----

describe("renderRuleSection", () => {
  const issues = [
    makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10, guide: "Icon wrappers excluded" }),
    makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10, nodeId: "2-1" }),
  ];
  const rg = {
    ruleId: "no-auto-layout",
    ruleName: "No Auto Layout",
    severity: "blocking" as const,
    severityClass: "sev-blocking",
    why: "Because layout", impact: "Breaks code", fix: "Apply auto-layout",
    issues,
    totalScore: -20,
  };

  it("renders as details element with data-rule", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain('<details class="card rpt-rule"');
    expect(html).toContain('data-rule="no-auto-layout"');
  });

  it("opens by default for blocking/risk", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain("open");
  });

  it("stays closed for suggestion severity", () => {
    const sugRg = { ...rg, severity: "suggestion" as const };
    const html = renderRuleSection(sugRg, "fk");
    expect(html).not.toMatch(/details[^>]*\bopen\b/);
  });

  it("renders static Why/Impact/Fix in summary (always visible)", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain("<strong>Why:</strong> Because layout");
    expect(html).toContain("<strong>Impact:</strong> Breaks code");
    expect(html).toContain("<strong>Fix:</strong> Apply auto-layout");
    // These should be inside <summary>, not in the body
    const summaryEnd = html.indexOf("</summary>");
    const whyPos = html.indexOf("Because layout");
    expect(whyPos).toBeLessThan(summaryEnd);
  });

  it("renders rule name, severity, issue count, total score", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain("No Auto Layout");
    expect(html).toContain("sev-blocking");
    expect(html).toContain("2 issues");
    expect(html).toContain(">-20<");
  });

  it("renders chevron", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain('class="rpt-rule-chevron');
  });

  it("renders all issue rows inside", () => {
    const html = renderRuleSection(rg, "fk");
    expect(html).toContain("Issue: no-auto-layout");
    expect(html.match(/class="rpt-issue"/g)?.length).toBe(2);
  });
});

// ---- renderIssueRow ----

describe("renderIssueRow", () => {
  const issue = makeIssue({
    ruleId: "no-auto-layout",
    category: "pixel-critical",
    severity: "blocking",
    score: -10,
    guide: "Icon wrappers are excluded",
  });

  it("renders as details element", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('<details class="rpt-issue"');
  });

  it("renders message in summary", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain("Issue: no-auto-layout");
    expect(html).toContain('class="rpt-issue-score');
  });

  it("renders suggestion in body", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('class="rpt-issue-suggestion"');
    expect(html).toContain("Fix: no-auto-layout");
  });

  it("renders guide when present", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('class="rpt-issue-guide"');
    expect(html).toContain("Icon wrappers are excluded");
  });

  it("omits guide when absent", () => {
    const noGuide = makeIssue({ ruleId: "test", category: "semantic", severity: "suggestion" });
    const html = renderIssueRow(noGuide, "fk");
    expect(html).not.toContain("rpt-issue-guide");
  });

  it("renders node path", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain("Root &gt; Frame &gt; Node");
  });

  it("renders Go to node link with data-node-id", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('data-node-id="1-1"');
    expect(html).toContain("Go to node");
  });

  it("does not render comment button without figmaToken", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).not.toContain("Comment on Figma");
  });

  it("renders comment button with figmaToken", () => {
    const html = renderIssueRow(issue, "fk", "figd_token");
    expect(html).toContain("Comment on Figma");
  });

  it("escapes HTML in user-facing strings", () => {
    const xss = makeIssue({ ruleId: "test", category: "semantic", severity: "suggestion" });
    xss.violation.message = '<script>alert(1)</script>';
    xss.violation.suggestion = '<img onerror="x">';
    const html = renderIssueRow(xss, "fk");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ---- Platform-neutral wording ----

describe("platform-neutral wording", () => {
  it("uses Go to node instead of Open in Figma", () => {
    const html = renderReportBody(makeReportData());
    expect(html).not.toContain("Open in Figma");
    expect(html).toContain("Go to node");
  });
});

// ---- Category order ----

describe("category order", () => {
  it("renders Semantic before Interaction in tabs", () => {
    const html = renderReportBody(makeReportData());
    const semanticPos = html.indexOf('data-tab="semantic"');
    const interactionPos = html.indexOf('data-tab="interaction"');
    expect(semanticPos).toBeLessThan(interactionPos);
  });
});
