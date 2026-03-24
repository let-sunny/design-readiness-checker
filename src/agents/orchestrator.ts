import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AnalysisFile, AnalysisNode, AnalysisNodeType } from "@/core/contracts/figma-node.js";
import { analyzeFile } from "@/core/engine/rule-engine.js";
import { RULE_CONFIGS } from "@/core/rules/rule-config.js";

import type {
  CalibrationConfig,
  CalibrationStatus,
} from "./contracts/calibration.js";
import { CalibrationConfigSchema } from "./contracts/calibration.js";
import type { ConversionExecutor } from "./contracts/conversion-agent.js";
import type { NodeIssueSummary } from "./contracts/analysis-agent.js";
import type { ScoreAdjustment, NewRuleProposal } from "./contracts/tuning-agent.js";
import type { MismatchCase } from "./contracts/evaluation-agent.js";
import type { ScoreReport } from "@/core/engine/scoring.js";

import { runAnalysisAgent, extractRuleScores } from "./analysis-agent.js";
import { runConversionAgent } from "./node-conversion-agent.js";
import { runEvaluationAgent } from "./evaluation-agent.js";
import { runTuningAgent } from "./tuning-agent.js";
import { generateCalibrationReport } from "./report-generator.js";
import { ActivityLogger } from "./activity-logger.js";
import { createCalibrationRunDir, extractFixtureName } from "./run-directory.js";

export interface CalibrationRunOptions {
  enableActivityLog?: boolean;
}

export interface CalibrationRunResult {
  status: CalibrationStatus;
  scoreReport: ScoreReport;
  nodeIssueSummaries: NodeIssueSummary[];
  mismatches: MismatchCase[];
  validatedRules: string[];
  adjustments: ScoreAdjustment[];
  newRuleProposals: NewRuleProposal[];
  reportPath: string;
  logPath?: string | undefined;
  error?: string;
}

/**
 * Select nodes for conversion based on sampling strategy
 */
function selectNodes(
  summaries: NodeIssueSummary[],
  strategy: string,
  maxNodes: number
): NodeIssueSummary[] {
  if (summaries.length === 0) return [];

  switch (strategy) {
    case "all":
      return summaries.slice(0, maxNodes);

    case "random": {
      const shuffled = [...summaries];
      // Fisher-Yates shuffle
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = temp;
      }
      return shuffled.slice(0, maxNodes);
    }

    case "top-issues":
    default:
      // Already sorted by totalScore (most negative first)
      return summaries.slice(0, maxNodes);
  }
}

/**
 * Node types that are pure graphics — not useful for code conversion
 */
const EXCLUDED_NODE_TYPES: Set<AnalysisNodeType> = new Set([
  "VECTOR",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
  "ELLIPSE",
  "LINE",
]);

/**
 * Find a node by ID in the tree
 */
