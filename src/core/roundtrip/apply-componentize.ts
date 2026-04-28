import { upsertCanicodeAnnotation } from "./annotations.js";
import type {
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
  RoundtripResultIcon,
} from "./types.js";

declare const figma: FigmaGlobal;

// Telemetry event name for componentize attempts. Mirrored as a typed
// constant in `src/core/monitoring/events.ts` (`ROUNDTRIP_COMPONENTIZE`).
// The literal string lives here so the bundled IIFE that runs in the Figma
// Plugin sandbox stays free of `core/monitoring` imports — same pattern as
// `apply-with-instance-fallback.ts`.
const COMPONENTIZE_EVENT = "cic_roundtrip_componentize";

export type ComponentizeOutcome =
  | "componentized"
  | "skipped-inside-instance"
  | "skipped-free-form-parent"
  | "error";

export interface ComponentizeOptions {
  // The FRAME (or other compatible) node the user agreed to componentize.
  node: FigmaNode;
  // Names of components already in the file. Used for collision detection so a
  // colliding componentize auto-suffixes the new component with `<name> 2`
  // (and ` 3`, ` 4`, … if those also collide). The caller computes this set
  // inside the `use_figma` script via
  // `figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] })`
  // — we keep the helper pure so tests do not need a `figma.root` mock. Note
  // that the suffix is updated in-place per call: if you componentize multiple
  // siblings in one batch, add the new name to the set before the next call
  // or two siblings will collide on the same suffix.
  existingComponentNames: ReadonlySet<string>;
  // Used as the annotation `ruleId` and reported back in telemetry. The
  // batched gotcha question shape that drives this primitive (delta 4) is not
  // wired yet, so callers pass the source rule id (`missing-component`) for
  // now.
  ruleId: string;
  categories?: CanicodeCategories;
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

export interface ComponentizeResult {
  icon: RoundtripResultIcon;
  label: string;
  outcome: ComponentizeOutcome;
  newComponentId?: string;
  finalName?: string;
  // True iff `existingComponentNames` already contained the input node's name
  // and the call resolved to a numeric-suffixed alternative. Surfaces in
  // telemetry props and in the gotcha answer markdown so the designer sees
  // `Card → Card 2` instead of a silent rename.
  nameCollisionResolved?: boolean;
}

// ADR-023 / #368: walks `node.parent` upward looking for any INSTANCE
// ancestor. `createComponentFromNode` on a node inside an instance subtree
// either throws or destructively detaches the parent instance (documented in
// `docs/roundtrip-protocol.md:286`) — neither is acceptable, so the guard
// rejects up front and the caller routes to Strategy C annotate-fallback.
function isInsideInstance(node: FigmaNode): boolean {
  let current: FigmaNode | null | undefined = node.parent;
  while (current) {
    if (current.type === "INSTANCE") return true;
    current = current.parent;
  }
  return false;
}

// ADR-023 decision A: refuse componentize on a free-form parent (no Auto
// Layout) because the post-swap position carryover would silently mangle
// coordinates the designer cannot recover. Auto Layout parents slot the new
// instance in the original position automatically.
function isFreeFormParent(node: FigmaNode): boolean {
  const parent = node.parent;
  if (!parent) return true;
  const layoutMode = parent["layoutMode"];
  return layoutMode === undefined || layoutMode === "NONE";
}

// ADR-023 decision C: when `node.name` already exists in
// `existingComponentNames`, componentize under `<name> 2` (Figma's native
// duplicate-name pattern). If `<name> 2` also collides, walk up to ` 3`,
// ` 4`, etc. The original FRAME's `name` is left untouched; only the new
// component's `name` is the suffixed value. Returning the resolved name lets
// the caller surface the rename in the gotcha answer.
function resolveFinalName(
  desired: string,
  existing: ReadonlySet<string>
): { finalName: string; collisionResolved: boolean } {
  if (!existing.has(desired)) {
    return { finalName: desired, collisionResolved: false };
  }
  let counter = 2;
  while (existing.has(`${desired} ${counter}`)) counter++;
  return { finalName: `${desired} ${counter}`, collisionResolved: true };
}

function annotateFallback(
  node: FigmaNode,
  ruleId: string,
  categories: CanicodeCategories | undefined,
  body: string
): void {
  if (!categories) return;
  upsertCanicodeAnnotation(node, {
    ruleId,
    markdown: body,
    categoryId: categories.flag,
  });
}

/**
 * Phase 3 (#508 / ADR-023) — componentize primitive.
 *
 * Wraps `figma.createComponentFromNode(node)` (Figma's "Create component"
 * action) with three guards:
 *   1. instance-child guard (#368) — refuses if any ancestor is INSTANCE.
 *   2. free-form parent guard (decision A) — refuses if parent has no Auto
 *      Layout, because position carryover after the sibling swap (delta 2)
 *      would silently break the layout.
 *   3. error catch — converts a thrown `createComponentFromNode` into an
 *      annotate-fallback result instead of aborting the `use_figma` batch.
 *
 * On any rejection the source FRAME gets a Strategy C `canicode:flag`
 * annotation naming the rejection reason so the designer can see why the
 * componentize did not happen and either restructure or override the
 * decision in a follow-up roundtrip pass.
 *
 * The companion `apply-replace-with-instance` primitive (delta 2) consumes
 * `result.newComponentId` and replaces the remaining sibling FRAMEs with
 * instances of the new component.
 */
export function applyComponentize(
  options: ComponentizeOptions
): ComponentizeResult {
  const { node, existingComponentNames, ruleId, categories, telemetry } =
    options;

  if (isInsideInstance(node)) {
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Componentize skipped — node is inside an INSTANCE subtree.**\n\n` +
        `Re-running ${ruleId} componentize on a node inside an instance ` +
        `would either throw or destructively detach the surrounding ` +
        `instance (see roundtrip-protocol.md:286). Move the source frame ` +
        `outside the instance, or detach the parent instance intentionally ` +
        `before componentizing.`
    );
    telemetry?.(COMPONENTIZE_EVENT, {
      ruleId,
      outcome: "skipped-inside-instance" as ComponentizeOutcome,
    });
    return {
      icon: "📝",
      label: "componentize skipped: inside instance",
      outcome: "skipped-inside-instance",
    };
  }

  if (isFreeFormParent(node)) {
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Componentize skipped — parent has no Auto Layout.**\n\n` +
        `Componentizing and swapping siblings under a free-form parent ` +
        `would require manual coordinate carryover that can mangle layout ` +
        `silently (ADR-023 decision A). Wrap the duplicates in an Auto ` +
        `Layout frame first, then re-run the roundtrip.`
    );
    telemetry?.(COMPONENTIZE_EVENT, {
      ruleId,
      outcome: "skipped-free-form-parent" as ComponentizeOutcome,
    });
    return {
      icon: "📝",
      label: "componentize skipped: free-form parent",
      outcome: "skipped-free-form-parent",
    };
  }

