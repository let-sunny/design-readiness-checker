import type { Acknowledgment } from "../contracts/acknowledgment.js";
import type {
  AnnotationEntry,
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
} from "./types.js";

declare const figma: FigmaGlobal;

// Stable markers planted by `upsertCanicodeAnnotation` so re-analyze can
// recognise canicode-authored annotations and treat the underlying issue as
// `acknowledged: true` (#371).
//
// - **New format (post-#353)** — the body always ends with the italic
//   footer `— *<ruleId>*` (literal em-dash + space + asterisks). Anchor to
//   end so a single annotation that mentions multiple rules in prose
//   doesn't generate phantom matches mid-body.
// - **Legacy format (pre-#353)** — older roundtrip runs left the body
//   leading with `**[canicode] <ruleId>**`. Anchor to start for the same
//   reason.
const FOOTER_RE = /—\s+\*([A-Za-z0-9-]+)\*\s*$/;
const LEGACY_PREFIX_RE = /^\*\*\[canicode\]\s+([A-Za-z0-9-]+)\*\*/;

/**
 * Pure synchronous helper. Inspects one node's annotations and returns the
 * `(nodeId, ruleId)` pairs that look like canicode-authored acknowledgments.
 *
 * Behaviour:
 * - When `canicodeCategoryIds` is provided, an entry must BOTH carry a
 *   `categoryId` in that set AND have a recognisable footer/prefix to count.
 *   This is the production path — the categoryId guard prevents
 *   false-positives from user-written annotations whose prose happens to end
 *   with an italic kebab-case word.
 * - When `canicodeCategoryIds` is omitted, footer/prefix matching alone is
 *   sufficient. Useful for unit tests and for sessions that haven't loaded
 *   the category map yet.
 *
 * Returns one acknowledgment per recognised entry. A node with multiple
 * canicode annotations (different ruleIds on the same node) yields multiple
 * acknowledgments.
 */
export function extractAcknowledgmentsFromNode(
  node: FigmaNode | null | undefined,
  canicodeCategoryIds?: ReadonlySet<string>
): Acknowledgment[] {
  if (!node || !("annotations" in node)) return [];
  const annotations = (node.annotations ?? []) as readonly AnnotationEntry[];
  if (annotations.length === 0) return [];

  const out: Acknowledgment[] = [];
  for (const a of annotations) {
    const text =
      (typeof a.labelMarkdown === "string" && a.labelMarkdown.length > 0
        ? a.labelMarkdown
        : "") ||
      (typeof a.label === "string" && a.label.length > 0 ? a.label : "");
    if (!text) continue;

    if (canicodeCategoryIds) {
      if (!a.categoryId || !canicodeCategoryIds.has(a.categoryId)) continue;
    }

    const ruleId = extractRuleId(text);
    if (!ruleId) continue;

    out.push({ nodeId: node.id, ruleId });
  }
  return out;
}

function extractRuleId(text: string): string | null {
  const footer = FOOTER_RE.exec(text);
  if (footer) return footer[1] ?? null;
  const legacy = LEGACY_PREFIX_RE.exec(text);
  if (legacy) return legacy[1] ?? null;
  return null;
}

/**
 * Async tree walker — runs INSIDE a `use_figma` batch. Loads the root node
 * via `figma.getNodeByIdAsync`, recurses through `children`, and accumulates
 * one `(nodeId, ruleId)` per recognised canicode annotation.
 *
 * Pass the categories from `ensureCanicodeCategories()` so the walker can
 * gate on `categoryId` instead of footer text alone — see the pure helper
 * above for the rationale.
 *
 * Returns an empty array when the root node cannot be resolved (e.g.
 * stale id from a previous session). Errors thrown by individual node
 * reads are swallowed so one bad node doesn't abort the whole sweep.
 */
export async function readCanicodeAcknowledgments(
  rootNodeId: string,
  categories?: CanicodeCategories | undefined
): Promise<Acknowledgment[]> {
  const root = await figma.getNodeByIdAsync(rootNodeId);
  if (!root) return [];

  const canicodeCategoryIds = categories
    ? new Set(
        [
          categories.gotcha,
          categories.flag,
          categories.fallback,
          categories.legacyAutoFix,
        ].filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    : undefined;

  const out: Acknowledgment[] = [];
  walk(root, canicodeCategoryIds, out);
  return out;
}

// Plugin API exposes `children` as a throwing getter on TEXT/VECTOR and other
// leaf nodes (issue #421) — isolate the access so the walk doesn't crash.
function safeChildren(node: FigmaNode): readonly FigmaNode[] {
  try {
    const c = (node as { children?: unknown }).children;
    return Array.isArray(c) ? (c as FigmaNode[]) : [];
  } catch {
    return [];
  }
}

function walk(
  node: FigmaNode,
  canicodeCategoryIds: ReadonlySet<string> | undefined,
  out: Acknowledgment[]
): void {
  try {
    const local = extractAcknowledgmentsFromNode(node, canicodeCategoryIds);
    for (const a of local) out.push(a);
  } catch {
    // Annotation reads can throw on locked / external nodes; swallow so the
    // sweep covers as much of the subtree as possible.
  }
  for (const child of safeChildren(node)) {
    if (child && typeof child === "object") walk(child, canicodeCategoryIds, out);
  }
}
