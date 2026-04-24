import type { AnalysisResult, AnalysisIssue } from "../engine/rule-engine.js";
import type { ScoreReport } from "../engine/scoring.js";
import { isReadyForCodeGen } from "../engine/scoring.js";
import type { Grade } from "../engine/scoring.js";
import type {
  GotchaSurvey,
  GotchaSurveyQuestion,
  InstanceContext,
} from "../contracts/gotcha-survey.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type { RuleId } from "../contracts/rule.js";
import { GOTCHA_QUESTIONS } from "../rules/gotcha-questions.js";
import { getRulePurpose } from "../rules/rule-config.js";
import {
  isInstanceChildNodeId,
  parseInstanceChildNodeId,
} from "../adapters/instance-id-parser.js";
import { computeApplyContext } from "./apply-context.js";
import { groupAndBatchSurveyQuestions } from "./group-and-batch-questions.js";

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
  options: { designKey?: string; codegenReadyMinGrade?: Grade } = {},
): GotchaSurvey {
  const grade = scores.overall.grade;

  // Step 1: Filter to gotcha-relevant issues.
  // - `blocking` + `risk`: violation rules where the user needs to describe
  //   how to resolve the violation (existing behavior).
  // - `missing-info` + purpose `info-collection` (#406): annotation-primary
  //   rules like `missing-prototype` / `missing-interaction-state` where the
  //   gotcha IS the output. Without this, info-collection rules would never
  //   reach the survey because their penalty is intentionally minimal.
  // `suggestion` severity still stays out — it's prose-level advice, not an
  // implementation gap Figma can't encode.
  const relevantIssues = result.issues.filter((issue) => {
    const severity = issue.config.severity;
    if (severity === "blocking" || severity === "risk") return true;
    if (severity === "missing-info") {
      return getRulePurpose(issue.violation.ruleId) === "info-collection";
    }
    return false;
  });

  // Step 2: Deduplicate — same ruleId on siblings (same parent path) → keep first
  const deduped = deduplicateSiblingIssues(relevantIssues);

  // Step 3: Sort — blocking first, then risk; within same severity, preserve traversal order
  const sorted = stableSortBySeverity(deduped);

  // Step 4: Map to survey questions
  const mapped = sorted
    .map((issue) => mapToQuestion(issue, result.file))
    .filter((q): q is GotchaSurveyQuestion => q !== null);

  // Step 5 (#356): collapse N instance-child questions that share the same
  // `(sourceComponentId, sourceNodeId, ruleId)` tuple into ONE question that
  // names the source component. Apply step iterates the merged
  // `replicaNodeIds` so every replica still gets the answer; this saves the
  // user from answering the same question N times when the answer is single-
  // valued (e.g. 7 FILL children of `Platform=Desktop` all need the same
  // max-width). Cross-source-component dedupe is intentionally not done —
  // different source components stay separate.
  const questions = deduplicateBySourceComponent(mapped);

  // Step 6 (#369, #370, #381): pre-compute the grouped+batched view so the
  // SKILLs (`canicode-gotchas`, `canicode-roundtrip`) can iterate over it
  // directly without re-implementing sort / partition / batchable-rule
  // logic in prose. ADR-016.
  const groupedQuestions = groupAndBatchSurveyQuestions(questions);

  // Step 7 (#428): compute the threshold hint for the `allowDefinitionWrite`
  // picker. Count questions that target instance children — these are the only
  // candidates that benefit from definition-level writes. When fewer than 3
  // propagation candidates exist, surfacing the picker is over-engineered;
  // the skill silently uses the annotation default (ADR-012).
  const PROPAGATION_CANDIDATE_THRESHOLD = 3;
  const propagationCandidates = questions.filter(
    (q) => q.isInstanceChild,
  ).length;
  const suggestedDefaultApply =
    propagationCandidates >= PROPAGATION_CANDIDATE_THRESHOLD;

  return {
    designGrade: grade,
    isReadyForCodeGen: isReadyForCodeGen(grade, options.codegenReadyMinGrade),
    questions,
    groupedQuestions,
    designKey: options.designKey ?? "",
    suggestedDefaultApply,
  };
}

