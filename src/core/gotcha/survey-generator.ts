import type { AnalysisResult, AnalysisIssue } from "../engine/rule-engine.js";
import type { ScoreReport } from "../engine/scoring.js";
import { isReadyForCodeGen } from "../engine/scoring.js";
import type { GotchaSurvey, GotchaSurveyQuestion } from "../contracts/gotcha-survey.js";
import type { RuleId } from "../contracts/rule.js";
import { GOTCHA_QUESTIONS } from "../rules/gotcha-questions.js";

const NODE_PATH_SEPARATOR = " > ";

/**
 * Generate a gotcha survey from analysis results.
 *
 * Filters to blocking and risk severity issues, deduplicates repeated rules
 * on sibling nodes (same parent + same ruleId), orders blocking first then
 * risk by original traversal order, and maps each issue to a survey question
 * using the GOTCHA_QUESTIONS lookup.
 */
export function generateGotchaSurvey(
  result: AnalysisResult,
  scores: ScoreReport,
): GotchaSurvey {
  const grade = scores.overall.grade;

  // Step 1: Filter to blocking and risk severity only
  const relevantIssues = result.issues.filter(
    (issue) => issue.config.severity === "blocking" || issue.config.severity === "risk",
  );

  // Step 2: Deduplicate — same ruleId on siblings (same parent path) → keep first
  const deduped = deduplicateSiblingIssues(relevantIssues);

  // Step 3: Sort — blocking first, then risk; within same severity, preserve traversal order
  const sorted = stableSortBySeverity(deduped);

  // Step 4: Map to survey questions
  const questions = sorted
    .map((issue) => mapToQuestion(issue))
    .filter((q): q is GotchaSurveyQuestion => q !== null);

  return {
    designGrade: grade,
    isReadyForCodeGen: isReadyForCodeGen(grade),
    questions,
  };
}

/**
 * Deduplicate issues where the same ruleId fires on multiple children of the
 * same parent. Keeps the first occurrence (preserving traversal order).
 */
function deduplicateSiblingIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  const seen = new Set<string>();
  const result: AnalysisIssue[] = [];

  for (const issue of issues) {
    const parentPath = getParentPath(issue.violation.nodePath);
    const key = `${parentPath}||${issue.violation.ruleId}`;

    if (!seen.has(key)) {
      seen.add(key);
      result.push(issue);
    }
  }

  return result;
}

/**
 * Extract the parent path from a full node path.
 * "Root > Section > Child" → "Root > Section"
 * "Root" → "" (root node has no parent)
 */
function getParentPath(nodePath: string): string {
  const lastSep = nodePath.lastIndexOf(NODE_PATH_SEPARATOR);
  if (lastSep === -1) return "";
  return nodePath.slice(0, lastSep);
}

/**
 * Extract the node name from a full node path (last segment).
 * "Root > Section > Child" → "Child"
 */
function getNodeName(nodePath: string): string {
  const lastSep = nodePath.lastIndexOf(NODE_PATH_SEPARATOR);
  if (lastSep === -1) return nodePath;
  return nodePath.slice(lastSep + NODE_PATH_SEPARATOR.length);
}

/**
 * Stable sort: blocking before risk, preserving original array order within
 * each severity group.
 */
function stableSortBySeverity(issues: AnalysisIssue[]): AnalysisIssue[] {
  const blocking: AnalysisIssue[] = [];
  const risk: AnalysisIssue[] = [];

  for (const issue of issues) {
    if (issue.config.severity === "blocking") {
      blocking.push(issue);
    } else {
      risk.push(issue);
    }
  }

  return [...blocking, ...risk];
}

/**
 * Map an AnalysisIssue to a GotchaSurveyQuestion using the GOTCHA_QUESTIONS table.
 * Returns null if no mapping exists for the ruleId.
 */
function mapToQuestion(issue: AnalysisIssue): GotchaSurveyQuestion | null {
  const ruleId = issue.violation.ruleId as RuleId;
  const template = GOTCHA_QUESTIONS[ruleId];
  if (!template) return null;

  const nodeName = getNodeName(issue.violation.nodePath);

  return {
    nodeId: issue.violation.nodeId,
    nodeName,
    ruleId,
    severity: issue.config.severity,
    question: template.question.replace("{nodeName}", nodeName),
    hint: template.hint,
    example: template.example,
  };
}
