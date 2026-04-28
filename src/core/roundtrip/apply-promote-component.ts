import { upsertCanicodeAnnotation } from "./annotations.js";
import type {
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
  RoundtripResultIcon,
} from "./types.js";

declare const figma: FigmaGlobal;

// Telemetry event name for promote attempts. Mirrored as a typed constant in
// `src/core/monitoring/events.ts` (`ROUNDTRIP_PROMOTE_COMPONENT`). The literal
// string lives here so the bundled IIFE that runs in the Figma Plugin sandbox
// stays free of `core/monitoring` imports — same pattern as
// `apply-with-instance-fallback.ts`.
const PROMOTE_COMPONENT_EVENT = "cic_roundtrip_promote_component";

export type PromoteOutcome =
  | "promoted"
  | "skipped-inside-instance"
  | "skipped-free-form-parent"
  | "error";

export interface PromoteComponentOptions {
  // The FRAME (or other compatible) node the user agreed to promote.
  node: FigmaNode;
  // Names of components already in the file. Used for collision detection so a
  // colliding promote auto-suffixes the new component with `-promoted` (and
  // numeric suffixes if the suffixed name also collides). The caller computes
  // this set inside the `use_figma` script via
  // `figma.root.findAllWithCriteria({ types: ["COMPONENT", "COMPONENT_SET"] })`
  // — we keep the helper pure so tests do not need a `figma.root` mock.
  existingComponentNames: ReadonlySet<string>;
  // Used as the annotation `ruleId` and reported back in telemetry. The
  // batched gotcha question shape that drives this primitive (delta 4) is not
  // wired yet, so callers pass the source rule id (`missing-component`) for
  // now.
  ruleId: string;
  categories?: CanicodeCategories;
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

export interface PromoteComponentResult {
  icon: RoundtripResultIcon;
  label: string;
  outcome: PromoteOutcome;
  newComponentId?: string;
  finalName?: string;
  // True iff `existingComponentNames` already contained the input node's name
  // and the promote (or annotate-fallback) recorded the suffixed alternative.
  // Surfaces in telemetry props and in the gotcha answer markdown so the
  // designer sees `Card → Card-promoted` instead of a silent rename.
  nameCollisionResolved?: boolean;
}

// ADR-024 / #368: walks `node.parent` upward looking for any INSTANCE
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

// ADR-024 decision A: refuse promote+swap on a free-form parent (no Auto
// Layout) because the post-swap position carryover would silently mangle
// coordinates the designer cannot recover. Auto Layout parents slot the new
// instance in the original position automatically.
function isFreeFormParent(node: FigmaNode): boolean {
  const parent = node.parent;
  if (!parent) return true;
  const layoutMode = parent["layoutMode"];
  return layoutMode === undefined || layoutMode === "NONE";
}

// ADR-024 decision C: when `node.name` already exists in
// `existingComponentNames`, promote under `<name>-promoted`. If that also
// collides, append `-2`, `-3`, etc. The original node name is left untouched
// for the annotation diagnostic; only the promoted component's `name` shifts.
function resolveFinalName(
  desired: string,
  existing: ReadonlySet<string>
): { finalName: string; collisionResolved: boolean } {
  if (!existing.has(desired)) {
    return { finalName: desired, collisionResolved: false };
  }
  const base = `${desired}-promoted`;
  if (!existing.has(base)) {
    return { finalName: base, collisionResolved: true };
  }
  let counter = 2;
  while (existing.has(`${base}-${counter}`)) counter++;
  return { finalName: `${base}-${counter}`, collisionResolved: true };
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
 * Phase 3 (#508 / ADR-024) — promote primitive.
 *
 * Wraps `figma.createComponentFromNode(node)` with three guards:
 *   1. instance-child guard (#368) — refuses if any ancestor is INSTANCE.
 *   2. free-form parent guard (decision A) — refuses if parent has no Auto
 *      Layout, because position carryover after the sibling swap (delta 2)
 *      would silently break the layout.
 *   3. error catch — converts a thrown `createComponentFromNode` into an
 *      annotate-fallback result instead of aborting the `use_figma` batch.
 *
 * On any rejection the source FRAME gets a Strategy C `canicode:flag`
 * annotation naming the rejection reason so the designer can see why the
 * promote did not happen and either restructure or override the decision in
 * a follow-up roundtrip pass.
 *
 * The companion `apply-replace-with-instance` primitive (delta 2) consumes
 * `result.newComponentId` and replaces the remaining sibling FRAMEs with
 * instances of the promoted component.
 */
export function applyPromoteComponent(
  options: PromoteComponentOptions
): PromoteComponentResult {
  const { node, existingComponentNames, ruleId, categories, telemetry } =
    options;

  if (isInsideInstance(node)) {
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Promote skipped — node is inside an INSTANCE subtree.**\n\n` +
        `Re-running ${ruleId} promote on a node inside an instance would ` +
        `either throw or destructively detach the surrounding instance ` +
        `(see roundtrip-protocol.md:286). Move the source frame outside the ` +
        `instance, or detach the parent instance intentionally before promoting.`
    );
    telemetry?.(PROMOTE_COMPONENT_EVENT, {
      ruleId,
      outcome: "skipped-inside-instance" as PromoteOutcome,
    });
    return {
      icon: "📝",
      label: "promote skipped: inside instance",
      outcome: "skipped-inside-instance",
    };
  }

  if (isFreeFormParent(node)) {
    annotateFallback(
      node,
      ruleId,
      categories,
      `**Promote skipped — parent has no Auto Layout.**\n\n` +
        `Promoting and swapping siblings under a free-form parent would ` +
        `require manual coordinate carryover that can mangle layout ` +
        `silently (ADR-024 decision A). Wrap the duplicates in an Auto ` +
        `Layout frame first, or promote one of them manually.`
    );
    telemetry?.(PROMOTE_COMPONENT_EVENT, {
      ruleId,
      outcome: "skipped-free-form-parent" as PromoteOutcome,
    });
    return {
      icon: "📝",
      label: "promote skipped: free-form parent",
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
      `**Promote skipped — \`figma.createComponentFromNode\` unavailable.**\n\n` +
        `The Plugin API host did not expose the promote primitive in this ` +
        `session. The FRAME has been flagged so the next roundtrip can retry.`
    );
    telemetry?.(PROMOTE_COMPONENT_EVENT, {
      ruleId,
      outcome: "error" as PromoteOutcome,
      reason: "createComponentFromNode-missing",
    });
    return {
      icon: "📝",
      label: "promote skipped: createComponentFromNode unavailable",
      outcome: "error",
    };
  }

  try {
    const promoted = create.call(figma, node);
    // The Plugin API returns a NEW component node; rename it to the resolved
    // final name in case decision C added a suffix. Reassignment guards the
    // case where `name` is read-only on a frozen mock — we proceed without
    // raising so the test envelope can still verify telemetry + ids.
    try {
      (promoted as { name: string }).name = finalName;
    } catch {
      // Mock frozen `name`; silently keep whatever the host assigned.
    }
    telemetry?.(PROMOTE_COMPONENT_EVENT, {
      ruleId,
      outcome: "promoted" as PromoteOutcome,
      nameCollisionResolved: collisionResolved,
    });
    const result: PromoteComponentResult = {
      icon: "✅",
      label: collisionResolved
        ? `promoted as "${finalName}" (renamed from collision)`
        : `promoted as "${finalName}"`,
      outcome: "promoted",
      newComponentId: promoted.id,
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
      `**Promote failed — \`createComponentFromNode\` threw.**\n\n` +
        `Error: \`${msg}\`. The FRAME has been flagged so the designer can ` +
        `inspect the structure (locked layer, unsupported child mix, etc.) ` +
        `before the next roundtrip pass.`
    );
    telemetry?.(PROMOTE_COMPONENT_EVENT, {
      ruleId,
      outcome: "error" as PromoteOutcome,
      reason: msg,
    });
    return {
      icon: "📝",
      label: `promote failed: ${msg}`,
      outcome: "error",
    };
  }
}
