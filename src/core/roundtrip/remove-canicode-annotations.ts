/**
 * Predicate + filter for sweeping canicode-authored annotations off a node.
 *
 * The Step 5 cleanup loop in `canicode-roundtrip/SKILL.md` used to inline
 * this filter as a JS one-liner inside the `use_figma` batch — `(a => !(a.categoryId
 * && canicodeIds.has(a.categoryId)) && !a.labelMarkdown?.startsWith("**[canicode]"))`.
 * That counted as deterministic logic re-derived by the LLM each session
 * (and the legacy-prefix branch already broke once when ADR-353 dropped
 * the `**[canicode]` prefix) so it now lives here with vitest coverage,
 * per ADR-016.
 *
 * The contract:
 * - Strip every annotation whose `categoryId` is in the canicode-owned
 *   category set (`gotcha`, `flag`, `fallback`, plus the legacy
 *   `legacyAutoFix` when present on this file from a pre-#355 roundtrip).
 *   `categoryId` is the durable canicode-side identifier — the body no
 *   longer carries a `[canicode]` prefix per #353, so the categoryId guard
 *   is the primary signal.
 * - Also strip annotations whose body still starts with the legacy
 *   `**[canicode]` prefix — these survive on files that have not been
 *   re-roundtripped since #353. Keeping the prefix branch lets one
 *   sweep handle both shapes.
 * - Preserve every other annotation (user-authored notes, third-party
 *   plugins, etc.) verbatim.
 */

interface CanicodeCategoriesLike {
  gotcha?: string;
  flag?: string;
  fallback?: string;
  legacyAutoFix?: string;
}

interface AnnotationLike {
  categoryId?: string | undefined;
  labelMarkdown?: string | undefined;
}

const LEGACY_CANICODE_PREFIX = "**[canicode]";

/**
 * Returns true when this annotation was authored by canicode (Step 4
 * Strategy C / D / fallback) and should be removed by the Step 5 cleanup.
 */
export function isCanicodeAnnotation(
  annotation: AnnotationLike,
  categories: CanicodeCategoriesLike,
): boolean {
  const canicodeIds = new Set(
    [
      categories.gotcha,
      categories.flag,
      categories.fallback,
      categories.legacyAutoFix,
    ].filter((id): id is string => Boolean(id)),
  );

  if (annotation.categoryId && canicodeIds.has(annotation.categoryId)) {
    return true;
  }

  if (annotation.labelMarkdown?.startsWith(LEGACY_CANICODE_PREFIX)) {
    return true;
  }

  return false;
}

/**
 * Filter helper — returns the input annotations array with every
 * canicode-authored entry removed. Use after `stripAnnotations` has
 * normalised the D1 label/labelMarkdown mutex.
 */
export function removeCanicodeAnnotations<T extends AnnotationLike>(
  annotations: readonly T[],
  categories: CanicodeCategoriesLike,
): T[] {
  return annotations.filter((a) => !isCanicodeAnnotation(a, categories));
}
