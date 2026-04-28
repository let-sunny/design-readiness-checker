import { buildIntentionallyUnmappedAnnotationBody } from "./annotation-payload.js";
import { upsertCanicodeAnnotation } from "./annotations.js";
import type { CanicodeCategories, FigmaGlobal, RoundtripResult } from "./types.js";

declare const figma: FigmaGlobal;

export interface ApplyUnmappedComponentOptOutInput {
  nodeId: string;
  ruleId: string;
}

export interface ApplyUnmappedComponentOptOutContext {
  categories: CanicodeCategories;
}

/**
 * ADR-022: write the `unmapped-component` opt-out marker as a canicode
 * annotation on the COMPONENT / COMPONENT_SET node. The body carries the
 * `intent.kind: "rule-opt-out"` payload that `unmapped-component` reads via
 * the acknowledgment pipeline (#371) and short-circuits on next analyze.
 *
 * Differs from Strategy C's standard `upsertCanicodeAnnotation` Q/A path:
 * no prose body, no per-property intent, no replica fan-out. Opt-out is per
 * main component (instance scenes never carry the rule).
 *
 * Idempotent: `upsertCanicodeAnnotation`'s footer-based dedup replaces an
 * existing entry on re-run rather than appending a second one.
 */
export async function applyUnmappedComponentOptOut(
  input: ApplyUnmappedComponentOptOutInput,
  context: ApplyUnmappedComponentOptOutContext
): Promise<RoundtripResult> {
  const { nodeId, ruleId } = input;
  const { categories } = context;
  const scene = await figma.getNodeByIdAsync(nodeId);
  if (!scene) {
    return { icon: "📝", label: `missing node — ${ruleId}` };
  }
  const markdown = buildIntentionallyUnmappedAnnotationBody({
    sceneNodeId: scene.id,
    ruleId,
  });
  upsertCanicodeAnnotation(scene, {
    ruleId,
    markdown,
    categoryId: categories.gotcha,
  });
  return { icon: "📝", label: `opt-out annotation written — ${ruleId}` };
}
