/**
 * Deterministic helpers for the `canicode-gotchas` SKILL Step 4b — file-state
 * detection and `## #NNN — ...` section walking under `# Collected Gotchas`.
 *
 * Per ADR-303 / PR #303, deterministic markdown parsing + arithmetic must
 * live in TypeScript with vitest coverage rather than being re-derived from
 * SKILL.md prose on every run. The previous prose described two interacting
 * state machines (4-way file state + monotonic section numbering with
 * substring-matched Design key); a single misread (forgetting zero-padding,
 * matching across the workflow region, etc.) corrupts the user's gotchas
 * file. This module owns both behaviors so the SKILL can either invoke the
 * `canicode upsert-gotcha-section` CLI subcommand or call this helper
 * directly with no algorithm prose left in the SKILL. (#385)
 */
import { z } from "zod";

/**
 * The four discriminable shapes the gotchas SKILL.md file can be in when
 * the workflow tries to upsert a per-design section. The discriminants are
 * the YAML frontmatter fence (`---` on the first line) and the
 * `# Collected Gotchas` H1 heading — both shipped together by the
 * post-#340 `canicode init` install.
 *
 * - `missing`: file does not exist on disk (`content === null`).
 * - `valid`: frontmatter present AND `# Collected Gotchas` heading present.
 * - `missing-heading`: frontmatter present but no Collected Gotchas heading
 *   (older workflow install, or user-edited workflow that dropped the
 *   trailing heading). Recoverable — the upsert will append the heading.
 * - `clobbered`: no frontmatter at all (a pre-#340 single-design overwrite
 *   rewrote the description in the YAML to the per-design variant, leaving
 *   no canonical canicode-gotchas frontmatter behind). Not auto-recoverable
 *   — the SKILL tells the user to run `canicode init --force`.
 */
export const GotchasFileStateSchema = z.enum([
  "missing",
  "valid",
  "missing-heading",
  "clobbered",
]);
export type GotchasFileState = z.infer<typeof GotchasFileStateSchema>;

/** Heading that delimits the per-design region from the workflow region. */
export const COLLECTED_GOTCHAS_HEADING = "# Collected Gotchas";

/** Regex for the per-design section header — captures the zero-padded NNN. */
const SECTION_HEADER_RE = /^## #(\d{3,}) — /gm;

/**
 * Pure inspection of the file's structural shape. Pass `null` when the file
 * does not exist on disk; pass the full UTF-8 contents otherwise.
 */
export function detectGotchasFileState(
  content: string | null,
): GotchasFileState {
  if (content === null) return "missing";
  if (!hasFrontmatter(content)) return "clobbered";
  if (!hasCollectedGotchasHeading(content)) return "missing-heading";
  return "valid";
}

function hasFrontmatter(content: string): boolean {
  // A canicode-init frontmatter starts with `---` on the very first line and
  // is closed by another `---` on its own line. We look for the closing
  // fence anywhere after position 4 — the contents can be multi-line.
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return false;
  }
  const rest = content.slice(4);
  return /^---\s*$/m.test(rest);
}

function hasCollectedGotchasHeading(content: string): boolean {
  return /^# Collected Gotchas\s*$/m.test(content);
}

/**
 * Plan returned by `findOrAppendSection` — describes whether the upsert is
 * a replace (existing section matched by Design key) or an append (new
 * section for an unseen design).
 */
export interface AppendPlan {
  action: "append";
  /** Zero-padded next NNN, e.g. `"001"` on first run, `"004"` after #003. */
  sectionNumber: string;
}
export interface ReplacePlan {
  action: "replace";
  /** Preserved zero-padded NNN of the existing section. */
  sectionNumber: string;
  /**
   * `[start, end)` byte range in the input `content` covering the matched
   * `## #NNN — ...` section, terminated by the next `## #NNN — ` header or
   * end-of-file. The renderer slices these out and substitutes the new
   * section markdown.
   */
  replaceRange: [number, number];
}
export type SectionPlan = AppendPlan | ReplacePlan;

/**
 * Walk the per-design sections under `# Collected Gotchas`, look for one
 * whose `- **Design key**:` bullet substring-matches `designKey`, and
 * return either:
 *
 * - `{ action: "replace", sectionNumber, replaceRange }` when a match is
 *   found (preserves the existing NNN so external references stay stable),
 *   or
 * - `{ action: "append", sectionNumber }` otherwise, with `sectionNumber`
 *   being `(highest existing NNN) + 1`, zero-padded to three digits.
 *
 * Numbering is **monotonic** across deletions — a manually deleted middle
 * section leaves a numeric gap rather than getting reused, mirroring the
 * `.claude/docs/ADR.md` convention.
 *
 * Pass the full file `content`; only the region after the
 * `# Collected Gotchas` heading is scanned, so workflow-region prose that
 * happens to mention the same `Design key` substring will not produce a
 * false replace. When the heading is absent, scanning starts at end-of-file
 * (every call returns an append plan) — combine with
 * `detectGotchasFileState` upstream so the renderer can inject the heading
 * before invoking the helper.
 */
export function findOrAppendSection(
  content: string,
  designKey: string,
): SectionPlan {
  const regionStart = locateCollectedGotchasRegion(content);
  const region = content.slice(regionStart);

  const sections = parseSections(region);

  let maxNumber = 0;
  for (const section of sections) {
    if (section.numericValue > maxNumber) maxNumber = section.numericValue;
    if (sectionMatchesDesignKey(section.body, designKey)) {
      return {
        action: "replace",
        sectionNumber: section.padded,
        replaceRange: [
          regionStart + section.start,
          regionStart + section.end,
        ],
      };
    }
  }

  const next = maxNumber + 1;
  return {
    action: "append",
    sectionNumber: padNumber(next),
  };
}

