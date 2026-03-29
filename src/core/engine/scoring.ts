import type { Category } from "../contracts/category.js";
import { CATEGORIES, CATEGORY_LABELS } from "../contracts/category.js";
import type { RuleId, RuleConfig } from "../contracts/rule.js";
import type { Severity } from "../contracts/severity.js";
import type { AnalysisResult } from "./rule-engine.js";
import { RULE_CONFIGS, RULE_ID_CATEGORY } from "../rules/rule-config.js";
import { version as VERSION } from "../../../package.json";

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
 * Density weighting now uses per-rule `calculatedScore` from the rule engine,
 * which incorporates both the calibrated rule score and depthWeight.
 *
 * Previously, flat severity weights (blocking=3.0, risk=2.0, etc.) were used,
 * making all rules within the same severity contribute equally and rendering
 * the per-rule scores in rule-config.ts effectively unused.
 *
 * Now: `no-auto-layout` (score: -10, depthWeight: 1.5) at root contributes 15
 * to density, while `default-name` (score: -1, no depthWeight) contributes 1.
 * This makes calibration loop score adjustments flow through to user-facing scores.
 */

/**
 * Compute sum of |score| for all rules in each category from a given config map.
 * Used as denominator for severity-weighted diversity scoring.
 * Must use the same preset-adjusted config map that produced the analysis issues,
 * otherwise diversity ratios will be incorrect.
 */
function computeTotalScorePerCategory(
  configs: Record<RuleId, RuleConfig>
): Record<Category, number> {
  const totals = Object.fromEntries(
    CATEGORIES.map(c => [c, 0])
  ) as Record<Category, number>;

  for (const [id, config] of Object.entries(configs)) {
    const category = RULE_ID_CATEGORY[id as RuleId];
    if (category && config.enabled) {
      totals[category] += Math.abs(config.score);
    }
  }

  return totals;
}

/**
 * Category weights for overall score.
 * All equal (1.0) by design — no category is inherently more important than another.
 * This avoids subjective bias; individual rule scores within each category already
 * encode relative importance. If calibration reveals certain categories correlate
 * more strongly with visual-compare similarity, these weights can be adjusted.
 */
const CATEGORY_WEIGHT: Record<Category, number> = {
  "pixel-critical": 1.0,
  "responsive-critical": 1.0,
  "code-quality": 1.0,
  "token-management": 1.0,
  "interaction": 1.0,
  "minor": 1.0,
};

/**
 * Score composition weights (initial intuition, pending calibration validation).
 *
 * Density (0.7): "how many issues per node" — measures issue volume relative to design size.
 *   Designs with many issues per node are harder to implement accurately.
 *
 * Diversity (0.3): "how many different rule types triggered" — measures issue breadth.
 *   A design that triggers 1 rule 50 times is easier to fix than one triggering 10 different rules.
 *
 * The 70:30 ratio prioritizes volume over variety. Rationale: a design with a single
 * systemic problem (e.g., all frames missing auto-layout) is still very hard to implement,
 * even though diversity is low. Density captures this; diversity adds a penalty for
 * designs with scattered, unrelated issues.
 *
 * Status: initial values. To be validated via /calibrate-loop against visual-compare results.
 */
const DENSITY_WEIGHT = 0.7;
const DIVERSITY_WEIGHT = 0.3;

/**
 * Minimum score floor.
 * Even the worst design gets 5% instead of 0%. Rationale: a score of 0 implies
 * "completely unimplementable", but any Figma file with visible nodes provides
 * some structural information. The floor also avoids demoralizing UX — seeing 0%
 * feels like the tool failed, not that the design needs improvement.
 */
const SCORE_FLOOR = 5;

/**
 * Calculate grade from percentage.
 * Thresholds follow a 5-point interval pattern (95/90/85/80/75/70/65) with a wider
 * gap for D (50-64) and F (<50). This mirrors academic grading conventions where
 * the top tiers are tightly spaced and the failing range is broad.
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
 * Diversity Score = (1 - weighted triggered rule scores / total category scores) * 100
 * Final Score = density * 0.7 + diversity * 0.3
 *
 * @param result Analysis result with issues
 * @param configs Optional preset-adjusted config map used to produce the issues.
 *                If not provided, diversity totals are reconstructed from issue.config values.
 */
