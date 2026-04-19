import { upsertCanicodeAnnotation } from "./annotations.js";
import { applyWithInstanceFallback } from "./apply-with-instance-fallback.js";
import type {
  AnnotationProperty,
  CanicodeCategories,
  FigmaGlobal,
  RoundtripQuestion,
  RoundtripResult,
} from "./types.js";

declare const figma: FigmaGlobal;

/**
 * Subset of the analyze-response `issues[]` shape this helper consumes.
 * Mirrors the fields surfaced by `buildResultJson` in `core/engine/scoring.ts`
 * — kept narrow on purpose so a partial / synthesized issue (e.g. a fixture
 * test) can still drive the helper without filling unrelated metadata.
 */
export interface AutoFixIssueInput {
  nodeId: string;
  ruleId: string;
  applyStrategy?: string;
  targetProperty?: string | string[];
  suggestedName?: string;
  sourceChildId?: string;
  annotationProperties?: AnnotationProperty[];
  message?: string;
  nodePath?: string;
  // Allow upstream callers to pass the full McpIssue without a structural
  // mismatch — the helper only reads the named fields.
  [key: string]: unknown;
}

/**
 * Per-issue outcome accumulator (audit scope D follow-up).
 *
 * `outcome` mirrors the emoji vocabulary in `canicode-roundtrip/SKILL.md`
 * Step 4 so the SKILL prose can read structured data instead of asking the
 * LLM to format / re-count emoji bullets:
 *
 * - `🔧` — naming auto-fix succeeded (rename via `applyWithInstanceFallback`,
 *   tier 1 scene write).
 * - `🌐` — `applyWithInstanceFallback` escalated to a definition write
 *   (only possible when the orchestrator passes `allowDefinitionWrite: true`).
 * - `📝` — wrote a Figma annotation (default branch for non-naming rules,
 *   plus the fallback path when `applyWithInstanceFallback` annotates instead
 *   of writing).
 * - `⏭️` — the issue was filtered out (currently only used by `applyAutoFixes`
 *   when an issue's `applyStrategy !== "auto-fix"`; included for shape
 *   symmetry with the other strategies that may emit it).
 *
 * The `nodeName` is the live name of the resolved scene node when available,
 * falling back to the issue's `nodePath` and finally its `nodeId`. `label` is
 * a short human description for surface logging and mirrors
 * `RoundtripResult.label` from Strategies A/B/C.
 */
export type AutoFixOutcomeIcon = "🔧" | "🌐" | "📝" | "⏭️";

export interface AutoFixOutcome {
  outcome: AutoFixOutcomeIcon;
  nodeId: string;
  nodeName: string;
  ruleId: string;
  label: string;
}

