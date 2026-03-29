import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { z } from "zod";

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

// --- Debate result parsing (Zod-validated) ---

const DebateDecisionSchema = z.object({
  ruleId: z.string(),
  decision: z.string(),
  before: z.number().optional(),
  after: z.number().optional(),
  reason: z.string().optional(),
}).passthrough();

const CriticSchema = z.object({
  summary: z.string(),
  reviews: z.array(z.object({
    ruleId: z.string(),
    decision: z.string(),
    reason: z.string().optional(),
    revised: z.number().optional(),
  }).passthrough()),
}).passthrough();

const ArbitratorSchema = z.object({
  summary: z.string(),
  decisions: z.array(DebateDecisionSchema),
  newRuleProposals: z.array(z.unknown()).optional(),
}).passthrough();

const DebateResultSchema = z.object({
  critic: CriticSchema.nullable().default(null),
  arbitrator: ArbitratorSchema.nullable().default(null),
  skipped: z.string().optional(),
}).passthrough();

/** A single decision from the Arbitrator in debate.json. */
export type DebateDecision = z.infer<typeof DebateDecisionSchema>;

/** Parsed debate.json structure from a calibration run. */
export type DebateResult = z.infer<typeof DebateResultSchema>;

/**
 * Parse a debate.json file from a run directory.
 * Validates with Zod schema — returns null if file is missing or malformed.
 */
export function parseDebateResult(runDir: string): DebateResult | null {
  const debatePath = join(runDir, "debate.json");
  if (!existsSync(debatePath)) return null;
  try {
    const raw: unknown = JSON.parse(readFileSync(debatePath, "utf-8"));
    const result = DebateResultSchema.safeParse(raw);
    if (!result.success) {
      console.debug(`[parseDebateResult] invalid debate.json in ${runDir}:`, result.error.issues);
      return null;
    }
    return result.data;
  } catch (err) {
    console.debug(`[parseDebateResult] failed to read debate.json in ${runDir}:`, err);
    return null;
  }
}

/**
 * Extract ruleIds that were applied or revised by the Arbitrator.
 */
export function extractAppliedRuleIds(debate: DebateResult): string[] {
  if (!debate.arbitrator) return [];
  return debate.arbitrator.decisions
    .filter((d) => {
      const dec = d.decision.trim().toLowerCase();
      return dec === "applied" || dec === "revised";
    })
    .map((d) => d.ruleId.trim())
    .filter((id) => id.length > 0);
}

/**
 * Resolve the latest calibration run directory for a given fixture name.
 * Searches `logs/calibration/<name>--*` and returns the most recent (last sorted).
 * Returns null if no matching run exists.
 */
export function resolveLatestRunDir(fixtureName: string): string | null {
  const runs = listCalibrationRuns();
  const matching = runs.filter((runPath) => {
    const dirName = basename(runPath);
    const parsed = parseRunDirName(dirName);
    return parsed.name === fixtureName;
  });
  return matching.length > 0 ? matching[matching.length - 1]! : null;
}

/** Convergence summary with decision counts. */
export interface ConvergenceSummary {
  converged: boolean;
  mode: "strict" | "lenient";
  applied: number;
  revised: number;
  rejected: number;
  hold: number;
  kept: number;
  total: number;
  reason: string;
}

/**
 * Check convergence and return a detailed summary with decision counts.
 */
export function checkConvergence(runDir: string, options?: ConvergenceOptions): ConvergenceSummary {
  const mode = options?.lenient ? "lenient" : "strict";
  const debate = parseDebateResult(runDir);

  if (!debate) {
    return { converged: false, mode, applied: 0, revised: 0, rejected: 0, hold: 0, kept: 0, total: 0, reason: "no debate.json found" };
  }
  if (debate.skipped) {
    return { converged: true, mode, applied: 0, revised: 0, rejected: 0, hold: 0, kept: 0, total: 0, reason: debate.skipped };
  }
  if (!debate.arbitrator) {
    // Early-stop: Arbitrator skipped because all proposals rejected with high confidence
    const stoppingReason = (debate as Record<string, unknown>)["stoppingReason"];
    if (typeof stoppingReason === "string" && stoppingReason.length > 0) {
      return { converged: true, mode, applied: 0, revised: 0, rejected: 0, hold: 0, kept: 0, total: 0, reason: `early-stop: ${stoppingReason}` };
    }
    return { converged: false, mode, applied: 0, revised: 0, rejected: 0, hold: 0, kept: 0, total: 0, reason: "no arbitrator result" };
  }

  const decisions = debate.arbitrator.decisions;
  const applied = decisions.filter((d) => d.decision.trim().toLowerCase() === "applied").length;
  const revised = decisions.filter((d) => d.decision.trim().toLowerCase() === "revised").length;
  const rejected = decisions.filter((d) => d.decision.trim().toLowerCase() === "rejected").length;
  const hold = decisions.filter((d) => d.decision.trim().toLowerCase() === "hold").length;
  const kept = decisions.length - applied - revised - rejected - hold;
  const total = decisions.length;

  // hold = "not enough confidence to decide" → not converged (need more evidence)
  const converged = options?.lenient
    ? (applied + revised + hold) === 0
    : (applied + revised + hold) === 0 && rejected === 0;

  const parts: string[] = [];
  if (applied > 0) parts.push(`${applied} applied`);
  if (revised > 0) parts.push(`${revised} revised`);
  if (rejected > 0) parts.push(`${rejected} rejected`);
  if (hold > 0) parts.push(`${hold} hold`);
  if (kept > 0) parts.push(`${kept} kept`);
  const countsStr = parts.length > 0 ? parts.join(", ") : "no decisions";
  const verdict = converged ? "converged" : "not converged";
  const reason = `${verdict} (${mode}) — ${countsStr} (${total} total)`;

  return { converged, mode, applied, revised, rejected, hold, kept, total, reason };
}

/** Options for convergence checking. */
export interface ConvergenceOptions {
  /**
   * When true, converged iff no applied/revised decisions (ignore rejected count).
   * Use when repeated reject loops block `fixture-done` but scores are stable (see issue #14).
   */
  lenient?: boolean | undefined;
}

/**
 * Check if a calibration run has converged.
 * Delegates to checkConvergence to avoid duplicating early-stop / hold logic.
 */
export function isConverged(runDir: string, options?: ConvergenceOptions): boolean {
  return checkConvergence(runDir, options).converged;
}
