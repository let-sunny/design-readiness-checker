import { upsertCanicodeAnnotation } from "./annotations.js";
import type {
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
  RoundtripResultIcon,
} from "./types.js";

declare const figma: FigmaGlobal;

// Telemetry event name for replace-with-instance attempts. Mirrored as a
// typed constant in `src/core/monitoring/events.ts`
// (`ROUNDTRIP_REPLACE_WITH_INSTANCE`). The literal lives here so the bundled
// IIFE that runs in the Figma Plugin sandbox stays free of `core/monitoring`
// imports — same pattern as `apply-componentize.ts`.
const REPLACE_EVENT = "cic_roundtrip_replace_with_instance";

export type ReplaceOutcome =
  | "replaced"
  | "skipped-free-form-parent"
  | "skipped-prereq-missing"
  | "error";

export interface ReplaceWithInstanceOptions {
  // The id of the main component to instantiate. Typically the
  // `newComponentId` returned from a successful `applyComponentize` call in
  // the same Phase 3 batch, but any COMPONENT or COMPONENT_SET id is valid.
  mainComponentId: string;
  // The id of the FRAME to replace. The FRAME is removed after a successful
  // swap; on any rejection the FRAME stays in place with a `canicode:flag`
  // annotation describing the reason.
  targetNodeId: string;
  // Used as the annotation `ruleId` and reported back in telemetry.
  ruleId: string;
  categories?: CanicodeCategories;
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

export interface ReplaceWithInstanceResult {
  icon: RoundtripResultIcon;
  label: string;
  outcome: ReplaceOutcome;
  newInstanceId?: string;
}

// ADR-023 decision A (delta 2 clarification): the swap-site parent must have
// Auto Layout. The componentize-side guard does not transitively cover swap
// targets in different parents — every replace call independently checks its
// own target's parent.
function isFreeFormParent(parent: FigmaNode | null | undefined): boolean {
  if (!parent) return true;
  const layoutMode = parent["layoutMode"];
  return layoutMode === undefined || layoutMode === "NONE";
}

function annotateFallback(
  node: FigmaNode | null | undefined,
  ruleId: string,
  categories: CanicodeCategories | undefined,
  body: string
): void {
  if (!node || !categories) return;
  upsertCanicodeAnnotation(node, {
    ruleId,
    markdown: body,
    categoryId: categories.flag,
  });
}

function isComponentLike(type: string | undefined): boolean {
  return type === "COMPONENT" || type === "COMPONENT_SET";
}

/**
 * Phase 3 (#508 / ADR-023, #554) — replace-with-instance primitive.
 *
 * Pairs with `applyComponentize` (delta 1, #552): after a FRAME is
 * componentized, this primitive swaps each remaining sibling FRAME with an
 * instance of the new main component, preserving the original index in the
 * parent's children so layout order stays stable.
 *
 * Guards (every rejection routes to a `canicode:flag` annotation on the
 * original FRAME — the FRAME stays in place so the designer can inspect):
 *   1. Target / main / parent presence — the four `prereq-missing` branches.
 *   2. Main is a COMPONENT or COMPONENT_SET (not another FRAME, etc.).
 *   3. Free-form parent (decision A) — refuses if `parent.layoutMode` is
 *      `undefined` or `"NONE"`. Auto Layout repositions the new instance at
 *      the original index automatically; free-form would need explicit
 *      x/y/width/height carryover that ADR-023 A refuses.
 *   4. Plugin-API throw on `createInstance` / `insertChild` / `remove`.
 *
 * On success the original FRAME is removed and any annotations it carried
 * vanish with it — this is intentional. A successful swap means the gotcha
 * is resolved (the slot now holds an instance of the agreed main); a stale
 * `canicode:flag` annotation would confuse the next analyze pass.
 */
export async function applyReplaceWithInstance(
  options: ReplaceWithInstanceOptions
): Promise<ReplaceWithInstanceResult> {
  const { mainComponentId, targetNodeId, ruleId, categories, telemetry } =
    options;

  const [target, main] = await Promise.all([
    figma.getNodeByIdAsync(targetNodeId),
    figma.getNodeByIdAsync(mainComponentId),
  ]);

  if (!target) {
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-prereq-missing" as ReplaceOutcome,
      reason: "target-missing",
    });
    return {
      icon: "📝",
      label: `replace skipped: target node ${targetNodeId} missing`,
      outcome: "skipped-prereq-missing",
    };
  }

  if (!main) {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — main component \`${mainComponentId}\` not found.**\n\n` +
        `The componentize step (delta 1) likely failed earlier in this ` +
        `batch, or the main was deleted between componentize and swap. The ` +
        `FRAME has been flagged so the next roundtrip pass can re-derive ` +
        `the group.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-prereq-missing" as ReplaceOutcome,
      reason: "main-missing",
    });
    return {
      icon: "📝",
      label: `replace skipped: main ${mainComponentId} missing`,
      outcome: "skipped-prereq-missing",
    };
  }

  if (!isComponentLike(main.type)) {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — \`${mainComponentId}\` is not a COMPONENT.**\n\n` +
        `Resolved to a \`${main.type}\` node. Phase 3's swap step requires ` +
        `the main to be a \`COMPONENT\` or \`COMPONENT_SET\`. Check that ` +
        `componentize ran cleanly on the source frame before this call.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-prereq-missing" as ReplaceOutcome,
      reason: "main-not-component",
      resolvedType: main.type,
    });
    return {
      icon: "📝",
      label: `replace skipped: main is ${main.type}, not COMPONENT`,
      outcome: "skipped-prereq-missing",
    };
  }

  if (target.id === main.id) {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — target and main are the same node.**\n\n` +
        `This usually means the componentize source was passed in the swap ` +
        `set by mistake. The componentize source becomes the main; only the ` +
        `remaining sibling FRAMEs should be swapped.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-prereq-missing" as ReplaceOutcome,
      reason: "target-is-main",
    });
    return {
      icon: "📝",
      label: "replace skipped: target equals main",
      outcome: "skipped-prereq-missing",
    };
  }

  const parent = target.parent;
  if (!parent) {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — target has no parent.**\n\n` +
        `Cannot insert a new instance for an orphaned node. The FRAME has ` +
        `been flagged; no swap performed.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-prereq-missing" as ReplaceOutcome,
      reason: "no-parent",
    });
    return {
      icon: "📝",
      label: "replace skipped: no parent",
      outcome: "skipped-prereq-missing",
    };
  }

  if (isFreeFormParent(parent)) {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — parent has no Auto Layout.**\n\n` +
        `Swapping a sibling FRAME with an instance under a free-form parent ` +
        `would require explicit coordinate carryover that can mangle layout ` +
        `silently (ADR-023 decision A). Wrap the duplicates in an Auto ` +
        `Layout frame first, then re-run the roundtrip.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "skipped-free-form-parent" as ReplaceOutcome,
    });
    return {
      icon: "📝",
      label: "replace skipped: free-form parent",
      outcome: "skipped-free-form-parent",
    };
  }

  const create = main.createInstance;
  if (typeof create !== "function") {
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace skipped — \`createInstance\` unavailable on main.**\n\n` +
        `The Plugin API host did not expose \`createInstance\` on the ` +
        `resolved main (\`${main.type}\`). The FRAME has been flagged so ` +
        `the next roundtrip can retry once the host catches up.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "error" as ReplaceOutcome,
      reason: "createInstance-missing",
    });
    return {
      icon: "📝",
      label: "replace skipped: createInstance unavailable",
      outcome: "error",
    };
  }

  try {
    const instance = create.call(main);
    const siblings = parent.children ?? [];
    const idx = siblings.findIndex((s) => s.id === target.id);
    const insert = parent.insertChild;
    const append = parent.appendChild;
    if (idx >= 0 && typeof insert === "function") {
      insert.call(parent, idx, instance);
    } else if (typeof append === "function") {
      // No matching index (target isn't in `parent.children`?) or no
      // `insertChild` — fall back to append. Auto Layout still owns final
      // position; we just lose the original ordering, which is recoverable
      // by the designer if it matters.
      append.call(parent, instance);
    } else {
      throw new Error(
        "parent exposes neither insertChild nor appendChild — cannot insert instance"
      );
    }
    if (typeof target.remove === "function") {
      target.remove();
    } else {
      throw new Error("target node missing `remove` — cannot detach old FRAME");
    }
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "replaced" as ReplaceOutcome,
    });
    return {
      icon: "✅",
      label: `replaced with instance of "${main.name}"`,
      outcome: "replaced",
      newInstanceId: instance.id,
    };
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    annotateFallback(
      target,
      ruleId,
      categories,
      `**Replace failed — Plugin API threw.**\n\n` +
        `Error: \`${msg}\`. The FRAME has been flagged so the designer can ` +
        `inspect (locked layer, parent restrictions, etc.) before the next ` +
        `roundtrip pass.`
    );
    telemetry?.(REPLACE_EVENT, {
      ruleId,
      outcome: "error" as ReplaceOutcome,
      reason: msg,
    });
    return {
      icon: "📝",
      label: `replace failed: ${msg}`,
      outcome: "error",
    };
  }
}
