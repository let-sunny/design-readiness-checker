import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute, sep } from "node:path";

/**
 * Parses Code Connect mapping declarations from a project's `figma.config.json`
 * `include` paths so the `unmapped-component` rule can skip components that
 * already carry a mapping (#526 sub-task 1).
 *
 * v1.5 contract — light-touch:
 *   - Source of truth is `figma.config.json` `include` (Code Connect's own
 *     declared file scope; we don't invent our own include syntax).
 *   - We scan matched files for the simple `figma.connect(...)` URL form and
 *     extract the `node-id` query param. That's the canonical pattern Figma
 *     ships in its docs and what every example in their repo uses.
 *   - We do NOT resolve component imports, follow re-exports, or evaluate
 *     anything — purely lexical regex over file text. Cross-file resolution
 *     and library-mapping support are explicitly out of scope per #526.
 *
 * Parsing failures (missing config, malformed JSON, unreadable files) are
 * non-fatal: the parser returns an empty set so the rule degrades to v1
 * behaviour (fire on every component) rather than blocking analysis.
 */
/**
 * Structured skip reasons. Consumers (e.g. coverage metric) branch on these
 * rather than substring-matching the human message in `skippedReason`.
 *
 *   - `no-config`        — `figma.config.json` is absent in cwd. Signals "Code
 *                          Connect not adopted" → coverage metric is suppressed.
 *   - `malformed-config` — file exists but JSON.parse failed. Treated as
 *                          adoption-with-misconfiguration: emit coverage as 0/N.
 *   - `no-includes`      — config has no `codeConnect.include` paths. Same
 *                          treatment as `malformed-config` (adopted but empty).
 */
export type CodeConnectSkipReason =
  | "no-config"
  | "malformed-config"
  | "no-includes";

export interface CodeConnectMappingResult {
  /** Set of Figma node IDs (canonical `:` form, e.g. `3384:3`) with a mapping declaration found. */
  mappedNodeIds: Set<string>;
  /** Files that were scanned. Useful for debugging "nothing matched" cases. */
  scannedFiles: string[];
  /** Structured skip reason for branching logic. */
  skipReason?: CodeConnectSkipReason;
  /** Human-readable skip reason, mirrors `skipReason` but with file paths/details. */
  skippedReason?: string;
}

const FIGMA_CONFIG_FILENAME = "figma.config.json";
const FIGMA_CONNECT_FILE_GLOB = /\.figma\.(tsx?|jsx?)$/;
const NODE_ID_QUERY_RE = /[?&]node-id=([0-9A-Za-z%:\-_]+)/;

interface FigmaConfigShape {
  codeConnect?: {
    include?: string[];
  };
  // Fallback for projects with the older flat shape.
  include?: string[];
}

export function parseCodeConnectMappings(cwd: string): CodeConnectMappingResult {
  const configPath = join(cwd, FIGMA_CONFIG_FILENAME);
  if (!existsSync(configPath)) {
    return {
      mappedNodeIds: new Set(),
      scannedFiles: [],
      skipReason: "no-config",
      skippedReason: `${FIGMA_CONFIG_FILENAME} not found at ${cwd}`,
    };
  }

  let config: FigmaConfigShape;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as FigmaConfigShape;
  } catch (err) {
    return {
      mappedNodeIds: new Set(),
      scannedFiles: [],
      skipReason: "malformed-config",
      skippedReason: `malformed ${FIGMA_CONFIG_FILENAME}: ${(err as Error).message}`,
    };
  }

  const includes = config.codeConnect?.include ?? config.include ?? [];
  if (includes.length === 0) {
    return {
      mappedNodeIds: new Set(),
      scannedFiles: [],
      skipReason: "no-includes",
      skippedReason: `${FIGMA_CONFIG_FILENAME} has no codeConnect.include paths`,
    };
  }

  const candidateFiles = new Set<string>();
  for (const includePattern of includes) {
    for (const file of resolveInclude(cwd, includePattern)) {
      candidateFiles.add(file);
    }
  }

  const mappedNodeIds = new Set<string>();
  const scannedFiles: string[] = [];
  for (const file of candidateFiles) {
    scannedFiles.push(file);
    let contents: string;
    try {
      contents = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    for (const nodeId of extractNodeIdsFromSource(contents)) {
      mappedNodeIds.add(nodeId);
    }
  }

  return { mappedNodeIds, scannedFiles };
}

/**
 * Resolve a single `include` entry to a list of files on disk.
 *
 * Supports the two patterns Code Connect's own docs use most frequently:
 *   - A directory path (recursively scanned for `*.figma.tsx?` / `*.figma.jsx?`).
 *   - A glob with a `**` segment + a trailing `*.figma.{tsx,ts,jsx,js}` filename
 *     pattern (very common in Code Connect example configs).
 *
 * Non-matching globs (e.g. brace expansion, character classes) fall back to
 * directory-walk semantics rooted at the literal portion of the path. This is
 * intentionally simple so we don't pull in a glob dependency for what is
 * meant to be a low-risk lint helper.
 */
function resolveInclude(cwd: string, includePattern: string): string[] {
  const results: string[] = [];
  const absolute = isAbsolute(includePattern)
    ? includePattern
    : resolve(cwd, includePattern);

  // Walk back from the pattern to find the literal root we can walk.
  // Drop any segment containing `*`, `?`, `{`, or `[`.
  const segments = absolute.split(sep);
  let firstGlobIdx = segments.findIndex((s) => /[*?{[]/.test(s));
  if (firstGlobIdx === -1) {
    // No glob — could be a file or a directory. Treat both.
    if (existsSync(absolute)) {
      const stat = statSync(absolute);
      if (stat.isFile() && FIGMA_CONNECT_FILE_GLOB.test(absolute)) {
        results.push(absolute);
      } else if (stat.isDirectory()) {
        walkDir(absolute, results);
      }
    }
    return results;
  }

  const rootSegments = segments.slice(0, firstGlobIdx);
  const root = rootSegments.length === 0 ? sep : rootSegments.join(sep);
  if (!existsSync(root)) return results;
  const rootStat = statSync(root);
  if (!rootStat.isDirectory()) return results;
  walkDir(root, results);
  // Filter to files within the absolute pattern's prefix. We don't enforce the
  // post-glob portion strictly because the file extension filter does the
  // heavy lifting — Code Connect declarations only live in `*.figma.{tsx,ts,jsx,js}`.
  const prefix = rootSegments.join(sep) + sep;
  return results.filter((f) => f.startsWith(prefix) || rootSegments.length === 0);
}

function walkDir(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walkDir(full, out);
    } else if (stat.isFile() && FIGMA_CONNECT_FILE_GLOB.test(full)) {
      out.push(full);
    }
  }
}

/**
 * Extract canonical Figma node IDs from `figma.connect(...)` URL arguments.
 *
 * Recognises any URL fragment containing `node-id=...` (the Figma URL form
 * uses `-`, the canonical internal form uses `:`). Returns the canonical
 * (`:`) form to match the rule's `node.id` comparison.
 */
export function extractNodeIdsFromSource(source: string): Set<string> {
  const nodeIds = new Set<string>();
  const re = new RegExp(NODE_ID_QUERY_RE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const raw = match[1];
    if (!raw) continue;
    const decoded = safeDecode(raw);
    nodeIds.add(decoded.replace(/-/g, ":"));
  }
  return nodeIds;
}

function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
