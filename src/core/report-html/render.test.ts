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
  renderCategory,
  renderSeverityGroup,
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
  };
}

function makeIssue(opts: {
  ruleId: string;
  category: Category;
  severity: Severity;
  score?: number;
  nodeId?: string;
}): AnalysisIssue {
  return {
    violation: makeViolation(opts.ruleId, opts.nodeId),
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
      makeIssue({ ruleId: "hardcoded-color", category: "token-management", severity: "risk" }),
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
    expect(html).toContain("Overall Score");
  });

  it("renders category gauge grid", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-gauges-grid"');
    expect(html).toContain('class="rpt-gauge-item"');
    expect(html).toContain('class="rpt-gauge-label"');
    // All 6 categories should be present
    for (const cat of CATEGORIES) {
      expect(html).toContain(`href="#cat-${cat}"`);
    }
  });

  it("renders issue summary with severity dots", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-summary-inner"');
    expect(html).toContain("sev-blocking");
    expect(html).toContain("sev-risk");
    expect(html).toContain("sev-missing");
    expect(html).toContain("sev-suggestion");
    expect(html).toContain("Total");
  });

  it("renders opportunities for blocking issues", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-opps-title"');
    expect(html).toContain("Opportunities");
    expect(html).toContain("no auto layout");
  });

  it("skips opportunities when no blocking issues", () => {
    const data = makeReportData({
      issues: [makeIssue({ ruleId: "test", category: "minor", severity: "suggestion" })],
    });
    const html = renderReportBody(data);
    expect(html).not.toContain("Opportunities");
  });

  it("renders all category sections", () => {
    const html = renderReportBody(makeReportData());
    for (const cat of CATEGORIES) {
      expect(html).toContain(`id="cat-${cat}"`);
    }
  });

  it("renders footer with metadata", () => {
    const html = renderReportBody(makeReportData());
    expect(html).toContain('class="rpt-footer"');
    expect(html).toContain("CanICode");
    expect(html).toContain("100 nodes");
    expect(html).toContain("Max depth 5");
  });

  it("does not contain any Tailwind classes", () => {
    const html = renderReportBody(makeReportData());
    // Common Tailwind patterns that should not appear
    expect(html).not.toMatch(/class="[^"]*\bflex\b/);
    expect(html).not.toMatch(/class="[^"]*\bbg-card\b/);
    expect(html).not.toMatch(/class="[^"]*\btext-sm\b/);
    expect(html).not.toMatch(/class="[^"]*\bpx-\d/);
    expect(html).not.toMatch(/class="[^"]*\bbg-red-500\b/);
  });
});

// ---- renderSummaryDot ----

describe("renderSummaryDot", () => {
  it("renders a dot with severity class", () => {
    const html = renderSummaryDot("sev-blocking", 3, "Blocking");
    expect(html).toContain('class="rpt-dot sev-blocking"');
    expect(html).toContain(">3<");
    expect(html).toContain("Blocking");
  });

  it("includes tooltip text", () => {
    const html = renderSummaryDot("sev-risk", 1, "Risk");
    expect(html).toContain("Implementable now but will break");
    expect(html).toContain('title=');
  });

  it("renders zero count", () => {
    const html = renderSummaryDot("sev-suggestion", 0, "Suggestion");
    expect(html).toContain(">0<");
  });
});

// ---- renderOpportunities ----

describe("renderOpportunities", () => {
  const issues = [
    makeIssue({ ruleId: "no-auto-layout", category: "pixel-critical", severity: "blocking", score: -10 }),
    makeIssue({ ruleId: "missing-component", category: "code-quality", severity: "blocking", score: -5, nodeId: "2-1" }),
  ];

  it("renders opportunity items", () => {
    const html = renderOpportunities(issues, "fileKey123");
    expect(html).toContain('class="rpt-opps-item"');
    expect(html).toContain("no auto layout");
    expect(html).toContain("missing component");
  });

  it("renders bar with proportional width", () => {
    const html = renderOpportunities(issues, "fileKey123");
    expect(html).toContain('style="width:100%"'); // max score
    expect(html).toContain('style="width:50%"'); // half of max
  });

  it("renders Go to node links with data-node-id", () => {
    const html = renderOpportunities(issues, "fileKey123");
    expect(html).toContain('data-node-id="1-1"');
    expect(html).toContain('data-node-id="2-1"');
    expect(html).toContain("Go to node →");
  });

  it("renders Figma deep links", () => {
    const html = renderOpportunities(issues, "fileKey123");
    expect(html).toContain("figma.com");
    expect(html).toContain("fileKey123");
  });
});

