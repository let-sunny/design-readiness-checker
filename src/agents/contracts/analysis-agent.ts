import { z } from "zod";
import type { AnalysisResult } from "../../core/engine/rule-engine.js";
import type { ScoreReport } from "../../core/engine/scoring.js";
import type { RuleId } from "../../core/contracts/rule.js";
import type { Severity } from "../../core/contracts/severity.js";

export const NodeIssueSummarySchema = z.object({
  nodeId: z.string(),
  nodePath: z.string(),
  totalScore: z.number(),
  issueCount: z.number(),
  flaggedRuleIds: z.array(z.string()),
  severities: z.array(z.string()),
});

export type NodeIssueSummary = z.infer<typeof NodeIssueSummarySchema>;

export interface AnalysisAgentInput {
  analysisResult: AnalysisResult;
}

export interface AnalysisAgentOutput {
  analysisResult: AnalysisResult;
  scoreReport: ScoreReport;
  nodeIssueSummaries: NodeIssueSummary[];
}

export interface NodeIssueDetail {
  ruleId: RuleId;
  severity: Severity;
  calculatedScore: number;
  message: string;
}
