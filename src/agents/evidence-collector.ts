import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CalibrationEvidenceEntrySchema,
  DiscoveryEvidenceEntrySchema,
  DiscoveryEvidenceFileSchema,
  DISCOVERY_EVIDENCE_SCHEMA_VERSION,
} from "./contracts/evidence.js";
import { CategorySchema } from "../core/contracts/category.js";
import type {
  CalibrationEvidenceEntry,
  CrossRunEvidence,
  CrossRunEvidenceGroup,
  DiscoveryEvidenceEntry,
  EvidenceRatioSummary,
} from "./contracts/evidence.js";

export type { CalibrationEvidenceEntry, CrossRunEvidence, CrossRunEvidenceGroup, DiscoveryEvidenceEntry, EvidenceRatioSummary };
export { DISCOVERY_EVIDENCE_SCHEMA_VERSION };

const DEFAULT_CALIBRATION_PATH = resolve("data/calibration-evidence.json");

function readValidatedArray<T>(
  filePath: string,
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } }
): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    if (!Array.isArray(raw)) return [];
    const result: T[] = [];
    for (const item of raw) {
      const parsed = schema.safeParse(item);
      if (parsed.success && parsed.data !== undefined) {
        result.push(parsed.data);
      }
    }
    return result;
  } catch {
    return [];
  }
}