/**
 * Deduplicate issues where the same ruleId fires on multiple children of the
 * same parent. Keeps the first occurrence (preserving traversal order).
 *
 * #373: skip instance-child issues here. They are routed to the
 * source-component dedupe in Step 5, which preserves dropped scene ids on
 * `replicaNodeIds` so the apply step can fan the answer out to every replica.
 * The pre-#373 behaviour collapsed sibling instance children (e.g. `Title` +
 * `Subtitle` on the same `Card` instance — different definition nodes, same
 * `Card` parent path, same ruleId) into a single question and lost the
 * dropped scenes entirely (no `replicaNodeIds`, no annotation, no write).
 * Source-component dedupe naturally keeps different `sourceNodeId`s separate,
 * so the previously-dropped siblings now surface as their own questions.
 */
function deduplicateSiblingIssues(issues: AnalysisIssue[]): AnalysisIssue[] {
  const seen = new Set<string>();
  const result: AnalysisIssue[] = [];

  for (const issue of issues) {
    if (isInstanceChildNodeId(issue.violation.nodeId)) {
      result.push(issue);
      continue;
    }
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
 * Stable sort: blocking → risk → missing-info, preserving original array
 * order within each group. `missing-info` is surfaced only for
 * info-collection rules (#406), placed last because their penalty is
 * minimal; fix-describe questions for actual violations take priority.
 */
function stableSortBySeverity(issues: AnalysisIssue[]): AnalysisIssue[] {
  const blocking: AnalysisIssue[] = [];
  const risk: AnalysisIssue[] = [];
  const missingInfo: AnalysisIssue[] = [];

  for (const issue of issues) {
    if (issue.config.severity === "blocking") {
      blocking.push(issue);
    } else if (issue.config.severity === "missing-info") {
      missingInfo.push(issue);
    } else {
      risk.push(issue);
    }
  }

  return [...blocking, ...risk, ...missingInfo];
}

/**
 * Map an AnalysisIssue to a GotchaSurveyQuestion using the GOTCHA_QUESTIONS table.
 * Returns null if no mapping exists for the ruleId.
 */
function mapToQuestion(
  issue: AnalysisIssue,
  file: AnalysisFile,
): GotchaSurveyQuestion | null {
  const ruleId = issue.violation.ruleId as RuleId;
  const template = GOTCHA_QUESTIONS[ruleId];
  if (!template) return null;

  const nodeName = getNodeName(issue.violation.nodePath);
  const instanceContext = buildInstanceContext(issue.violation.nodeId, file);
  const applyContext = computeApplyContext(
    issue.violation,
    instanceContext ?? undefined,
  );
  const suggestedName = issue.violation.suggestedName;

  return {
    nodeId: issue.violation.nodeId,
    nodeName,
    ruleId,
    detection: template.detection,
    outputChannel: template.outputChannel,
    persistenceIntent: template.persistenceIntent,
    purpose: getRulePurpose(issue.violation.ruleId),
    severity: issue.config.severity,
    question: template.question.replace("{nodeName}", nodeName),
    hint: template.hint,
    example: template.example,
    ...(instanceContext ? { instanceContext } : {}),
    applyStrategy: applyContext.applyStrategy,
    ...(applyContext.targetProperty !== undefined
      ? { targetProperty: applyContext.targetProperty }
      : {}),
    ...(applyContext.annotationProperties !== undefined
      ? { annotationProperties: applyContext.annotationProperties }
      : {}),
    ...(suggestedName !== undefined ? { suggestedName } : {}),
    isInstanceChild: applyContext.isInstanceChild,
    ...(applyContext.sourceChildId !== undefined
      ? { sourceChildId: applyContext.sourceChildId }
      : {}),
  };
}

/**
 * Collapse questions that share the same `(sourceComponentId, sourceNodeId,
 * ruleId)` tuple. When N instance-child questions all point at the same
 * definition node inside the same source component for the same rule, the
 * answer is single-valued by definition (FILL children of `Platform=Desktop`
 * all need the same max-width) — so emit ONE question instead of N. The kept
 * question is the FIRST in the input order; subsequent matches are dropped
 * but their `nodeId`s are preserved on `replicaNodeIds` so the apply step can
 * iterate every instance scene node and land the answer on all of them.
 *
 * Out of scope: cross-source-component dedupe (e.g. "Title" missing-size-
 * constraint in 5 different components). Different sourceComponentIds always
 * stay separate.
 *
 * Questions without an `instanceContext` (or without both `sourceComponentId`
 * and `sourceNodeId`) are NOT touched — they pass through with no replicas
 * fields. This keeps non-instance-child questions and any partial-context
 * survivors behaving exactly as they did pre-#356.
 */
function deduplicateBySourceComponent(
  questions: GotchaSurveyQuestion[],
): GotchaSurveyQuestion[] {
  const groups = new Map<string, GotchaSurveyQuestion[]>();
  const order: string[] = [];
  let uniqueCounter = 0;

  for (const q of questions) {
    const ic = q.instanceContext;
    let key: string;
    if (ic && ic.sourceComponentId && ic.sourceNodeId) {
      key = `${ic.sourceComponentId}::${ic.sourceNodeId}::${q.ruleId}`;
    } else {
      // Non-deduplicable — assign a unique key so the question passes through
      // unchanged. Using a counter keeps insertion order stable.
      key = `__unique__${uniqueCounter++}`;
    }
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(q);
    } else {
      groups.set(key, [q]);
      order.push(key);
    }
  }

  return order.map((key) => {
    const group = groups.get(key)!;
    const first = group[0]!;
    if (group.length === 1) return first;

    const otherIds = group.slice(1).map((q) => q.nodeId);
    const sourceComponentName = first.instanceContext?.sourceComponentName;

    // Re-substitute `{nodeName}` with the source component name so the user-
    // facing question reads "for Platform=Desktop" instead of "for Title"
    // (the first instance's node name). Falls back silently when the source
    // component name was not resolved (rare — happens when the parent
    // instance's componentId is not in `file.components`).
    const template = GOTCHA_QUESTIONS[first.ruleId as RuleId];
    const renamed: GotchaSurveyQuestion = {
      ...first,
      replicas: group.length,
      replicaNodeIds: otherIds,
    };
    if (sourceComponentName) {
      renamed.nodeName = sourceComponentName;
      if (template) {
        renamed.question = template.question.replace(
          "{nodeName}",
          sourceComponentName,
        );
      }
    }
    return renamed;
  });
}

/**
 * Build instance context for a node id when it lives inside an instance.
 * Resolves source component name via the parent instance's componentId when
 * the parent is reachable in the analyzed subtree; falls back to the bare
 * parent/source ids otherwise so the apply pipeline can still resolve the
 * source component at runtime via `figma.getNodeById`.
 */
function buildInstanceContext(
  nodeId: string,
  file: AnalysisFile,
): InstanceContext | null {
  const parts = parseInstanceChildNodeId(nodeId);
  if (!parts) return null;

  const parentInstance = findNodeById(file.document, parts.parentInstanceId);
  const componentId = parentInstance?.componentId;
  const componentName = componentId ? file.components[componentId]?.name : undefined;

  return {
    parentInstanceNodeId: parts.parentInstanceId,
    sourceNodeId: parts.sourceNodeId,
    ...(componentId ? { sourceComponentId: componentId } : {}),
    ...(componentName ? { sourceComponentName: componentName } : {}),
  };
}

/**
 * Walk the document tree for a node id (exact match — no `-`/`:` normalization;
 * instance node ids natively use `:` and the input here is already in that form).
 */
function findNodeById(node: AnalysisNode, id: string): AnalysisNode | null {
  if (node.id === id) return node;
  if (node.children) {
    for (const child of node.children) {
      const found = findNodeById(child, id);
      if (found) return found;
    }
  }
  return null;
}
