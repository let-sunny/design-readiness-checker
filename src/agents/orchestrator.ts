import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { AnalysisFile } from "@/contracts/figma-node.js";
import { analyzeFile } from "@/core/rule-engine.js";
import { FigmaClient } from "@/adapters/figma-client.js";
import { loadFigmaFileFromJson } from "@/adapters/figma-file-loader.js";
import { transformFigmaResponse } from "@/adapters/figma-transformer.js";
import { parseFigmaUrl } from "@/adapters/figma-url-parser.js";
import { RULE_CONFIGS } from "@/rules/rule-config.js";

import type {
  CalibrationConfig,
  CalibrationStatus,
} from "./contracts/calibration.js";
import { CalibrationConfigSchema } from "./contracts/calibration.js";
import type { ConversionExecutor } from "./contracts/conversion-agent.js";
import type { NodeIssueSummary } from "./contracts/analysis-agent.js";
import type { ScoreAdjustment, NewRuleProposal } from "./contracts/tuning-agent.js";
import type { MismatchCase } from "./contracts/evaluation-agent.js";
import type { ScoreReport } from "@/core/scoring.js";

import { runAnalysisAgent, extractRuleScores } from "./analysis-agent.js";
import { runConversionAgent } from "./conversion-agent.js";
import { runEvaluationAgent } from "./evaluation-agent.js";
import { runTuningAgent } from "./tuning-agent.js";
import { generateCalibrationReport } from "./report-generator.js";
import { ActivityLogger } from "./activity-logger.js";
import { renderCodeBatch } from "./code-renderer.js";
import {
  generateCalibrationHtmlReport,
  type CalibrationNodeVisual,
} from "@/report-html/calibration-report.js";

export interface CalibrationRunOptions {
  enableActivityLog?: boolean;
  exportHtmlReport?: boolean;
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
  htmlReportPath?: string | undefined;
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

function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

/**
 * Load a Figma file from URL or JSON path
 */
async function loadFile(
  input: string,
  token?: string
): Promise<{ file: AnalysisFile; fileKey: string; nodeId: string | undefined }> {
  if (isJsonFile(input)) {
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    const file = await loadFigmaFileFromJson(filePath);
    return { file, fileKey: file.fileKey, nodeId: undefined };
  }

  if (isFigmaUrl(input)) {
    const { fileKey, nodeId } = parseFigmaUrl(input);
    const figmaToken = token ?? process.env["FIGMA_TOKEN"];
    if (!figmaToken) {
      throw new Error(
        "Figma token required. Provide token or set FIGMA_TOKEN environment variable."
      );
    }
    const client = new FigmaClient({ token: figmaToken });
    const response = await client.getFile(fileKey);
    const file = transformFigmaResponse(fileKey, response);
    return { file, fileKey, nodeId };
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
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
  conversionJson: {
    records: Array<{
      nodeId: string;
      nodePath: string;
      difficulty: string;
      ruleRelatedStruggles: Array<{
        ruleId: string;
        description: string;
        actualImpact: string;
      }>;
      uncoveredStruggles: Array<{
        description: string;
        suggestedCategory: string;
        estimatedImpact: string;
      }>;
    }>;
    skippedNodeIds: string[];
  },
  ruleScores: Record<string, { score: number; severity: string }>
) {
  const evaluationOutput = runEvaluationAgent({
    nodeIssueSummaries: analysisJson.nodeIssueSummaries.map((s) => ({
      nodeId: s.nodeId,
      nodePath: s.nodePath,
      flaggedRuleIds: s.flaggedRuleIds,
    })),
    conversionRecords: conversionJson.records,
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
    convertedNodeCount: conversionJson.records.length,
    skippedNodeCount: conversionJson.skippedNodeIds.length,
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
  const logger = options?.enableActivityLog ? new ActivityLogger() : null;

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

    // Step 2: Select nodes and convert
    stepStart = Date.now();
    const selectedNodes = selectNodes(
      analysisOutput.nodeIssueSummaries,
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

    // Generate HTML calibration report with screenshots (if requested)
    stepStart = Date.now();
    let htmlReportPath: string | undefined;
    if (options?.exportHtmlReport) try {
      // Fetch Figma screenshots
      const figmaToken = parsed.token ?? process.env["FIGMA_TOKEN"];
      const figmaScreenshots = new Map<string, string>();

      if (figmaToken) {
        const client = new FigmaClient({ token: figmaToken });
        const convertedNodeIds = conversionOutput.records.map((r) => r.nodeId);
        if (convertedNodeIds.length > 0) {
          const imageUrls = await client.getNodeImages(fileKey, convertedNodeIds);
          for (const [nid, url] of Object.entries(imageUrls)) {
            if (url) {
              try {
                const base64 = await client.fetchImageAsBase64(url);
                figmaScreenshots.set(nid, base64);
              } catch {
                // Skip failed downloads
              }
            }
          }
        }
      }

      // Render generated code to screenshots via Playwright
      const codeItems = conversionOutput.records.map((r) => ({
        nodeId: r.nodeId,
        generatedCode: r.generatedCode,
      }));
      const renderedScreenshots = await renderCodeBatch(codeItems);

      // Build node visuals for HTML report
      const issuesByNode = new Map<string, CalibrationNodeVisual["issues"]>();
      for (const issue of analysisResult.issues) {
        const nid = issue.violation.nodeId;
        const list = issuesByNode.get(nid);
        const entry = {
          ruleId: issue.rule.definition.id,
          severity: issue.config.severity,
          message: issue.violation.message,
          why: issue.rule.definition.why,
          fix: issue.rule.definition.fix,
        };
        if (list) {
          list.push(entry);
        } else {
          issuesByNode.set(nid, [entry]);
        }
      }

      const nodeVisuals: CalibrationNodeVisual[] = [];
      for (const record of conversionOutput.records) {
        const figma = figmaScreenshots.get(record.nodeId);
        const rendered = renderedScreenshots.get(record.nodeId);
        if (figma && rendered) {
          nodeVisuals.push({
            nodeId: record.nodeId,
            nodePath: record.nodePath,
            figmaScreenshotBase64: figma,
            renderedScreenshotBase64: rendered,
            difficulty: record.difficulty,
            issues: issuesByNode.get(record.nodeId) ?? [],
          });
        }
      }

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const htmlPath = resolve(`reports/calibration-${calTs}.html`);
      const htmlDir = resolve("reports");
      if (!existsSync(htmlDir)) {
        mkdirSync(htmlDir, { recursive: true });
      }

      const htmlReport = generateCalibrationHtmlReport({
        fileName: file.name,
        fileKey,
        analyzedAt: startedAt,
        scoreReport: analysisOutput.scoreReport,
        nodeVisuals,
        adjustments: tuningOutput.adjustments,
        mismatches: evaluationOutput.mismatches,
        validatedRules: evaluationOutput.validatedRules,
      });

      await writeFile(htmlPath, htmlReport, "utf-8");
      htmlReportPath = htmlPath;

      await logger?.logStep({
        step: "HTML Report",
        result: `${nodeVisuals.length} nodes with screenshots, saved to ${htmlPath}`,
        durationMs: Date.now() - stepStart,
      });
    } catch {
      // HTML report generation is non-fatal
      await logger?.logStep({
        step: "HTML Report",
        result: "Skipped — screenshot capture or rendering failed",
        durationMs: Date.now() - stepStart,
      });
    }

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
      htmlReportPath,
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