// ---- renderCategory ----

describe("renderCategory", () => {
  const scores = makeScores();

  it("renders as details element with category id", () => {
    const html = renderCategory("pixel-critical", scores, [], "fk");
    expect(html).toContain('id="cat-pixel-critical"');
    expect(html).toContain("<details");
    expect(html).toContain("</details>");
  });

  it("shows score badge with color class", () => {
    const html = renderCategory("pixel-critical", scores, [], "fk");
    expect(html).toContain('class="rpt-badge score-green"');
    expect(html).toContain(">80<");
  });

  it("shows No issues found when empty", () => {
    const html = renderCategory("minor", scores, [], "fk");
    expect(html).toContain("No issues found");
  });

  it("opens automatically when has blocking/risk issues", () => {
    const issues = [makeIssue({ ruleId: "test", category: "pixel-critical", severity: "blocking" })];
    const html = renderCategory("pixel-critical", scores, issues, "fk");
    expect(html).toContain("open");
  });

  it("stays closed when only suggestion issues", () => {
    const issues = [makeIssue({ ruleId: "test", category: "minor", severity: "suggestion" })];
    const html = renderCategory("minor", scores, issues, "fk");
    expect(html).not.toMatch(/details[^>]*\bopen\b/);
  });

  it("renders chevron icon", () => {
    const html = renderCategory("pixel-critical", scores, [], "fk");
    expect(html).toContain('class="rpt-cat-chevron no-print"');
  });
});

// ---- renderSeverityGroup ----

describe("renderSeverityGroup", () => {
  const issues = [
    makeIssue({ ruleId: "rule-a", category: "pixel-critical", severity: "blocking" }),
    makeIssue({ ruleId: "rule-b", category: "pixel-critical", severity: "blocking", nodeId: "2-1" }),
  ];

  it("renders severity header with dot and label", () => {
    const html = renderSeverityGroup("blocking", issues, "fk");
    expect(html).toContain('class="rpt-dot-sm sev-blocking"');
    expect(html).toContain("Blocking");
  });

  it("renders issue count", () => {
    const html = renderSeverityGroup("blocking", issues, "fk");
    expect(html).toContain('class="rpt-sev-count">2<');
  });

  it("renders all issue rows", () => {
    const html = renderSeverityGroup("blocking", issues, "fk");
    expect(html).toContain("rule a");
    expect(html).toContain("rule b");
  });
});

// ---- renderIssueRow ----

describe("renderIssueRow", () => {
  const issue = makeIssue({
    ruleId: "no-auto-layout",
    category: "pixel-critical",
    severity: "blocking",
    score: -10,
  });

  it("renders as details element", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('<details class="rpt-issue"');
  });

  it("renders severity dot and score badge", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('class="rpt-dot-sm sev-blocking"');
    expect(html).toContain('class="rpt-issue-score sev-blocking"');
    expect(html).toContain(">-10<");
  });

  it("renders rule name and message", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('class="rpt-issue-name"');
    expect(html).toContain("no auto layout");
    expect(html).toContain("Issue: no-auto-layout");
  });

  it("renders node path", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain('class="rpt-issue-path"');
    expect(html).toContain("Root &gt; Frame &gt; Node");
  });

  it("renders why/impact/fix", () => {
    const html = renderIssueRow(issue, "fk");
    expect(html).toContain("<strong>Why:</strong>");
    expect(html).toContain("<strong>Impact:</strong>");
    expect(html).toContain("<strong>Fix:</strong>");
    expect(html).toContain("Because it matters");
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
    expect(html).toContain('data-file-key="fk"');
    expect(html).toContain('data-message="Issue: no-auto-layout"');
  });

  it("escapes HTML in all user-facing strings", () => {
    const xssIssue = makeIssue({
      ruleId: "test",
      category: "minor",
      severity: "suggestion",
    });
    xssIssue.violation.message = '<img src=x onerror="alert(1)">';
    xssIssue.violation.nodePath = '<script>alert("xss")</script>';
    const html = renderIssueRow(xssIssue, "fk");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img");
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

  it("uses Go to node in opportunities section", () => {
    const data = makeReportData();
    const html = renderReportBody(data);
    // Check opportunities link text
    expect(html).toContain("Go to node →");
    expect(html).not.toContain("Figma →");
  });
});
