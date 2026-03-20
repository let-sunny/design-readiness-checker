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
  uniqueRuleCount: number;
  weightedIssueCount: number;
  densityScore: number;
  diversityScore: number;
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
    nodeCount: number;
  };
}

/**
 * Grade levels based on percentage
 */
export type Grade = "S" | "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F";

/**
 * Severity weights for density calculation
 */
const SEVERITY_DENSITY_WEIGHT: Record<Severity, number> = {
  blocking: 3.0,
  risk: 2.0,
  "missing-info": 1.0,
  suggestion: 0.5,
};

/**
 * Total rules per category
 */
const TOTAL_RULES_PER_CATEGORY: Record<Category, number> = {
  layout: 11,
  token: 7,
  component: 6,
  naming: 5,
  "ai-readability": 5,
  "handoff-risk": 5,
};

/**
 * Category weights for overall score (all equal by default)
 */
const CATEGORY_WEIGHT: Record<Category, number> = {
  layout: 1.0,
  token: 1.0,
  component: 1.0,
  naming: 1.0,
  "ai-readability": 1.0,
  "handoff-risk": 1.0,
};

/**
 * Score composition weights
 */
const DENSITY_WEIGHT = 0.7;
const DIVERSITY_WEIGHT = 0.3;

/**
 * Minimum score floor
 */
const SCORE_FLOOR = 5;

/**
 * Calculate grade from percentage
 */
function calculateGrade(percentage: number): Grade {
  if (percentage >= 95) return "S";
  if (percentage >= 90) return "A+";
  if (percentage >= 85) return "A";
  if (percentage >= 80) return "B+";
  if (percentage >= 75) return "B";
  if (percentage >= 70) return "C+";
  if (percentage >= 65) return "C";
  if (percentage >= 50) return "D";
  return "F";
}

/**
 * Convert grade to a CSS-safe class name suffix
 * e.g. "A+" -> "Aplus", "B+" -> "Bplus", "C+" -> "Cplus"
 */
export function gradeToClassName(grade: Grade): string {
  return grade.replace("+", "plus");
}

/**
 * Clamp a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Calculate scores from analysis result using density + diversity scoring
 *
 * Density Score = 100 - (weighted issue count / node count) * 100
 * Diversity Score = (1 - unique rules / total category rules) * 100
 * Final Score = density * 0.7 + diversity * 0.3
 */
export function calculateScores(result: AnalysisResult): ScoreReport {
  const categoryScores = initializeCategoryScores();
  const nodeCount = result.nodeCount;

  // Track unique rules per category
  const uniqueRulesPerCategory = new Map<Category, Set<string>>();
  for (const category of CATEGORIES) {
    uniqueRulesPerCategory.set(category, new Set());
  }

  // Count issues by severity per category and track unique rules
  for (const issue of result.issues) {
    const category = issue.rule.definition.category;
    const severity = issue.config.severity;
    const ruleId = issue.rule.definition.id;

    categoryScores[category].issueCount++;
    categoryScores[category].bySeverity[severity]++;
    categoryScores[category].weightedIssueCount += SEVERITY_DENSITY_WEIGHT[severity];
    uniqueRulesPerCategory.get(category)!.add(ruleId);
  }

  // Calculate percentage for each category based on density + diversity
  for (const category of CATEGORIES) {
    const catScore = categoryScores[category];
    const uniqueRules = uniqueRulesPerCategory.get(category)!;
    const totalRules = TOTAL_RULES_PER_CATEGORY[category];

    catScore.uniqueRuleCount = uniqueRules.size;

    // Density score: lower density = higher score
    let densityScore = 100;
    if (nodeCount > 0 && catScore.issueCount > 0) {
      const density = catScore.weightedIssueCount / nodeCount;
      densityScore = clamp(Math.round(100 - density * 100), 0, 100);
    }
    catScore.densityScore = densityScore;

    // Diversity score: fewer unique rules = higher score (issues are concentrated)
    // If no issues, diversity score is 100 (perfect)
    let diversityScore = 100;
    if (catScore.issueCount > 0) {
      const diversityRatio = uniqueRules.size / totalRules;
      diversityScore = clamp(Math.round((1 - diversityRatio) * 100), 0, 100);
    }
    catScore.diversityScore = diversityScore;

    // Combined score with floor
    const combinedScore = densityScore * DENSITY_WEIGHT + diversityScore * DIVERSITY_WEIGHT;
    catScore.percentage = catScore.issueCount > 0
      ? clamp(Math.round(combinedScore), SCORE_FLOOR, 100)
      : 100;

    catScore.score = catScore.percentage;
    catScore.maxScore = 100;
  }

  // Calculate overall score as weighted average of categories
  let totalWeight = 0;
  let weightedSum = 0;

  for (const category of CATEGORIES) {
    const weight = CATEGORY_WEIGHT[category];
    weightedSum += categoryScores[category].percentage * weight;
    totalWeight += weight;
  }

  const overallPercentage = totalWeight > 0
    ? Math.round(weightedSum / totalWeight)
    : 100;

  // Count issues by severity
  const summary = {
    totalIssues: result.issues.length,
    blocking: 0,
    risk: 0,
    missingInfo: 0,
    suggestion: 0,
    nodeCount,
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
      score: overallPercentage,
      maxScore: 100,
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
      score: 100,
      maxScore: 100,
      percentage: 100,
      issueCount: 0,
      uniqueRuleCount: 0,
      weightedIssueCount: 0,
      densityScore: 100,
      diversityScore: 100,
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
    lines.push(`  ${category}: ${cat.percentage}% (${cat.issueCount} issues, ${cat.uniqueRuleCount} rules)`);
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
