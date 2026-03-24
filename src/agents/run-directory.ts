import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const CALIBRATION_DIR = "logs/calibration";
const RULE_DISCOVERY_DIR = "logs/rule-discovery";

function getDateTimeString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}${minutes}`;
}

function getDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Extract a short fixture name from a fixture path.
 * e.g. "fixtures/http-design" → "http-design"
 *      "fixtures/http-design/data.json" → "http-design"
 */
export function extractFixtureName(fixturePath: string): string {
  // Remove trailing slash
  const cleaned = fixturePath.replace(/\/+$/, "");
  const last = cleaned.split("/").pop() ?? cleaned;
  // If pointing to data.json, use parent directory name
  if (last === "data.json") {
    const parts = cleaned.split("/");
    return parts[parts.length - 2] ?? last;
  }
  return last.replace(/\.json$/, "");
}

/**
 * Build a run directory name: `<name>--<timestamp>`
 * Double dash separates name from timestamp (names can contain single dashes).
 */
function buildRunDirName(name: string, timestamp: string): string {
  return `${name}--${timestamp}`;
}

/**
 * Parse a run directory name into its components.
 * e.g. "material3-kit--2026-03-24-0200" → { name: "material3-kit", timestamp: "2026-03-24-0200" }
 */
export function parseRunDirName(dirName: string): { name: string; timestamp: string } {
  const idx = dirName.lastIndexOf("--");
  if (idx === -1) {
    return { name: dirName, timestamp: "" };
  }
  return {
    name: dirName.slice(0, idx),
    timestamp: dirName.slice(idx + 2),
  };
}

/**
 * Create a calibration run directory and return its absolute path.
 * Format: `logs/calibration/<fixture-name>--<YYYY-MM-DD-HHMM>/`
 */
export function createCalibrationRunDir(fixtureName: string): string {
  const timestamp = getDateTimeString();
  const dirName = buildRunDirName(fixtureName, timestamp);
  const dirPath = resolve(CALIBRATION_DIR, dirName);
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * Create a rule discovery run directory and return its absolute path.
 * Format: `logs/rule-discovery/<concept-slug>--<YYYY-MM-DD>/`
 */
export function createRuleDiscoveryRunDir(conceptSlug: string): string {
  const timestamp = getDateString();
  const dirName = buildRunDirName(conceptSlug, timestamp);
  const dirPath = resolve(RULE_DISCOVERY_DIR, dirName);
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

/**
 * List all calibration run directories, sorted by name (oldest first).
 */
export function listCalibrationRuns(): string[] {
  const dir = resolve(CALIBRATION_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.includes("--"))
    .map((e) => join(dir, e.name))
    .sort();
}

/**
 * List all rule discovery run directories, sorted by name (oldest first).
 */
export function listRuleDiscoveryRuns(): string[] {
  const dir = resolve(RULE_DISCOVERY_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.includes("--"))
    .map((e) => join(dir, e.name))
    .sort();
}

// --- Fixture discovery ---

const DEFAULT_FIXTURES_DIR = "fixtures";
const DONE_DIR = "done";

/**
 * List active fixture directories (those containing data.json, excluding done/).
 * Returns absolute paths sorted alphabetically.
 */
export function listActiveFixtures(fixturesDir: string = DEFAULT_FIXTURES_DIR): string[] {
  const dir = resolve(fixturesDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== DONE_DIR)
    .map((e) => join(dir, e.name))
    .filter((p) => existsSync(join(p, "data.json")))
    .sort();
}

/**
 * List done fixture directories.
 */
export function listDoneFixtures(fixturesDir: string = DEFAULT_FIXTURES_DIR): string[] {
  const doneDir = resolve(fixturesDir, DONE_DIR);
  if (!existsSync(doneDir)) return [];
  return readdirSync(doneDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(doneDir, e.name))
    .filter((p) => existsSync(join(p, "data.json")))
    .sort();
}

/**
 * Move a fixture to done/.
 * Returns the new path, or null if the fixture doesn't exist.
 */
export function moveFixtureToDone(fixturePath: string, fixturesDir: string = DEFAULT_FIXTURES_DIR): string | null {
  const src = resolve(fixturePath);
  if (!existsSync(src)) return null;
  const name = basename(src);
  const doneDir = resolve(fixturesDir, DONE_DIR);
  mkdirSync(doneDir, { recursive: true });
  const dest = join(doneDir, name);
  renameSync(src, dest);
  return dest;
}

// --- Debate result parsing ---

export interface DebateDecision {
  ruleId: string;
  decision: string;
  before?: number | undefined;
  after?: number | undefined;
  reason?: string | undefined;
}

export interface DebateResult {
  critic: {
    summary: string;
    reviews: Array<{
      ruleId: string;
      decision: string;
      reason?: string | undefined;
      revised?: number | undefined;
    }>;
  } | null;
  arbitrator: {
    summary: string;
    decisions: DebateDecision[];
    newRuleProposals?: unknown[];
  } | null;
  skipped?: string | undefined;
}

/**
 * Parse a debate.json file from a run directory.
 * Returns null if the file doesn't exist or is malformed.
 * Treats debate.json as external input — validates shape defensively.
 */
export function parseDebateResult(runDir: string): DebateResult | null {
  const debatePath = join(runDir, "debate.json");
  if (!existsSync(debatePath)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(debatePath, "utf-8"));
    if (raw === null || typeof raw !== "object") {
      console.debug(`[parseDebateResult] invalid debate format in ${runDir}: expected object, got ${typeof raw}`);
      return null;
    }
    const obj = raw as Record<string, unknown>;
    return {
      critic: (obj["critic"] as DebateResult["critic"]) ?? null,
      arbitrator: (obj["arbitrator"] as DebateResult["arbitrator"]) ?? null,
      ...(typeof obj["skipped"] === "string" ? { skipped: obj["skipped"] } : {}),
    };
  } catch (err) {
    console.debug(`[parseDebateResult] failed to parse debate.json in ${runDir}:`, err);
    return null;
  }
}

/**
 * Extract ruleIds that were applied or revised by the Arbitrator.
 */
function isDecisionRecord(d: unknown): d is { decision?: unknown; ruleId?: unknown } {
  return d !== null && typeof d === "object";
}

export function extractAppliedRuleIds(debate: DebateResult): string[] {
  if (!debate.arbitrator) return [];
  const decisions = debate.arbitrator.decisions;
  if (!Array.isArray(decisions)) return [];
  return decisions
    .filter((d) => {
      if (!isDecisionRecord(d)) return false;
      const dec = String(d.decision ?? "").trim().toLowerCase();
      return dec === "applied" || dec === "revised";
    })
    .map((d) => String(d.ruleId ?? "").trim())
    .filter((id) => id.length > 0);
}

export interface ConvergenceOptions {
  /**
   * When true, converged iff no applied/revised decisions (ignore rejected count).
   * Use when repeated reject loops block `fixture-done` but scores are stable (see issue #14).
   */
  lenient?: boolean | undefined;
}

/**
 * Check if a calibration run has converged.
 * Strict: no applied/revised AND no rejected decisions.
 * Lenient: no applied/revised only (rejected proposals allowed).
 */
export function isConverged(runDir: string, options?: ConvergenceOptions): boolean {
  const debate = parseDebateResult(runDir);
  if (!debate) return false;
  if (debate.skipped) return true; // zero proposals = converged
  if (!debate.arbitrator) return false;
  const decisions = debate.arbitrator.decisions;
  if (!Array.isArray(decisions)) return false;
  const changed = decisions.filter((d) => {
    if (!isDecisionRecord(d)) return false;
    const dec = String(d.decision ?? "").trim().toLowerCase();
    return dec === "applied" || dec === "revised";
  }).length;
  const rejected = decisions.filter((d) => {
    if (!isDecisionRecord(d)) return false;
    const dec = String(d.decision ?? "").trim().toLowerCase();
    return dec === "rejected";
  }).length;
  if (options?.lenient) {
    return changed === 0;
  }
  return changed === 0 && rejected === 0;
}
