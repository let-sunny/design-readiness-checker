import type { ScoreReport, CategoryScoreResult } from "@/core/scoring.js";
import type { Category } from "@/contracts/category.js";
import type { MismatchCase } from "./contracts/evaluation-agent.js";
import type { ScoreAdjustment, NewRuleProposal } from "./contracts/tuning-agent.js";
import {
  generateCalibrationReport,
  type CalibrationReportData,
} from "./report-generator.js";

const ALL_CATEGORIES: Category[] = [
  "layout",
  "token",
  "component",
  "naming",
  "ai-readability",
  "handoff-risk",
];

function buildCategoryScore(
  category: Category,
  overrides: Partial<CategoryScoreResult> = {}
): CategoryScoreResult {
  return {
    category,
    score: 100,
    maxScore: 100,
    percentage: 100,
    issueCount: 0,
    uniqueRuleCount: 0,
    weightedIssueCount: 0,
    densityScore: 100,
    diversityScore: 100,
    bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
    ...overrides,
  };
}

function buildScoreReport(
  overrides: Partial<ScoreReport> = {}
): ScoreReport {
  const byCategory = {} as Record<Category, CategoryScoreResult>;
  for (const cat of ALL_CATEGORIES) {
    byCategory[cat] = buildCategoryScore(cat);
  }

  return {
    overall: { score: 95, maxScore: 100, percentage: 95, grade: "S" },
    byCategory,
    summary: {
      totalIssues: 0,
      blocking: 0,
      risk: 0,
      missingInfo: 0,
      suggestion: 0,
      nodeCount: 10,
    },
    ...overrides,
  };
}

function buildReportData(
  overrides: Partial<CalibrationReportData> = {}
): CalibrationReportData {
  return {
    fileKey: "abc123",
    fileName: "Test Design",
    analyzedAt: "2026-03-20T12:00:00Z",
    nodeCount: 50,
    issueCount: 5,
    convertedNodeCount: 40,
    skippedNodeCount: 10,
    scoreReport: buildScoreReport(),
    mismatches: [],
    validatedRules: [],
    adjustments: [],
    newRuleProposals: [],
    ...overrides,
  };
}

describe("generateCalibrationReport", () => {
  it("contains all required markdown sections", () => {
    const report = generateCalibrationReport(buildReportData());

    const requiredSections = [
      "# Calibration Report",
      "## Overview",
      "## Current Score Summary",
      "## Score Adjustment Proposals",
      "## New Rule Proposals",
      "## Validated Rules",
      "## Detailed Mismatch List",
      "## Application Guide",
    ];

    for (const section of requiredSections) {
      expect(report).toContain(section);
    }
  });

  it("includes file metadata in overview table", () => {
    const data = buildReportData({
      fileKey: "key-xyz",
      fileName: "My Design File",
      analyzedAt: "2026-01-15T08:30:00Z",
      nodeCount: 120,
      issueCount: 15,
      convertedNodeCount: 100,
      skippedNodeCount: 20,
      scoreReport: buildScoreReport({
        overall: { score: 82, maxScore: 100, percentage: 82, grade: "B+" },
      }),
    });

    const report = generateCalibrationReport(data);

    expect(report).toContain("My Design File");
    expect(report).toContain("key-xyz");
    expect(report).toContain("2026-01-15T08:30:00Z");
    expect(report).toContain("120");
    expect(report).toContain("15");
    expect(report).toContain("100");
    expect(report).toContain("20");
    expect(report).toContain("B+ (82%)");
  });

  it("renders adjustment table when adjustments exist", () => {
    const adjustment: ScoreAdjustment = {
      ruleId: "no-absolute-position",
      currentScore: -8,
      proposedScore: -5,
      currentSeverity: "blocking",
      proposedSeverity: "risk",
      reasoning: "Conversion was easier than expected",
      confidence: "high",
      supportingCases: 3,
    };

    const data = buildReportData({ adjustments: [adjustment] });
    const report = generateCalibrationReport(data);

    expect(report).toContain("no-absolute-position");
    expect(report).toContain("-8");
    expect(report).toContain("-5");
    expect(report).toContain("blocking -> risk");
    expect(report).toContain("high");
    expect(report).toContain("3");
    expect(report).toContain("Conversion was easier than expected");
    expect(report).not.toContain("No adjustments proposed");
  });

  it("renders 'No adjustments proposed' when adjustments are empty", () => {
    const data = buildReportData({ adjustments: [] });
    const report = generateCalibrationReport(data);

    expect(report).toContain("No adjustments proposed");
  });

  it("renders new rule proposals when they exist", () => {
    const proposal: NewRuleProposal = {
      suggestedId: "shadow-complexity",
      category: "layout",
      description: "Detects complex shadow configurations",
      suggestedSeverity: "risk",
      suggestedScore: -4,
      reasoning: "Multiple shadows caused conversion struggles",
      supportingCases: 5,
    };

    const data = buildReportData({ newRuleProposals: [proposal] });
    const report = generateCalibrationReport(data);

    expect(report).toContain("### shadow-complexity");
    expect(report).toContain("layout");
    expect(report).toContain("Detects complex shadow configurations");
    expect(report).toContain("risk");
    expect(report).toContain("-4");
    expect(report).toContain("Multiple shadows caused conversion struggles");
    expect(report).toContain("5");
    expect(report).not.toContain("No new rules proposed");
  });

  it("handles empty data gracefully", () => {
    const data = buildReportData({
      mismatches: [],
      validatedRules: [],
      adjustments: [],
      newRuleProposals: [],
    });

    const report = generateCalibrationReport(data);

    expect(report).toContain("No adjustments proposed");
    expect(report).toContain("No new rules proposed");
    expect(report).toContain("No rules were validated in this run");
    expect(report).toContain("No mismatches found");
  });
});