  const desiredName = typeof node.name === "string" ? node.name : "Component";
  const { finalName, collisionResolved } = resolveFinalName(
    desiredName,
    existingComponentNames
  );

  const create = figma.createComponentFromNode;
  if (typeof create !== "function") {
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Componentize skipped — \`figma.createComponentFromNode\` unavailable.**\n\n` +
        `The Plugin API host did not expose the Create component primitive ` +
        `in this session. The FRAME has been flagged so the next roundtrip ` +
        `can retry.`
    );
    telemetry?.(COMPONENTIZE_EVENT, {
      ruleId,
      outcome: "error" as ComponentizeOutcome,
      reason: "createComponentFromNode-missing",
    });
    return {
      icon: "📝",
      label: "componentize skipped: createComponentFromNode unavailable",
      outcome: "error",
    };
  }

  try {
    const created = create.call(figma, node);
    // Figma's "Create component" action returns a NEW component node;
    // overwrite `name` to the resolved final name so decision C's collision
    // suffix applies. Real Plugin API `ComponentNode.name` is writable, so no
    // try/catch — a frozen mock surfaces as a test failure, which is the
    // signal we want.
    (created as { name: string }).name = finalName;
    telemetry?.(COMPONENTIZE_EVENT, {
      ruleId,
      outcome: "componentized" as ComponentizeOutcome,
      nameCollisionResolved: collisionResolved,
    });
    const result: ComponentizeResult = {
      icon: "✅",
      label: collisionResolved
        ? `componentized as "${finalName}" (renamed from collision)`
        : `componentized as "${finalName}"`,
      outcome: "componentized",
      newComponentId: created.id,
      finalName,
    };
    if (collisionResolved) result.nameCollisionResolved = true;
    return result;
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Componentize failed — \`createComponentFromNode\` threw.**\n\n` +
        `Error: \`${msg}\`. The FRAME has been flagged so the designer can ` +
        `inspect the structure (locked layer, unsupported child mix, etc.) ` +
        `before the next roundtrip pass.`
    );
    telemetry?.(COMPONENTIZE_EVENT, {
      ruleId,
      outcome: "error" as ComponentizeOutcome,
      reason: msg,
    });
    return {
      icon: "📝",
      label: `componentize failed: ${msg}`,
      outcome: "error",
    };
  }
}
