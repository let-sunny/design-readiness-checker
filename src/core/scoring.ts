import type { Category } from "../contracts/category.js";
import { CATEGORIES } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";
import type { AnalysisResult } from "./rule-engine.js";

/**
 * Score breakdown for a single category
 */
export interface CategoryScoreResult {
  category: Category;
  score: number;
  maxScore: number;
  percentage: number;
  issueCount: number;
  bySeverity: Record<Severity, number>;
}

/**
 * Overall score report
 */
export interface ScoreReport {
  overall: {
    score: number;
    maxScore: number;
    percentage: number;
    grade: Grade;
  };
  byCategory: Record<Category, CategoryScoreResult>;
  summary: {
    totalIssues: number;
    blocking: number;
    risk: number;
    missingInfo: number;
    suggestion: number;
  };
}

/**
 * Grade levels based on percentage
 */
export type Grade = "A" | "B" | "C" | "D" | "F";

/**
 * Default max score per category
 */
const DEFAULT_CATEGORY_MAX_SCORE = 100;

/**
 * Calculate grade from percentage
 */
function calculateGrade(percentage: number): Grade {
  if (percentage >= 90) return "A";
  if (percentage >= 80) return "B";
  if (percentage >= 70) return "C";
  if (percentage >= 60) return "D";
  return "F";
}

/**
 * Calculate scores from analysis result
 */
export function calculateScores(result: AnalysisResult): ScoreReport {
  const categoryScores = initializeCategoryScores();

  // Accumulate scores from issues
  for (const issue of result.issues) {
    const category = issue.rule.definition.category;
    const severity = issue.config.severity;

    categoryScores[category].issueCount++;
    categoryScores[category].score += issue.calculatedScore;
    categoryScores[category].bySeverity[severity]++;
  }

  // Calculate percentages for each category
  for (const category of CATEGORIES) {
    const catScore = categoryScores[category];
    // Score is negative, so we add it to max to get remaining
    const remaining = catScore.maxScore + catScore.score;
    catScore.percentage = Math.max(
      0,
      Math.round((remaining / catScore.maxScore) * 100)
    );
  }

  // Calculate overall score
  const totalScore = Object.values(categoryScores).reduce(
    (sum, cat) => sum + cat.score,
    0
  );
  const totalMaxScore = CATEGORIES.length * DEFAULT_CATEGORY_MAX_SCORE;
  const remaining = totalMaxScore + totalScore;
  const overallPercentage = Math.max(
    0,
    Math.round((remaining / totalMaxScore) * 100)
  );

  // Count issues by severity
  const summary = {
    totalIssues: result.issues.length,
    blocking: 0,
    risk: 0,
    missingInfo: 0,
    suggestion: 0,
  };

  for (const issue of result.issues) {
    switch (issue.config.severity) {
      case "blocking":
        summary.blocking++;
        break;
      case "risk":
        summary.risk++;
        break;
      case "missing-info":
        summary.missingInfo++;
        break;
      case "suggestion":
        summary.suggestion++;
        break;
    }
  }

  return {
    overall: {
      score: totalScore,
      maxScore: totalMaxScore,
      percentage: overallPercentage,
      grade: calculateGrade(overallPercentage),
    },
    byCategory: categoryScores,
    summary,
  };
}

/**
 * Initialize empty category scores
 */
function initializeCategoryScores(): Record<Category, CategoryScoreResult> {
  const scores: Partial<Record<Category, CategoryScoreResult>> = {};

  for (const category of CATEGORIES) {
    scores[category] = {
      category,
      score: 0,
      maxScore: DEFAULT_CATEGORY_MAX_SCORE,
      percentage: 100,
      issueCount: 0,
      bySeverity: {
        blocking: 0,
        risk: 0,
        "missing-info": 0,
        suggestion: 0,
      },
    };
  }

  return scores as Record<Category, CategoryScoreResult>;
}

/**
 * Format score report as a summary string
 */
export function formatScoreSummary(report: ScoreReport): string {
  const lines: string[] = [];

  lines.push(`Overall: ${report.overall.grade} (${report.overall.percentage}%)`);
  lines.push("");
  lines.push("By Category:");

  for (const category of CATEGORIES) {
    const cat = report.byCategory[category];
    lines.push(`  ${category}: ${cat.percentage}% (${cat.issueCount} issues)`);
  }

  lines.push("");
  lines.push("Issues:");
  lines.push(`  Blocking: ${report.summary.blocking}`);
  lines.push(`  Risk: ${report.summary.risk}`);
  lines.push(`  Missing Info: ${report.summary.missingInfo}`);
  lines.push(`  Suggestion: ${report.summary.suggestion}`);
  lines.push(`  Total: ${report.summary.totalIssues}`);

  return lines.join("\n");
}

/**
 * Get category label for display
 */
export function getCategoryLabel(category: Category): string {
  const labels: Record<Category, string> = {
    layout: "Layout",
    token: "Design Token",
    component: "Component",
    naming: "Naming",
    "ai-readability": "AI Readability",
    "handoff-risk": "Handoff Risk",
  };
  return labels[category];
}

/**
 * Get severity label for display
 */
export function getSeverityLabel(severity: Severity): string {
  const labels: Record<Severity, string> = {
    blocking: "Blocking",
    risk: "Risk",
    "missing-info": "Missing Info",
    suggestion: "Suggestion",
  };
  return labels[severity];
}
