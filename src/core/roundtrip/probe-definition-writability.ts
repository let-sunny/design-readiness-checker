import type { FigmaGlobal, FigmaNode, RoundtripQuestion } from "./types.js";

declare const figma: FigmaGlobal;

// #357: Pre-flight probe surfaced in Step 4 BEFORE the Definition write
// picker. When all candidate source components live in an external library
// (`mainComponent.remote === true`, Experiment 10) or are unresolved
// (`mainComponent === null`, Experiment 11 — the unshared library reference
// case unit-test-locked in ADR-011 Verification), opting into definition
// writes is structurally a no-op — every write would throw
// "Cannot write to internal and read-only node" and the helper would
// fall through to scene annotation regardless. Surfacing this UP-FRONT
// turns the picker into "annotation is the only viable choice on this
// file" instead of "you opted in, why did I get annotations?" wasted-
// decision moment.
//
// The probe deliberately mirrors the same writability detection as the
// runtime fallback in `apply-with-instance-fallback.ts` so the picker
// branch and the actual apply behaviour cannot diverge — if the runtime
// would annotate, the probe would predict it.

export interface DefinitionWritabilityProbe {
  // Distinct candidate source child ids inspected (deduped — many questions
  // may target the same source child, e.g. when #356 collapsed N replicas).
  totalCount: number;
  // Subset that resolved to a remote (read-only) source component
  // (`remote === true`) OR resolved to null (Experiment 11 unshared library
  // reference). Both branches end at the annotation fallback at runtime.
  unwritableCount: number;
  // Display names (or sourceChildId fallback) of the unwritable source
  // components, deduped, in first-seen order — for the picker copy.
  unwritableSourceNames: string[];
  // True when EVERY candidate is unwritable. Picker should drop the opt-in
  // branch and offer only "annotate / cancel".
  allUnwritable: boolean;
  // True when SOME but not all candidates are unwritable. Picker can show
  // the split count notice.
  partiallyUnwritable: boolean;
}

type ProbeInput = Pick<
  RoundtripQuestion,
  "sourceChildId" | "instanceContext" | "ruleId"
>;

export async function probeDefinitionWritability(
  questions: readonly ProbeInput[],
): Promise<DefinitionWritabilityProbe> {
  // Map<sourceChildId, "writable" | "unwritable">. Using a Map (not Set) so
  // we visit each source child id at most once even if N replicas share it.
  const verdict = new Map<string, "writable" | "unwritable">();
  const unwritableNames: string[] = [];
  const seenName = new Set<string>();

  for (const q of questions) {
    const id = q.sourceChildId;
    if (!id) continue;
    if (verdict.has(id)) continue;
    const node = await figma.getNodeByIdAsync(id);
    // `sourceChildId` resolves to the child node INSIDE the source component
    // (TEXT / FRAME / etc.), not the component itself. The `.remote`
    // property only exists on InstanceNode / ComponentNode / ComponentSetNode
    // — on anything else it is `undefined` so a direct `node.remote === true`
    // check would silently classify every candidate as writable. Walk up to
    // the containing COMPONENT/COMPONENT_SET and read `.remote` from there.
    // Falls back to the bare `node.remote` field when the node itself does
    // expose it (defensive — covers the case where `sourceChildId` happens to
    // point at a component rather than a child) so the existing all-local /
    // all-remote tests with `{ remote: true }` on the top node still pass.
    const writability = resolveWritability(node);
    const isUnwritable = writability.isUnwritable;
    verdict.set(id, isUnwritable ? "unwritable" : "writable");
    if (isUnwritable) {
      const name =
        (typeof writability.componentName === "string" &&
          writability.componentName) ||
        (typeof node?.name === "string" && node.name) ||
        q.instanceContext?.sourceComponentName ||
        id;
      if (!seenName.has(name)) {
        seenName.add(name);
        unwritableNames.push(name);
      }
    }
  }

  const totalCount = verdict.size;
  let unwritableCount = 0;
  for (const v of verdict.values()) if (v === "unwritable") unwritableCount++;

  return {
    totalCount,
    unwritableCount,
    unwritableSourceNames: unwritableNames,
    allUnwritable: totalCount > 0 && unwritableCount === totalCount,
    partiallyUnwritable:
      unwritableCount > 0 && unwritableCount < totalCount,
  };
}

interface WritabilityVerdict {
  isUnwritable: boolean;
  componentName?: string;
}

function resolveWritability(node: FigmaNode | null): WritabilityVerdict {
  // Plugin API contract (Experiment 11 / ADR-011): `getNodeByIdAsync` resolves
  // to `null` when the source definition is unreachable from this file. Same
  // routing as the runtime fallback — treat as unwritable.
  if (node === null) return { isUnwritable: true };

  // If `.remote` is observable on the node directly (it IS on Component /
  // ComponentSet / Instance), trust it.
  if ("remote" in node && typeof node.remote === "boolean") {
    return { isUnwritable: node.remote === true };
  }

  // Otherwise the node is a child of a component (TEXT / FRAME / etc.). Walk
  // up until we hit the containing COMPONENT or COMPONENT_SET and read
  // `.remote` from there.
  const containing = findContainingComponent(node);
  if (!containing) {
    // No containing component reachable — best-effort default to writable so
    // the runtime fallback (Experiment 10 catch path) still has a chance to
    // fire if it turns out to be remote at write time.
    return { isUnwritable: false };
  }
  const isUnwritable =
    "remote" in containing && containing.remote === true;
  return {
    isUnwritable,
    ...(isUnwritable && typeof containing.name === "string"
      ? { componentName: containing.name }
      : {}),
  };
}

function findContainingComponent(node: FigmaNode): FigmaNode | null {
  let cur: FigmaNode | null | undefined = node;
  // Bound the walk to keep us safe against accidental cycles in mocked trees;
  // production design trees rarely exceed a few dozen levels.
  for (let i = 0; i < 100 && cur; i++) {
    if (cur.type === "COMPONENT" || cur.type === "COMPONENT_SET") return cur;
    cur = cur.parent ?? null;
  }
  return null;
}
