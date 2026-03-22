import type { AnalysisResult } from "@/core/engine/rule-engine.js";
import { calculateScores } from "@/core/engine/scoring.js";
import type { RuleId } from "@/core/contracts/rule.js";
import type { Severity } from "@/core/contracts/severity.js";
import type {
  AnalysisAgentInput,
  AnalysisAgentOutput,
  NodeIssueSummary,
} from "./contracts/analysis-agent.js";

/**
 * Group issues by nodeId and produce sorted summaries
 */
function buildNodeIssueSummaries(
  result: AnalysisResult
): NodeIssueSummary[] {
  const nodeMap = new Map<
    string,
    {
      nodePath: string;
      totalScore: number;
      issueCount: number;
      ruleIds: Set<string>;
      severities: Set<string>;
    }
  >();

  for (const issue of result.issues) {
    const nodeId = issue.violation.nodeId;
    const existing = nodeMap.get(nodeId);

    if (existing) {
      existing.totalScore += issue.calculatedScore;
      existing.issueCount++;
      existing.ruleIds.add(issue.rule.definition.id);
      existing.severities.add(issue.config.severity);
    } else {
      nodeMap.set(nodeId, {
        nodePath: issue.violation.nodePath,
        totalScore: issue.calculatedScore,
        issueCount: 1,
        ruleIds: new Set([issue.rule.definition.id]),
        severities: new Set([issue.config.severity as string]),
      });
    }
  }

  const summaries: NodeIssueSummary[] = [];

  for (const [nodeId, data] of nodeMap) {
    summaries.push({
      nodeId,
      nodePath: data.nodePath,
      totalScore: data.totalScore,
      issueCount: data.issueCount,
      flaggedRuleIds: [...data.ruleIds],
      severities: [...data.severities],
    });
  }

  // Sort by totalScore ascending (most negative = most problematic first)
  summaries.sort((a, b) => a.totalScore - b.totalScore);

  return summaries;
}

/**
 * Extract rule scores map from analysis result for downstream agents
 */
export function extractRuleScores(
  result: AnalysisResult
): Record<string, { score: number; severity: string }> {
  const scores: Record<string, { score: number; severity: string }> = {};

  for (const issue of result.issues) {
    const ruleId = issue.rule.definition.id as RuleId;
    if (!scores[ruleId]) {
      scores[ruleId] = {
        score: issue.config.score,
        severity: issue.config.severity as Severity,
      };
    }
  }

  return scores;
}

/**
 * Analysis Agent - Step 1 of calibration pipeline
 *
 * Wraps existing analyzeFile + calculateScores and adds
 * nodeId-grouped issue summaries for downstream agents.
 */
export function runAnalysisAgent(
  input: AnalysisAgentInput
): AnalysisAgentOutput {
  const { analysisResult } = input;

  const scoreReport = calculateScores(analysisResult);
  const nodeIssueSummaries = buildNodeIssueSummaries(analysisResult);

  return {
    analysisResult,
    scoreReport,
    nodeIssueSummaries,
  };
}
