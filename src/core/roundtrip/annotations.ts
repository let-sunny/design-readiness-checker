import type {
  AnnotationEntry,
  AnnotationProperty,
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
} from "./types.js";

declare const figma: FigmaGlobal;

// D1: Figma readback populates BOTH `label` and `labelMarkdown` on every entry,
// but writes accept only ONE. Strip to the non-empty field before spreading.
// Entries where neither field has content are dropped — they cannot round-trip
// through the write validator.
export function stripAnnotations(
  annotations: readonly AnnotationEntry[] | undefined | null
): AnnotationEntry[] {
  const input = annotations ?? [];
  const out: AnnotationEntry[] = [];
  for (const a of input) {
    const hasLM =
      typeof a.labelMarkdown === "string" && a.labelMarkdown.length > 0;
    const hasLabel = typeof a.label === "string" && a.label.length > 0;
    if (!hasLM && !hasLabel) continue;
    const base: AnnotationEntry = hasLM
      ? { labelMarkdown: a.labelMarkdown as string }
      : { label: a.label as string };
    if (a.categoryId) base.categoryId = a.categoryId;
    if (Array.isArray(a.properties) && a.properties.length > 0) {
      base.properties = a.properties;
    }
    out.push(base);
  }
  return out;
}

// D4: File-scoped custom categories. Run once per roundtrip (Step 4.0).
// Returns { gotcha, autoFix, fallback } map of category ids. Idempotent by
// label — re-running in the same file returns the existing ids without
// creating duplicates. Colors must be lowercase; the three documented values
// are used here. The Plugin API supports yellow | orange | red | pink |
// violet | blue | teal | green.
export async function ensureCanicodeCategories(): Promise<CanicodeCategories> {
  const api = figma.annotations;
  const existing = await api.getAnnotationCategoriesAsync();
  const byLabel = new Map(existing.map((c) => [c.label, c.id]));
  async function ensure(label: string, color: string): Promise<string> {
    const cached = byLabel.get(label);
    if (cached) return cached;
    const created = await api.addAnnotationCategoryAsync({ label, color });
    byLabel.set(label, created.id);
    return created.id;
  }
  return {
    gotcha: await ensure("canicode:gotcha", "blue"),
    autoFix: await ensure("canicode:auto-fix", "green"),
    fallback: await ensure("canicode:fallback", "yellow"),
  };
}

export interface UpsertCanicodeAnnotationInput {
  ruleId: string;
  markdown: string;
  categoryId?: string;
  properties?: AnnotationProperty[];
}

// D2: Upsert a canicode annotation — replace existing by ruleId prefix, else
// append. Preserves `categoryId` and `properties` when replacing. Match covers
// both `labelMarkdown` (current format) and `label` (pre-D1 legacy entries) so
// reruns across versions consolidate instead of accumulating.
export function upsertCanicodeAnnotation(
  node: FigmaNode | null | undefined,
  input: UpsertCanicodeAnnotationInput
): boolean {
  if (!node || !("annotations" in node)) return false;
  const { ruleId, markdown, categoryId, properties } = input;
  const prefix = `**[canicode] ${ruleId}**`;
  const body = markdown.startsWith(prefix) ? markdown : `${prefix}\n\n${markdown}`;
  const existing = stripAnnotations(node.annotations);
  const entry: AnnotationEntry = { labelMarkdown: body };
  if (categoryId) entry.categoryId = categoryId;
  if (properties && properties.length > 0) entry.properties = properties;
  const idx = existing.findIndex((a) => {
    const lm = a.labelMarkdown;
    const lb = a.label;
    return (
      (typeof lm === "string" && lm.startsWith(prefix)) ||
      (typeof lb === "string" && lb.startsWith(prefix))
    );
  });
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  try {
    (node as unknown as { annotations: AnnotationEntry[] }).annotations = existing;
    return true;
  } catch (e) {
    // Experiment 09: `properties` types are node-type-gated. The canonical
    // error is "Invalid property X for a FRAME/TEXT node" — retry without
    // `properties` only when the message matches, so unrelated errors
    // (permission, read-only, API changes) still surface.
    const msg = String((e as { message?: unknown })?.message ?? e);
    const isNodeTypeReject = /invalid property .+ for a .+ node/i.test(msg);
    if (!entry.properties || !isNodeTypeReject) throw e;
    delete entry.properties;
    if (idx >= 0) existing[idx] = entry;
    (node as unknown as { annotations: AnnotationEntry[] }).annotations = existing;
    return true;
  }
}
