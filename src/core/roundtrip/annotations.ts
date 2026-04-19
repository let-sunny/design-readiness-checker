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
// Returns { gotcha, flag, fallback } map of category ids. Idempotent by
// label — re-running in the same file returns the existing ids without
// creating duplicates. Colors must be lowercase; the three documented values
// are used here. The Plugin API supports yellow | orange | red | pink |
// violet | blue | teal | green.
//
// #355 rename: the previous label was `canicode:auto-fix`, which read as
// "canicode auto-fixed something" when it actually meant "canicode auto-flagged
// something it could not fix" (rules in the `annotation` strategy bucket have
// no auto-fix path). The new label `canicode:flag` reads as "flagged for
// designer attention". Pre-rename files already have a `canicode:auto-fix`
// category — when present, expose its id as `legacyAutoFix` so the Step 5
// cleanup filter can sweep old annotations alongside new ones. The new code
// path writes only to `flag`; the old category is read-only on this side.
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
  const result: CanicodeCategories = {
    gotcha: await ensure("canicode:gotcha", "blue"),
    flag: await ensure("canicode:flag", "green"),
    fallback: await ensure("canicode:fallback", "yellow"),
  };
  const legacyAutoFix = byLabel.get("canicode:auto-fix");
  if (legacyAutoFix) result.legacyAutoFix = legacyAutoFix;
  return result;
}

export interface UpsertCanicodeAnnotationInput {
  ruleId: string;
  markdown: string;
  categoryId?: string;
  properties?: AnnotationProperty[];
}

// D2: Upsert a canicode annotation — replace existing by ruleId marker, else
// append. Preserves `categoryId` and `properties` when replacing.
//
// #353 cleanup: the labelMarkdown body no longer leads with `**[canicode]
// <ruleId>**`. The `categoryId` (`canicode:gotcha` / `canicode:flag` /
// `canicode:fallback`) already brands the annotation in Dev Mode, so the
// prefix duplicated the brand and stole 14 characters of body real estate.
// The body now leads with the recommendation directly and ends with an
// italic `— *<ruleId>*` footer. The footer survives prose edits as a
// stable marker for upsert dedup AND grep tooling.
//
// Backwards compat: existing user files still carry the old `**[canicode]
// <ruleId>**` prefix. The findIndex below matches BOTH the new footer and
// the old prefix, so reruns after upgrade replace the old entry in place
// rather than accumulating a duplicate alongside it.
export function upsertCanicodeAnnotation(
  node: FigmaNode | null | undefined,
  input: UpsertCanicodeAnnotationInput
): boolean {
  if (!node || !("annotations" in node)) return false;
  const { ruleId, markdown, categoryId, properties } = input;
  const legacyPrefix = `**[canicode] ${ruleId}**`;
  const footer = `— *${ruleId}*`;
  // Strip a legacy prefix the caller may have re-passed (e.g. via `markdown:
  // existingEntry.labelMarkdown`) so we don't double-encode the rule id.
  let bodyText = markdown;
  if (bodyText.startsWith(legacyPrefix)) {
    bodyText = bodyText.slice(legacyPrefix.length).replace(/^\s*\n+/, "");
  }
  const trimmed = bodyText.replace(/\s+$/, "");
  const body = trimmed.endsWith(footer) ? trimmed : `${trimmed}\n\n${footer}`;
  const existing = stripAnnotations(node.annotations);
  const entry: AnnotationEntry = { labelMarkdown: body };
  if (categoryId) entry.categoryId = categoryId;
  if (properties && properties.length > 0) entry.properties = properties;
  const matchesRuleId = (text: string | undefined): boolean => {
    if (typeof text !== "string") return false;
    return text.startsWith(legacyPrefix) || text.includes(footer);
  };
  const idx = existing.findIndex(
    (a) => matchesRuleId(a.labelMarkdown) || matchesRuleId(a.label)
  );
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