export function calculateScores(
  result: AnalysisResult,
  configs?: Record<RuleId, RuleConfig>
): ScoreReport {
  const categoryScores = initializeCategoryScores();
  const nodeCount = result.nodeCount;

  // Track unique rules and their base |score| per category
  const uniqueRulesPerCategory = new Map<Category, Set<string>>();
  const ruleScorePerCategory = new Map<Category, Map<string, number>>();
  for (const category of CATEGORIES) {
    uniqueRulesPerCategory.set(category, new Set());
    ruleScorePerCategory.set(category, new Map());
  }

  // Compute totals from the config map.
  // If configs provided: use preset-adjusted totals (recommended when using presets).
  // If not: fall back to static RULE_CONFIGS — only correct when issues were
  // produced with default RULE_CONFIGS, otherwise diversity ratios will be skewed.
  const totalScorePerCategory = computeTotalScorePerCategory(configs ?? RULE_CONFIGS);

  // Count issues by severity per category and track unique rules with scores
  for (const issue of result.issues) {
    const category = issue.rule.definition.category;
    const severity = issue.config.severity;
    const ruleId = issue.rule.definition.id;

    categoryScores[category].issueCount++;
    categoryScores[category].bySeverity[severity]++;
    categoryScores[category].weightedIssueCount += Math.abs(issue.calculatedScore);
    uniqueRulesPerCategory.get(category)!.add(ruleId);
    ruleScorePerCategory.get(category)!.set(ruleId, Math.abs(issue.config.score));
  }

  // Calculate percentage for each category based on density + diversity
  for (const category of CATEGORIES) {
    const catScore = categoryScores[category];
    const uniqueRules = uniqueRulesPerCategory.get(category)!;

    catScore.uniqueRuleCount = uniqueRules.size;

    // Density score: lower density = higher score
    let densityScore = 100;
    if (nodeCount > 0 && catScore.issueCount > 0) {
      const density = catScore.weightedIssueCount / nodeCount;
      densityScore = clamp(Math.round(100 - density * 100), 0, 100);
    }
    catScore.densityScore = densityScore;

    // Diversity score: weighted by base rule |score| (config.score, not calculatedScore).
    // Uses base score intentionally — diversity measures "what types of problems exist",
    // not "where they occur". depthWeight affects density (volume penalty) but not diversity
    // (breadth penalty). A blocking rule (score -10) penalizes diversity more than a
    // suggestion (score -1), so low-severity-only designs correctly get high diversity scores.
    let diversityScore = 100;
    if (catScore.issueCount > 0) {
      const ruleScores = ruleScorePerCategory.get(category)!;
      const weightedTriggered = Array.from(ruleScores.values()).reduce((sum, s) => sum + s, 0);
      const weightedTotal = totalScorePerCategory[category];
      const diversityRatio = weightedTotal > 0 ? weightedTriggered / weightedTotal : 0;
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
  return CATEGORY_LABELS[category];
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

/**
 * Build a JSON-serializable analysis result summary.
 * Shared by CLI (--json) and MCP server (analyze tool response).
 */
export function buildResultJson(
  fileName: string,
  result: AnalysisResult,
  scores: ScoreReport,
  options?: { fileKey?: string },
): Record<string, unknown> {
  const issuesByRule: Record<string, number> = {};
  for (const issue of result.issues) {
    const id = issue.violation.ruleId;
    issuesByRule[id] = (issuesByRule[id] ?? 0) + 1;
  }

  const issues = result.issues.map((issue) => ({
    ruleId: issue.violation.ruleId,
    ...(issue.violation.subType && { subType: issue.violation.subType }),
    severity: issue.config.severity,
    nodeId: issue.violation.nodeId,
    nodePath: issue.violation.nodePath,
    message: issue.violation.message,
  }));

  const json: Record<string, unknown> = {
    version: VERSION,
    analyzedAt: result.analyzedAt,
    ...(options?.fileKey && { fileKey: options.fileKey }),
    fileName,
    nodeCount: result.nodeCount,
    maxDepth: result.maxDepth,
    issueCount: result.issues.length,
    scores: {
      overall: scores.overall,
      categories: scores.byCategory,
    },
    issuesByRule,
    issues,
    summary: formatScoreSummary(scores),
  };

  if (result.failedRules.length > 0) {
    json["failedRules"] = result.failedRules;
  }

  return json;
}