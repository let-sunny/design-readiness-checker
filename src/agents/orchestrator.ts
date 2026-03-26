import type { AnalysisFile, AnalysisNode, AnalysisNodeType } from "../core/contracts/figma-node.js";
import { analyzeFile } from "../core/engine/rule-engine.js";
import { RULE_CONFIGS } from "../core/rules/rule-config.js";

import type { CalibrationConfigInput } from "./contracts/calibration.js";
import { CalibrationConfigSchema } from "./contracts/calibration.js";
import type { NodeIssueSummary } from "./contracts/analysis-agent.js";
import type { ScoreReport } from "../core/engine/scoring.js";

import { runAnalysisAgent, extractRuleScores } from "./analysis-agent.js";
import { runEvaluationAgent } from "./evaluation-agent.js";
import { runTuningAgent } from "./tuning-agent.js";
import { generateCalibrationReport } from "./report-generator.js";
import {
  loadCalibrationEvidence,
  appendCalibrationEvidence,
  appendDiscoveryEvidence,
} from "./evidence-collector.js";
import type { CalibrationEvidenceEntry, DiscoveryEvidenceEntry } from "./evidence-collector.js";

/**
 * Normalize Converter's actualImpact (none/low/medium/high) to Difficulty enum (easy/moderate/hard/failed).
 * Falls back to "moderate" for unknown values.
 */
function normalizeActualImpact(impact: string): string {
  const mapping: Record<string, string> = {
    none: "easy",
    low: "easy",
    easy: "easy",
    medium: "moderate",
    moderate: "moderate",
    high: "hard",
    hard: "hard",
    failed: "failed",
  };
  return mapping[impact] ?? "moderate";
}

/**
 * Calibration tier thresholds (percentage-based).
 * - "full": Converter + visual-compare + Gap Analysis
 * - "visual-only": Converter + visual-compare (Gap Analysis skipped)
 */
export const CALIBRATION_TIER_THRESHOLDS = {
  full: 90,       // A or higher
  visualOnly: 0,  // everything else — always run Converter
} as const;

export type CalibrationTier = "full" | "visual-only";

/**
 * Determine calibration tier from analysis percentage.
 */
export function determineCalibrationTier(percentage: number): CalibrationTier {
  if (percentage >= CALIBRATION_TIER_THRESHOLDS.full) return "full";
  return "visual-only";
}

/**
 * Map visual-compare similarity percentage to conversion difficulty.
 * Used by Converter and Evaluation agents.
 */
export const SIMILARITY_DIFFICULTY_THRESHOLDS = {
  easy: 90,
  moderate: 70,
  hard: 50,
} as const;

export type ConversionDifficulty = "easy" | "moderate" | "hard" | "failed";

export function similarityToDifficulty(similarity: number): ConversionDifficulty {
  if (similarity >= SIMILARITY_DIFFICULTY_THRESHOLDS.easy) return "easy";
  if (similarity >= SIMILARITY_DIFFICULTY_THRESHOLDS.moderate) return "moderate";
  if (similarity >= SIMILARITY_DIFFICULTY_THRESHOLDS.hard) return "hard";
  return "failed";
}

/**
 * Patterns that indicate environment/tooling noise rather than design issues.
 * Used to filter out non-actionable entries from discovery evidence.
 */
export const ENVIRONMENT_NOISE_PATTERNS = [
  /\bfont\s*(cdn|availability|fallback|loading|download)\b/i,
  /\bgoogle\s*fonts?\b/i,
  /\bretina\b/i,
  /\bdevicescalefactor\b/i,
  /\bDPI\b/,
  /\bscreenshot\s*(resolution|dimension|size|scale)\b/i,
  /\bnetwork\b/i,
  /\bCDN\s*(block|unavailabl\w*|fail)/i,
  /\bCI\s*(environment|limitation|constraint)\b/i,
];

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

import { isExcludedName } from "../core/rules/excluded-names.js";

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
import { loadFile as coreLoadFile } from "../core/engine/loader.js";

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
  config: CalibrationConfigInput
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
  ruleScores: Record<string, { score: number; severity: string }>,
  options?: { collectEvidence?: boolean | undefined; fixtureName?: string | undefined }
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
        actualImpact: normalizeActualImpact(a.actualImpact),
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

  // Load prior evidence if collecting
  const priorEvidence = options?.collectEvidence
    ? loadCalibrationEvidence()
    : undefined;

  const tuningInput = {
    mismatches: evaluationOutput.mismatches,
    ruleScores,
    ...(priorEvidence ? { priorEvidence } : {}),
  };
  const tuningOutput = runTuningAgent(tuningInput);

  // Collect evidence from this run (non-fatal — pipeline continues on I/O failure)
  if (options?.collectEvidence) {
    try {
      const timestamp = new Date().toISOString();
      const fixture = options.fixtureName ?? analysisJson.fileKey;

      // Append calibration evidence (overscored/underscored)
      const calibrationEntries: CalibrationEvidenceEntry[] = [];
      for (const m of evaluationOutput.mismatches) {
        if ((m.type === "overscored" || m.type === "underscored") && m.ruleId) {
          calibrationEntries.push({
            ruleId: m.ruleId,
            type: m.type,
            actualDifficulty: m.actualDifficulty,
            fixture,
            timestamp,
          });
        }
      }
      appendCalibrationEvidence(calibrationEntries);

      // Append discovery evidence (missing-rule), filtering out environment/tooling noise
      const discoveryEntries: DiscoveryEvidenceEntry[] = [];
      for (const m of evaluationOutput.mismatches) {
        if (m.type === "missing-rule") {
          const isNoise = ENVIRONMENT_NOISE_PATTERNS.some(p => p.test(m.reasoning));
          if (isNoise) continue;

          const category = m.category ?? "unknown";
          const description = m.description ?? m.reasoning;
          discoveryEntries.push({
            description,
            category,
            impact: m.actualDifficulty,
            fixture,
            timestamp,
            source: "evaluation",
          });
        }
      }
      appendDiscoveryEvidence(discoveryEntries);
    } catch (err) {
      console.warn("[evidence] Failed to collect evidence (non-fatal):", err);
    }
  }

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