export interface ApplyAutoFixContext {
  categories: CanicodeCategories;
  // Forwarded to `applyWithInstanceFallback` for the naming-rule branch so the
  // orchestrator's ADR-012 opt-in flag controls the same tier-2 / tier-3
  // policy as Strategies A and C.
  allowDefinitionWrite?: boolean;
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

function pickNodeName(
  issue: AutoFixIssueInput,
  resolved: { name?: string } | null | undefined
): string {
  if (resolved && typeof resolved.name === "string" && resolved.name.length > 0) {
    return resolved.name;
  }
  if (typeof issue.nodePath === "string" && issue.nodePath.length > 0) {
    // `nodePath` is the breadcrumb (e.g. "Page › Frame › Button") — the last
    // segment is the closest thing to the node's display name we have without
    // a live Figma read.
    const segments = issue.nodePath.split(/\s*[›>/]\s*/);
    const tail = segments[segments.length - 1];
    if (tail && tail.length > 0) return tail;
  }
  return issue.nodeId;
}

function mapInstanceFallbackIcon(
  result: RoundtripResult
): "🔧" | "🌐" | "📝" {
  // Strategy D's naming branch reuses applyWithInstanceFallback's three-tier
  // policy, which returns ✅ / 🌐 / 📝. Translate ✅ to 🔧 because the auto-fix
  // wrap-up template (SKILL Step 4) reserves 🔧 for "auto-fix renamed" — ✅
  // is owned by Strategy A property writes. 🌐 / 📝 pass through unchanged.
  if (result.icon === "✅") return "🔧";
  return result.icon;
}

/**
 * Apply one Strategy D auto-fix issue. Branches on the same
 * `targetProperty === "name" && suggestedName` test the SKILL.md prose used
 * to carry inline:
 *
 * 1. **Naming branch** — rename via `applyWithInstanceFallback` so instance
 *    children share the same tier-1/2/3 policy (and ADR-012 opt-in default)
 *    as Strategy A. A successful scene rename surfaces as 🔧; a
 *    propagated definition write surfaces as 🌐; a fallback annotation surfaces
 *    as 📝.
 * 2. **Annotation branch** — non-naming auto-fixes (`raw-value`,
 *    `missing-interaction-state`, `missing-prototype`, …) record the issue's
 *    `message` directly on the scene node under `categories.flag` so the
 *    designer sees the flag in Dev Mode.
 *
 * The returned `AutoFixOutcome` is the per-issue input the SKILL Step 5
 * tally consumes via `computeRoundtripTally` — `outcome === "🔧" | "🌐"` bumps
 * `stepFourReport.resolved` (or `definitionWritten` for 🌐), `outcome === "📝"`
 * bumps `annotated`, and `outcome === "⏭️"` (only emitted by `applyAutoFixes`
 * for non-auto-fix issues) bumps `skipped`.
 */
export async function applyAutoFix(
  issue: AutoFixIssueInput,
  context: ApplyAutoFixContext
): Promise<AutoFixOutcome> {
  const { categories } = context;
  const ruleId = issue.ruleId;

  // Naming branch — `targetProperty === "name"` plus a pre-computed
  // `suggestedName`. Routes through `applyWithInstanceFallback` so locked /
  // instance-override / external-library nodes annotate cleanly instead of
  // throwing the whole batch.
  if (issue.targetProperty === "name" && typeof issue.suggestedName === "string") {
    const suggestedName = issue.suggestedName;
    const question: RoundtripQuestion = {
      nodeId: issue.nodeId,
      ruleId,
      ...(issue.sourceChildId ? { sourceChildId: issue.sourceChildId } : {}),
    };
    const result = await applyWithInstanceFallback(
      question,
      (target) => {
        if (target) {
          (target as { name: string }).name = suggestedName;
        }
      },
      {
        categories,
        ...(context.allowDefinitionWrite !== undefined
          ? { allowDefinitionWrite: context.allowDefinitionWrite }
          : {}),
        ...(context.telemetry !== undefined
          ? { telemetry: context.telemetry }
          : {}),
      }
    );
    // Re-read the scene name AFTER the write so the outcome reports the
    // post-rename label rather than the pre-rename one. The helper already
    // resolved this node once, but it's an in-memory map lookup in the mock
    // and a cached lookup live (Figma deduplicates `getNodeByIdAsync` calls
    // inside the same batch), so the cost is negligible.
    const sceneAfter = await figma.getNodeByIdAsync(issue.nodeId);
    return {
      outcome: mapInstanceFallbackIcon(result),
      nodeId: issue.nodeId,
      nodeName: pickNodeName(issue, sceneAfter),
      ruleId,
      label: result.label,
    };
  }

  // Annotation branch — record the issue message on the scene node so the
  // designer sees it in Dev Mode under the canicode:flag category.
  const scene = await figma.getNodeByIdAsync(issue.nodeId);
  const markdown = issue.message ?? `Auto-flagged: ${ruleId}`;
  if (scene) {
    upsertCanicodeAnnotation(scene, {
      ruleId,
      markdown,
      categoryId: categories.flag,
      ...(issue.annotationProperties && issue.annotationProperties.length > 0
        ? { properties: issue.annotationProperties }
        : {}),
    });
  }
  return {
    outcome: "📝",
    nodeId: issue.nodeId,
    nodeName: pickNodeName(issue, scene),
    ruleId,
    label: scene
      ? `annotation added to canicode:flag — ${ruleId}`
      : `missing node (annotation skipped) — ${ruleId}`,
  };
}

/**
 * Loop wrapper — filters `issues` to `applyStrategy === "auto-fix"` and
 * applies each one in sequence. Non-auto-fix entries are returned with
 * `outcome === "⏭️"` so the caller can include them in a structured
 * Step 4 report alongside Strategies A/B/C without a separate accumulator.
 *
 * The SKILL Step 4 prose used to inline the filter + branch + ad-hoc
 * question shaping. Per ADR-303 / PR #303 that arithmetic now lives here
 * with vitest coverage.
 */
export async function applyAutoFixes(
  issues: readonly AutoFixIssueInput[],
  context: ApplyAutoFixContext
): Promise<AutoFixOutcome[]> {
  const out: AutoFixOutcome[] = [];
  for (const issue of issues) {
    if (issue.applyStrategy !== "auto-fix") {
      out.push({
        outcome: "⏭️",
        nodeId: issue.nodeId,
        nodeName: pickNodeName(issue, null),
        ruleId: issue.ruleId,
        label: `skipped — applyStrategy is ${issue.applyStrategy ?? "absent"}`,
      });
      continue;
    }
    out.push(await applyAutoFix(issue, context));
  }
  return out;
}