function findNode(root: AnalysisNode, nodeId: string): AnalysisNode | null {
  if (root.id === nodeId) return root;
  if (root.children) {
    for (const child of root.children) {
      const found = findNode(child, nodeId);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Check if a subtree contains at least one TEXT node
 */
function hasTextDescendant(node: AnalysisNode): boolean {
  if (node.type === "TEXT") return true;
  if (node.children) {
    for (const child of node.children) {
      if (hasTextDescendant(child)) return true;
    }
  }
  return false;
}

/**
 * Minimum dimensions for conversion candidates
 */
const MIN_WIDTH = 200;
const MIN_HEIGHT = 200;
const FILTER_THRESHOLD = 500;

/**
 * Node types eligible for code conversion
 */
const ELIGIBLE_NODE_TYPES: Set<AnalysisNodeType> = new Set([
  "FRAME",
  "COMPONENT",
  "INSTANCE",
]);

import { isExcludedName } from "@/core/rules/excluded-names.js";

/**
 * Filter node summaries to meaningful conversion candidates.
 *
 * If summaries.length <= FILTER_THRESHOLD (500), all nodes pass (typical page size).
 * Otherwise, inclusion criteria:
 * - type is FRAME, COMPONENT, or INSTANCE
 * - width >= 200 AND height >= 200
 * - 3+ direct children
 * - at least one TEXT descendant (excludes pure icons/graphics)
 *
 * Exclusion criteria:
 * - pure graphic types (VECTOR, BOOLEAN_OPERATION, etc.)
 * - name contains "icon", "ico", "badge", or "indicator"
 */
export function filterConversionCandidates(
  summaries: NodeIssueSummary[],
  documentRoot: AnalysisNode
): NodeIssueSummary[] {
  // Always exclude invisible nodes — can't screenshot for visual comparison
  const visibleSummaries = summaries.filter((summary) => {
    const node = findNode(documentRoot, summary.nodeId);
    return node ? node.visible !== false : false;
  });

  // Small trees: skip further filtering
  if (visibleSummaries.length <= FILTER_THRESHOLD) return visibleSummaries;

  // Large trees: filter to meaningful conversion candidates
  return visibleSummaries.filter((summary) => {
    const node = findNode(documentRoot, summary.nodeId);
    if (!node) return false;

    // Exclude pure graphic node types
    if (EXCLUDED_NODE_TYPES.has(node.type)) return false;

    // Only allow FRAME, COMPONENT, INSTANCE
    if (!ELIGIBLE_NODE_TYPES.has(node.type)) return false;

    // Exclude decorative/structural/overlay nodes by name
    if (isExcludedName(node.name)) return false;

    // Require minimum dimensions
    const bbox = node.absoluteBoundingBox;
    if (bbox && (bbox.width < MIN_WIDTH || bbox.height < MIN_HEIGHT)) return false;

    // Require 3+ direct children
    if (!node.children || node.children.length < 3) return false;

    // Require at least one TEXT descendant
    if (!hasTextDescendant(node)) return false;

    return true;
  });
}

// Reuse loader from core engine
import { loadFile as coreLoadFile } from "@/core/engine/loader.js";

async function loadFile(
  input: string,
  token?: string
): Promise<{ file: AnalysisFile; fileKey: string; nodeId: string | undefined }> {
  const { file, nodeId } = await coreLoadFile(input, token);
  return { file, fileKey: file.fileKey, nodeId };
}

/**
 * Build rule scores map from RULE_CONFIGS
 */
function buildRuleScoresMap(): Record<string, { score: number; severity: string }> {
  const scores: Record<string, { score: number; severity: string }> = {};
  for (const [id, config] of Object.entries(RULE_CONFIGS)) {
    scores[id] = { score: config.score, severity: config.severity };
  }
  return scores;
}

/**
 * Run Step 1 only: analysis + save JSON output
 */
export async function runCalibrationAnalyze(
  config: CalibrationConfig
): Promise<{
  analysisOutput: ReturnType<typeof runAnalysisAgent> extends infer T ? T : never;
  ruleScores: Record<string, { score: number; severity: string }>;
  fileKey: string;
}> {
  const parsed = CalibrationConfigSchema.parse(config);
  const { file, fileKey, nodeId } = await loadFile(parsed.input, parsed.token);

  const analyzeOptions = nodeId ? { targetNodeId: nodeId } : {};
  const analysisResult = analyzeFile(file, analyzeOptions);

  const analysisOutput = runAnalysisAgent({ analysisResult });
  const ruleScores = {
    ...buildRuleScoresMap(),
    ...extractRuleScores(analysisResult),
  };

  return { analysisOutput, ruleScores, fileKey };
}

/**
 * Run Steps 3+4: evaluation + tuning from pre-computed analysis and conversion data
 */
export function runCalibrationEvaluate(
  analysisJson: {
    nodeIssueSummaries: NodeIssueSummary[];
    scoreReport: ScoreReport;
    fileKey: string;
    fileName: string;
    analyzedAt: string;
    nodeCount: number;
    issueCount: number;
  },
  conversionJson: Record<string, unknown>,
  ruleScores: Record<string, { score: number; severity: string }>
) {
  // Support both formats:
  // Old: { records: [...], skippedNodeIds: [...] }
  // New: { rootNodeId, similarity, ruleImpactAssessment: [...], uncoveredStruggles: [...] }
  let conversionRecords: Array<{
    nodeId: string;
    nodePath: string;
    difficulty: string;
    ruleRelatedStruggles: Array<{ ruleId: string; description: string; actualImpact: string }>;
    uncoveredStruggles: Array<{ description: string; suggestedCategory: string; estimatedImpact: string }>;
  }>;

  if (Array.isArray(conversionJson["records"])) {
    // Old per-node format
    conversionRecords = conversionJson["records"] as typeof conversionRecords;
  } else if (conversionJson["ruleImpactAssessment"]) {
    // New whole-design format — convert to records format
    const assessment = conversionJson["ruleImpactAssessment"] as Array<{
      ruleId: string; issueCount: number; actualImpact: string; description: string;
    }>;
    const struggles = (conversionJson["uncoveredStruggles"] ?? []) as Array<{
      description: string; suggestedCategory: string; estimatedImpact: string;
    }>;
    conversionRecords = [{
      nodeId: (conversionJson["rootNodeId"] as string) ?? "root",
      nodePath: "root",
      difficulty: (conversionJson["difficulty"] as string) ?? "moderate",
      ruleRelatedStruggles: assessment.map(a => ({
        ruleId: a.ruleId,
        description: a.description,
        actualImpact: a.actualImpact === "low" ? "easy" : a.actualImpact === "high" ? "hard" : a.actualImpact,
      })),
      uncoveredStruggles: struggles,
    }];
  } else {
    conversionRecords = [];
  }

  const evaluationOutput = runEvaluationAgent({
    nodeIssueSummaries: analysisJson.nodeIssueSummaries.map((s) => ({
      nodeId: s.nodeId,
      nodePath: s.nodePath,
      flaggedRuleIds: s.flaggedRuleIds,
    })),
    conversionRecords,
    ruleScores,
  });

  const tuningOutput = runTuningAgent({
    mismatches: evaluationOutput.mismatches,
    ruleScores,
  });

  const report = generateCalibrationReport({
    fileKey: analysisJson.fileKey,
    fileName: analysisJson.fileName,
    analyzedAt: analysisJson.analyzedAt,
    nodeCount: analysisJson.nodeCount,
    issueCount: analysisJson.issueCount,
    convertedNodeCount: conversionRecords.length,
    skippedNodeCount: Array.isArray(conversionJson["skippedNodeIds"]) ? (conversionJson["skippedNodeIds"] as unknown[]).length : 0,
    scoreReport: analysisJson.scoreReport,
    mismatches: evaluationOutput.mismatches,
    validatedRules: evaluationOutput.validatedRules,
    adjustments: tuningOutput.adjustments,
    newRuleProposals: tuningOutput.newRuleProposals,
  });

  return {
    evaluationOutput,
    tuningOutput,
    report,
  };
}

/**
 * Run the full calibration pipeline
 *
 * @deprecated Use the `/calibrate-loop` command instead. This function duplicates the
 * orchestration logic that is now handled by the command + subagent pipeline.
 * Kept temporarily for backward compatibility — will be removed in a future version.
 *
 * Sequence: validate -> load file -> analysis -> node selection -> conversion -> evaluation -> tuning -> report
 */
export async function runCalibration(
  config: CalibrationConfig,
  executor: ConversionExecutor,
  options?: CalibrationRunOptions
): Promise<CalibrationRunResult> {
  const parsed = CalibrationConfigSchema.parse(config);
  const pipelineStart = Date.now();
  const startedAt = new Date().toISOString();
  const runDir = parsed.runDir ?? createCalibrationRunDir(extractFixtureName(parsed.input));
  const logger = options?.enableActivityLog ? new ActivityLogger(runDir) : null;

  try {
    // Step 1: Load and analyze
    let stepStart = Date.now();
    const { file, fileKey, nodeId } = await loadFile(parsed.input, parsed.token);
    const analyzeOptions = nodeId ? { targetNodeId: nodeId } : {};
    const analysisResult = analyzeFile(file, analyzeOptions);
    const analysisOutput = runAnalysisAgent({ analysisResult });

    const ruleScores = {
      ...buildRuleScoresMap(),
      ...extractRuleScores(analysisResult),
    };

    await logger?.logStep({
      step: "Analysis",
      result: `${analysisResult.nodeCount} nodes, ${analysisResult.issues.length} issues, grade ${analysisOutput.scoreReport.overall.grade}`,
      durationMs: Date.now() - stepStart,
    });

    // Step 2: Filter and select nodes for conversion
    stepStart = Date.now();
    const candidates = filterConversionCandidates(
      analysisOutput.nodeIssueSummaries,
      analysisResult.file.document
    );
    const selectedNodes = selectNodes(
      candidates,
      parsed.samplingStrategy,
      parsed.maxConversionNodes
    );

    const conversionOutput = await runConversionAgent(
      {
        fileKey,
        nodes: selectedNodes.map((n) => ({
          nodeId: n.nodeId,
          nodePath: n.nodePath,
          flaggedRuleIds: n.flaggedRuleIds,
        })),
      },
      executor
    );

    await logger?.logStep({
      step: "Conversion",
      result: `${conversionOutput.records.length} converted, ${conversionOutput.skippedNodeIds.length} skipped`,
      durationMs: Date.now() - stepStart,
    });

    // Step 3: Evaluate
    stepStart = Date.now();
    const evaluationOutput = runEvaluationAgent({
      nodeIssueSummaries: selectedNodes.map((n) => ({
        nodeId: n.nodeId,
        nodePath: n.nodePath,
        flaggedRuleIds: n.flaggedRuleIds,
      })),
      conversionRecords: conversionOutput.records,
      ruleScores,
    });

    await logger?.logStep({
      step: "Evaluation",
      result: `${evaluationOutput.mismatches.length} mismatches, ${evaluationOutput.validatedRules.length} validated`,
      durationMs: Date.now() - stepStart,
    });

    // Step 4: Tune
    stepStart = Date.now();
    const tuningOutput = runTuningAgent({
      mismatches: evaluationOutput.mismatches,
      ruleScores,
    });

    await logger?.logStep({
      step: "Tuning",
      result: `${tuningOutput.adjustments.length} adjustments, ${tuningOutput.newRuleProposals.length} new rule proposals`,
      durationMs: Date.now() - stepStart,
    });

    // Generate report
    const report = generateCalibrationReport({
      fileKey,
      fileName: file.name,
      analyzedAt: startedAt,
      nodeCount: analysisResult.nodeCount,
      issueCount: analysisResult.issues.length,
      convertedNodeCount: conversionOutput.records.length,
      skippedNodeCount: conversionOutput.skippedNodeIds.length,
      scoreReport: analysisOutput.scoreReport,
      mismatches: evaluationOutput.mismatches,
      validatedRules: evaluationOutput.validatedRules,
      adjustments: tuningOutput.adjustments,
      newRuleProposals: tuningOutput.newRuleProposals,
    });

    // Write markdown report
    const reportPath = resolve(parsed.outputPath);
    const reportDir = resolve(parsed.outputPath, "..");
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    await writeFile(reportPath, report, "utf-8");

    await logger?.logSummary({
      totalDurationMs: Date.now() - pipelineStart,
      nodesAnalyzed: analysisResult.nodeCount,
      nodesConverted: conversionOutput.records.length,
      mismatches: evaluationOutput.mismatches.length,
      adjustments: tuningOutput.adjustments.length,
      status: "completed",
    });

    return {
      status: "completed",
      scoreReport: analysisOutput.scoreReport,
      nodeIssueSummaries: analysisOutput.nodeIssueSummaries,
      mismatches: evaluationOutput.mismatches,
      validatedRules: evaluationOutput.validatedRules,
      adjustments: tuningOutput.adjustments,
      newRuleProposals: tuningOutput.newRuleProposals,
      reportPath,
      logPath: logger?.getLogPath(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await logger?.logSummary({
      totalDurationMs: Date.now() - pipelineStart,
      nodesAnalyzed: 0,
      nodesConverted: 0,
      mismatches: 0,
      adjustments: 0,
      status: `failed: ${errorMessage}`,
    });

    return {
      status: "failed",
      scoreReport: {
        overall: { score: 0, maxScore: 100, percentage: 0, grade: "F" },
        byCategory: {} as ScoreReport["byCategory"],
        summary: { totalIssues: 0, blocking: 0, risk: 0, missingInfo: 0, suggestion: 0, nodeCount: 0 },
      },
      nodeIssueSummaries: [],
      mismatches: [],
      validatedRules: [],
      adjustments: [],
      newRuleProposals: [],
      reportPath: parsed.outputPath,
      error: errorMessage,
    };
  }
}