interface ParsedSection {
  /** The original captured `NNN` string (preserved verbatim on replace). */
  padded: string;
  /** `parseInt(padded, 10)` for max-arithmetic. */
  numericValue: number;
  /** `[start, end)` offsets within the *region* (post-`# Collected Gotchas`). */
  start: number;
  end: number;
  /** Section body text (header + bullets + inner subsections). */
  body: string;
}

function parseSections(region: string): ParsedSection[] {
  const sections: ParsedSection[] = [];
  const matches = [...region.matchAll(SECTION_HEADER_RE)];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i]!;
    const start = match.index!;
    const next = matches[i + 1];
    const end = next?.index ?? region.length;
    const captured = match[1]!;
    sections.push({
      padded: captured,
      numericValue: parseInt(captured, 10),
      start,
      end,
      body: region.slice(start, end),
    });
  }

  return sections;
}

/**
 * Locate the offset where the per-design region begins. We anchor on the
 * line **after** `# Collected Gotchas\n` so subsequent regex matches do not
 * scan workflow-region content. When the heading is absent, the region is
 * empty (`regionStart === content.length`) and every call returns append.
 */
function locateCollectedGotchasRegion(content: string): number {
  const re = /^# Collected Gotchas\s*$/m;
  const match = re.exec(content);
  if (!match) return content.length;
  return match.index + match[0].length;
}

function sectionMatchesDesignKey(body: string, designKey: string): boolean {
  // The bullet shape from the Output Template: `- **Design key**: <value>`.
  // Substring match against the bullet's value preserves the SKILL prose's
  // contract (URL fragments / prefixes still match) without coupling to a
  // specific delimiter.
  const re = /^-\s+\*\*Design key\*\*:\s+(.+?)\s*$/m;
  const m = body.match(re);
  if (!m) return false;
  return m[1]!.includes(designKey);
}

function padNumber(n: number): string {
  return n.toString().padStart(3, "0");
}

/**
 * Renderer that combines `detectGotchasFileState` + `findOrAppendSection`
 * with the actual byte-level replace / append (and missing-heading
 * injection) so callers — the SKILL via the new CLI subcommand, or the
 * SKILL directly with the helper exposed on the gotcha-survey response —
 * never have to do the splice themselves.
 *
 * Returns `null` for unrecoverable states (`missing`, `clobbered`); the
 * caller surfaces the user-facing decision message (the SKILL keeps those
 * since they are interactive responses, not algorithm).
 *
 * For the recoverable states the function produces the new file contents
 * with the per-design section either replaced in place or appended at the
 * bottom. `missing-heading` injects the `# Collected Gotchas` heading
 * before appending — preserving everything above unchanged, exactly as
 * the SKILL prose described.
 */
export interface RenderUpsertedFileResult {
  state: GotchasFileState;
  /** New file contents — `null` when `state` is `missing` or `clobbered`. */
  newContent: string | null;
  /** Plan executed (omitted for non-recoverable states). */
  plan?: SectionPlan;
}

export function renderUpsertedFile(args: {
  currentContent: string | null;
  designKey: string;
  /**
   * Already-rendered per-design section markdown. Must start with
   * `## #{NNN} — ...` and end with a trailing newline. The renderer
   * substitutes the placeholder NNN by string-replacing the literal
   * `{{SECTION_NUMBER}}` token if present, otherwise it trusts the caller
   * to have inserted the right number — see test coverage for both shapes.
   */
  sectionMarkdown: string;
}): RenderUpsertedFileResult {
  const { currentContent, designKey, sectionMarkdown } = args;
  const state = detectGotchasFileState(currentContent);

  if (state === "missing" || state === "clobbered") {
    return { state, newContent: null };
  }

  // From here on, currentContent is non-null (state is "valid" or
  // "missing-heading").
  let working = currentContent as string;

  if (state === "missing-heading") {
    // Preserve everything above unchanged; append the heading at the bottom
    // (with a leading blank line if the file does not already end in two
    // newlines, to keep markdown spacing consistent).
    const sep = working.endsWith("\n\n") ? "" : working.endsWith("\n") ? "\n" : "\n\n";
    working = `${working}${sep}${COLLECTED_GOTCHAS_HEADING}\n`;
  }

  const plan = findOrAppendSection(working, designKey);
  const sectionWithNumber = sectionMarkdown.includes("{{SECTION_NUMBER}}")
    ? sectionMarkdown.replace(/\{\{SECTION_NUMBER\}\}/g, plan.sectionNumber)
    : sectionMarkdown;

  let newContent: string;
  if (plan.action === "replace") {
    const [start, end] = plan.replaceRange;
    const before = working.slice(0, start);
    const after = working.slice(end);
    newContent = `${before}${ensureTrailingNewline(sectionWithNumber)}${after}`;
  } else {
    // Append after a blank line for markdown spacing; use the heading offset
    // so we always anchor inside the per-design region.
    const trimmed = working.replace(/\s+$/, "");
    newContent = `${trimmed}\n\n${ensureTrailingNewline(sectionWithNumber)}`;
  }

  return { state, newContent, plan };
}

function ensureTrailingNewline(s: string): string {
  return s.endsWith("\n") ? s : `${s}\n`;
}
