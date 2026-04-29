import { applyComponentize, type ComponentizeResult } from "./apply-componentize.js";
import {
  applyReplaceWithInstance,
  type ReplaceWithInstanceResult,
} from "./apply-replace-with-instance.js";
import type { CanicodeCategories, FigmaGlobal } from "./types.js";

declare const figma: FigmaGlobal;

export type GroupComponentizeOutcome =
  | "componentized-and-swapped"
  | "componentize-failed"
  | "missing-first-member";

export interface GroupComponentizeOptions {
  // Group-shaped gotcha question — emit comes from
  // `missing-component:structure-repetition` (Stage 3, #557 cross-parent
  // pass). `groupMembers[0]` is the document-order first member that gets
  // componentized; `groupMembers[1..]` are the swap targets.
  question: { ruleId: string; groupMembers: readonly string[] };
  // File-wide existing component names — caller computes via
  // `figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] })`
  // before calling. Used by the componentize step's collision suffix
  // (decision C — `Card 2`, `Card 3`, …). The orchestrator does NOT update
  // this set between calls because each Phase 3 batch produces at most one
  // new component name; if a future caller batches multiple groups in one
  // session, it should re-fetch between calls.
  existingComponentNames: ReadonlySet<string>;
  categories?: CanicodeCategories;
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

export interface GroupComponentizeResult {
  outcome: GroupComponentizeOutcome;
  // Always present — even on `componentize-failed` the result carries the
  // annotate-fallback record from `applyComponentize` so the caller can
  // surface why componentize did not happen.
  componentizeResult?: ComponentizeResult;
  // Per-target replace results, in `groupMembers[1..]` order. Empty when
  // componentize did not succeed (we never attempt swap on a failed
  // componentize). Each entry is the full `ReplaceWithInstanceResult` so
  // the caller can render per-target outcome icons.
  replaceResults: ReplaceWithInstanceResult[];
  // Compact human-readable summary for the SKILL's Step 4 apply line —
  // e.g. `componentized "Card", swapped 3/4 siblings (1 free-form parent)`.
  summary: string;
}

function summarizeReplaceCounts(
  results: ReplaceWithInstanceResult[]
): string {
  const total = results.length;
  if (total === 0) return "";
  const replaced = results.filter((r) => r.outcome === "replaced").length;
  const reasons: string[] = [];
  const freeForm = results.filter(
    (r) => r.outcome === "skipped-free-form-parent"
  ).length;
  const prereq = results.filter(
    (r) => r.outcome === "skipped-prereq-missing"
  ).length;
  const error = results.filter((r) => r.outcome === "error").length;
  if (freeForm > 0) reasons.push(`${freeForm} free-form parent`);
  if (prereq > 0) reasons.push(`${prereq} prereq missing`);
  if (error > 0) reasons.push(`${error} error`);
  const tail = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
  return `swapped ${replaced}/${total} siblings${tail}`;
}

/**
 * Phase 3 (#508 / delta 4b) — group componentize orchestrator.
 *
 * Drives the full componentize+swap loop from a single user "yes" answer
 * on a Stage 3 group question. Componentizes the document-order first
 * member, then iterates the rest and swaps each with an instance of the
 * new component. Failures of either primitive route to the existing
 * Strategy C annotate-fallback (already inside each primitive) — this
 * orchestrator only aggregates.
 *
 * Caller responsibility (SKILL Step 4 prose):
 * 1. Fetch the file-wide existing component name set once before calling.
 * 2. Pass `categories` (already ensured at Step 4 entry) so annotate-
 *    fallbacks land in the right Dev Mode category.
 * 3. Render `result.summary` as the per-question Step 4 line.
 *
 * Out of scope (deferred to follow-ups if needed):
 * - Per-member opt-out — caller can pre-filter `groupMembers` before
 *   calling; the orchestrator treats whatever array it gets as canonical.
 * - Reverse case (Stage 1 — `unused-component`, main already exists) —
 *   currently no `groupMembers` is emitted there; revisit when ADR-023
 *   decision D's `mode: "use-existing"` lands.
 */
export async function applyGroupComponentize(
  options: GroupComponentizeOptions
): Promise<GroupComponentizeResult> {
  const { question, existingComponentNames, categories, telemetry } = options;
  const members = question.groupMembers;
  const firstId = members[0];
  if (firstId === undefined) {
    return {
      outcome: "missing-first-member",
      replaceResults: [],
      summary: "group componentize skipped: no members in group",
    };
  }

  const firstNode = await figma.getNodeByIdAsync(firstId);
  if (!firstNode) {
    return {
      outcome: "missing-first-member",
      replaceResults: [],
      summary: `group componentize skipped: first member ${firstId} not found`,
    };
  }

  const componentizeResult = applyComponentize({
    node: firstNode,
    existingComponentNames,
    ruleId: question.ruleId,
    ...(categories !== undefined ? { categories } : {}),
    ...(telemetry !== undefined ? { telemetry } : {}),
  });

  if (componentizeResult.outcome !== "componentized") {
    return {
      outcome: "componentize-failed",
      componentizeResult,
      replaceResults: [],
      summary: `group componentize skipped: ${componentizeResult.label}`,
    };
  }

  const newComponentId = componentizeResult.newComponentId!;
  const swapTargets = members.slice(1);
  const replaceResults: ReplaceWithInstanceResult[] = [];
  for (const targetId of swapTargets) {
    const r = await applyReplaceWithInstance({
      mainComponentId: newComponentId,
      targetNodeId: targetId,
      ruleId: question.ruleId,
      ...(categories !== undefined ? { categories } : {}),
      ...(telemetry !== undefined ? { telemetry } : {}),
    });
    replaceResults.push(r);
  }

  const swapSummary = summarizeReplaceCounts(replaceResults);
  const finalName = componentizeResult.finalName ?? "(unnamed)";
  const summary =
    swapSummary.length > 0
      ? `componentized "${finalName}", ${swapSummary}`
      : `componentized "${finalName}"`;

  return {
    outcome: "componentized-and-swapped",
    componentizeResult,
    replaceResults,
    summary,
  };
}
