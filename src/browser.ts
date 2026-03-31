// Browser entry point — exports analysis functions for client-side use
// All imports here must be pure functions with no Node.js dependencies

export { version as VERSION } from "../package.json";
export { analyzeFile } from "./core/engine/rule-engine.js";
export type { AnalysisResult, AnalysisIssue, RuleFailure, RuleEngineOptions } from "./core/engine/rule-engine.js";
export { calculateScores, formatScoreSummary, getCategoryLabel, getSeverityLabel, gradeToClassName } from "./core/engine/scoring.js";
export type { ScoreReport, CategoryScoreResult, Grade } from "./core/engine/scoring.js";
export { transformFigmaResponse, transformFileNodesResponse } from "./core/adapters/figma-transformer.js";
export { parseFigmaUrl, buildFigmaDeepLink, toCommentableNodeId } from "./core/adapters/figma-url-parser.js";
export type { FigmaUrlInfo } from "./core/adapters/figma-url-parser.js";
export { CATEGORIES, CATEGORY_LABELS } from "./core/contracts/category.js";
export type { Category } from "./core/contracts/category.js";
export { SEVERITY_LABELS } from "./core/contracts/severity.js";
export type { Severity } from "./core/contracts/severity.js";
export type { AnalysisFile, AnalysisNode } from "./core/contracts/figma-node.js";
export type { RuleId } from "./core/contracts/rule.js";

// Shared UI constants and helpers (used by app/shared via CanICode.* globals)
export {
  GAUGE_R,
  GAUGE_C,
  CATEGORY_DESCRIPTIONS,
  SEVERITY_ORDER,
} from "./core/ui-constants.js";
export {
  gaugeColor,
  scoreClass,
  escapeHtml,
  severityDot,
  severityBadge,
  scoreBadgeStyle,
  renderGaugeSvg,
} from "./core/ui-helpers.js";

// Report rendering (shared with web/plugin)
export { renderReportBody, initReportInteractions } from "./core/report-html/render.js";
export type { ReportData } from "./core/report-html/render.js";

// Import rules to register them with the global registry
import "./core/rules/index.js";