function writeJsonArray<T>(filePath: string, data: T[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Load calibration evidence and group by ruleId for the tuning agent.
 */
export function loadCalibrationEvidence(
  evidencePath: string = DEFAULT_CALIBRATION_PATH
): CrossRunEvidence {
  const entries = readValidatedArray(evidencePath, CalibrationEvidenceEntrySchema);
  const result: CrossRunEvidence = {};

  for (const entry of entries) {
    let group = result[entry.ruleId];
    if (!group) {
      group = {
        overscoredCount: 0,
        underscoredCount: 0,
        overscoredDifficulties: [],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      result[entry.ruleId] = group;
    }

    if (entry.type === "overscored") {
      group.overscoredCount++;
      group.overscoredDifficulties.push(entry.actualDifficulty);
    } else {
      group.underscoredCount++;
      group.underscoredDifficulties.push(entry.actualDifficulty);
    }

    // Aggregate pro/con from enriched entries (deduplicated)
    if (entry.pro) {
      group.allPro ??= [];
      for (const p of entry.pro) {
        if (!group.allPro.includes(p)) group.allPro.push(p);
      }
    }
    if (entry.con) {
      group.allCon ??= [];
      for (const c of entry.con) {
        if (!group.allCon.includes(c)) group.allCon.push(c);
      }
    }
    // Keep last confidence/decision (most recent entry wins)
    if (entry.confidence) group.lastConfidence = entry.confidence;
    if (entry.decision) group.lastDecision = entry.decision;
  }

  return result;
}

/**
 * Minimum sample size before ratio-based confidence kicks in.
 * Below this threshold, confidence is "insufficient".
 * Lowered from 3→2: strip ablation deltas provide objective signal,
 * so fewer fixtures are needed for convergence (#194).
 */
const MIN_RATIO_SAMPLES = 2;

/**
 * Difficulty dominance: pick the most frequent difficulty from a list.
 */
function dominantDifficulty(difficulties: string[]): string {
  if (difficulties.length === 0) return "moderate";
  const counts: Record<string, number> = {};
  for (const d of difficulties) {
    counts[d] = (counts[d] ?? 0) + 1;
  }
  let best = difficulties[0]!;
  let bestCount = 0;
  for (const [d, c] of Object.entries(counts)) {
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

/**
 * Compute a deterministic ratio summary from cross-run evidence for a single rule.
 * This pre-digests contradictory evidence into a clear signal so the Critic
 * doesn't have to do statistics — it just reads the conclusion.
 */
export function computeEvidenceRatio(group: CrossRunEvidenceGroup): EvidenceRatioSummary {
  const total = group.overscoredCount + group.underscoredCount;

  if (total === 0) {
    return {
      totalSamples: 0,
      overscoredCount: 0,
      underscoredCount: 0,
      overscoredRate: 0,
      underscoredRate: 0,
      dominantDirection: "mixed",
      dominantRate: 0,
      expectedDifficulty: "moderate",
      confidence: "insufficient",
      summary: "No evidence available.",
    };
  }

  const overscoredRate = group.overscoredCount / total;
  const underscoredRate = group.underscoredCount / total;

  // Determine dominant direction
  let dir: "overscored" | "underscored" | "mixed";
  let dominantRate: number;
  if (overscoredRate >= 0.6) {
    dir = "overscored";
    dominantRate = overscoredRate;
  } else if (underscoredRate >= 0.6) {
    dir = "underscored";
    dominantRate = underscoredRate;
  } else {
    dir = "mixed";
    dominantRate = Math.max(overscoredRate, underscoredRate);
  }

  // Expected difficulty from the dominant direction's difficulties
  const relevantDifficulties =
    dir === "underscored"
      ? group.underscoredDifficulties
      : dir === "overscored"
        ? group.overscoredDifficulties
        : [...group.overscoredDifficulties, ...group.underscoredDifficulties];
  const expectedDiff = dominantDifficulty(relevantDifficulties);

  // Confidence based on sample size + dominance clarity
  let confidence: "high" | "medium" | "low" | "insufficient";
  if (total < MIN_RATIO_SAMPLES) {
    confidence = "insufficient";
  } else if (dominantRate >= 0.7 && total >= 3) {
    confidence = "high";
  } else if (dominantRate >= 0.6 && total >= MIN_RATIO_SAMPLES) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  // Human-readable summary
  const pct = (r: number) => `${Math.round(r * 100)}%`;
  let summary: string;
  if (dir === "mixed") {
    summary = `Mixed signals: ${group.overscoredCount} overscored (${pct(overscoredRate)}) vs ${group.underscoredCount} underscored (${pct(underscoredRate)}) across ${total} fixtures. No clear direction.`;
  } else {
    summary = `${total} fixtures: ${dir} in ${dir === "overscored" ? group.overscoredCount : group.underscoredCount}/${total} (${pct(dominantRate)}). Expected difficulty: ${expectedDiff}. Confidence: ${confidence}.`;
  }

  return {
    totalSamples: total,
    overscoredCount: group.overscoredCount,
    underscoredCount: group.underscoredCount,
    overscoredRate: Math.round(overscoredRate * 1000) / 1000,
    underscoredRate: Math.round(underscoredRate * 1000) / 1000,
    dominantDirection: dir,
    dominantRate: Math.round(dominantRate * 1000) / 1000,
    expectedDifficulty: expectedDiff,
    confidence,
    summary,
  };
}

/**
 * Append new calibration evidence entries (overscored/underscored mismatches).
 *
 * Dedup policy: one entry per (ruleId, fixture) — last-write-wins within and across calls.
 * This is intentional: with strip-ablation (#194) each rule gets one objective delta per fixture,
 * so multiple entries for the same (ruleId, fixture) would be redundant.
 * Cross-run confidence in `computeEvidenceRatio` counts entries (=fixtures), not occurrences.
 */
export function appendCalibrationEvidence(
  entries: CalibrationEvidenceEntry[],
  evidencePath: string = DEFAULT_CALIBRATION_PATH
): void {
  if (entries.length === 0) return;
  const existing = readValidatedArray(evidencePath, CalibrationEvidenceEntrySchema);
  // Same batch can repeat (ruleId, fixture); last entry wins (matches cross-call behavior)
  // Normalize ruleId/fixture to prevent bucket splitting from whitespace differences
  const incomingByKey = new Map<string, CalibrationEvidenceEntry>();
  for (const e of entries) {
    const normalized = { ...e, ruleId: e.ruleId.trim(), fixture: e.fixture.trim() };
    const k = `${normalized.ruleId}\0${normalized.fixture}`;
    incomingByKey.set(k, normalized);
  }
  const mergedIncoming = [...incomingByKey.values()];
  const keys = new Set(incomingByKey.keys());
  const withoutDupes = existing.filter(
    (e) => !keys.has(`${e.ruleId.trim()}\0${e.fixture.trim()}`),
  );
  withoutDupes.push(...mergedIncoming);
  writeJsonArray(evidencePath, withoutDupes);
}

/**
 * Remove entries for rules whose scores were applied/revised by the Arbitrator.
 * Prunes all fixtures for the given ruleIds — score changes are global.
 */
export function pruneCalibrationEvidence(
  appliedRuleIds: string[],
  evidencePath: string = DEFAULT_CALIBRATION_PATH
): void {
  if (appliedRuleIds.length === 0) return;
  const ruleSet = new Set(appliedRuleIds.map((id) => id.trim()).filter((id) => id.length > 0));
  const existing = readValidatedArray(evidencePath, CalibrationEvidenceEntrySchema);
  const pruned = existing.filter((e) => !ruleSet.has(e.ruleId.trim()));
  writeJsonArray(evidencePath, pruned);
}

/**
 * Enrich existing calibration evidence entries with Critic's structured review data.
 * Matches by (ruleId, fixture) to avoid overwriting entries from other fixtures.
 * Entries without a matching review are left unchanged.
 */
export function enrichCalibrationEvidence(
  reviews: Array<{
    ruleId: string;
    confidence?: "high" | "medium" | "low";
    pro?: string[];
    con?: string[];
    decision?: "APPROVE" | "REJECT" | "REVISE" | "HOLD";
  }>,
  fixture: string,
  evidencePath: string = DEFAULT_CALIBRATION_PATH
): void {
  if (reviews.length === 0) return;
  const existing = readValidatedArray(evidencePath, CalibrationEvidenceEntrySchema);
  if (existing.length === 0) return;

  const reviewByRule = new Map(reviews.map((r) => [r.ruleId.trim(), r]));
  const fixtureTrimmed = fixture.trim();

  let matchCount = 0;
  const enriched = existing.map((entry) => {
    if (entry.fixture.trim() !== fixtureTrimmed) return entry;
    const review = reviewByRule.get(entry.ruleId.trim());
    if (!review) return entry;
    matchCount++;
    return {
      ...entry,
      ...(review.confidence && { confidence: review.confidence }),
      ...(review.pro && { pro: review.pro }),
      ...(review.con && { con: review.con }),
      ...(review.decision && { decision: review.decision }),
    };
  });

  if (matchCount === 0) {
    console.warn(`[enrich] No entries matched fixture="${fixture}" — evidence unchanged`);
    return;
  }
  writeJsonArray(evidencePath, enriched);
}

// --- Discovery evidence ---

const DEFAULT_DISCOVERY_PATH = resolve("data/discovery-evidence.json");

/**
 * Build a dedupe key for a discovery evidence entry.
 * Key: category (lowered) + normalized description + fixture (trimmed, lowered).
 */
function discoveryDedupeKey(e: DiscoveryEvidenceEntry): string {
  const cat = e.category.toLowerCase().trim();
  const desc = e.description.toLowerCase().trim().replace(/\s+/g, " ");
  const fix = e.fixture.toLowerCase().trim();
  return `${cat}\0${desc}\0${fix}`;
}

/**
 * Read discovery evidence from file, supporting both legacy (plain array)
 * and versioned ({ schemaVersion, entries }) formats.
 * Throws if the file contains a versioned object with an unsupported schemaVersion
 * to prevent silent data loss on subsequent writes.
 */
function readDiscoveryEvidence(filePath: string): DiscoveryEvidenceEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;

    // Versioned format: { schemaVersion, entries }
    const versionedParse = DiscoveryEvidenceFileSchema.safeParse(raw);
    if (versionedParse.success) {
      // Validate entries individually so one bad row doesn't discard all
      const result: DiscoveryEvidenceEntry[] = [];
      for (const item of versionedParse.data.entries) {
        const parsed = DiscoveryEvidenceEntrySchema.safeParse(item);
        if (parsed.success && parsed.data !== undefined) {
          result.push(parsed.data);
        }
      }
      return result;
    }

    // Detect unsupported versioned format — refuse to load to prevent silent overwrite
    if (
      typeof raw === "object" &&
      raw !== null &&
      !Array.isArray(raw) &&
      "schemaVersion" in raw
    ) {
      const version = (raw as { schemaVersion: unknown }).schemaVersion;
      throw new Error(
        `Unsupported discovery-evidence schemaVersion: ${String(version)} (expected ${DISCOVERY_EVIDENCE_SCHEMA_VERSION}). ` +
        `Upgrade canicode to read this file, or delete it to start fresh.`
      );
    }

    // Legacy format: plain array (v0, before schemaVersion was introduced)
    if (Array.isArray(raw)) {
      const result: DiscoveryEvidenceEntry[] = [];
      for (const item of raw) {
        const parsed = DiscoveryEvidenceEntrySchema.safeParse(item);
        if (parsed.success && parsed.data !== undefined) {
          result.push(parsed.data);
        }
      }
      return result;
    }

    return [];
  } catch (err) {
    // Re-throw unsupported version errors; swallow everything else (malformed JSON, etc.)
    if (err instanceof Error && err.message.startsWith("Unsupported discovery-evidence")) {
      throw err;
    }
    return [];
  }
}

/**
 * Write discovery evidence in the versioned format.
 */
function writeDiscoveryEvidence(filePath: string, entries: DiscoveryEvidenceEntry[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const data = {
    schemaVersion: DISCOVERY_EVIDENCE_SCHEMA_VERSION,
    entries,
  };
  writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

/**
 * Load all discovery evidence entries.
 */
export function loadDiscoveryEvidence(
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): DiscoveryEvidenceEntry[] {
  return readDiscoveryEvidence(evidencePath);
}

/**
 * Append new discovery evidence entries with deduplication.
 * Dedupe key: (category + normalized description + fixture).
 * Last-write-wins for duplicate keys.
 */
export function appendDiscoveryEvidence(
  entries: DiscoveryEvidenceEntry[],
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): void {
  if (entries.length === 0) return;

  // Warn on non-standard categories (safety net for converter typos/old labels)
  for (const e of entries) {
    const parsed = CategorySchema.safeParse(e.category);
    if (!parsed.success) {
      console.warn(`[evidence] Non-standard category "${e.category}" in discovery evidence (expected: ${CategorySchema.options.join(", ")})`);
    }
  }

  const existing = readDiscoveryEvidence(evidencePath);

  // Build map of existing entries keyed by dedupe key
  const byKey = new Map<string, DiscoveryEvidenceEntry>();
  for (const e of existing) {
    byKey.set(discoveryDedupeKey(e), e);
  }

  // Incoming entries override existing duplicates (last-write-wins)
  for (const e of entries) {
    byKey.set(discoveryDedupeKey(e), e);
  }

  writeDiscoveryEvidence(evidencePath, [...byKey.values()]);
}

/**
 * Remove entries for categories that were addressed by rule discovery.
 */
export function pruneDiscoveryEvidence(
  categories: string[],
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): void {
  if (categories.length === 0) return;
  const catSet = new Set(
    categories.map((c) => c.toLowerCase().trim()).filter((c) => c.length > 0),
  );
  const existing = readDiscoveryEvidence(evidencePath);
  const pruned = existing.filter((e) => !catSet.has(e.category.toLowerCase().trim()));
  writeDiscoveryEvidence(evidencePath, pruned);
}
