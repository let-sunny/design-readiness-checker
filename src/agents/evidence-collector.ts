import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CalibrationEvidenceEntrySchema,
  DiscoveryEvidenceEntrySchema,
  DiscoveryEvidenceFileSchema,
  DISCOVERY_EVIDENCE_SCHEMA_VERSION,
} from "./contracts/evidence.js";
import type {
  CalibrationEvidenceEntry,
  CrossRunEvidence,
  DiscoveryEvidenceEntry,
} from "./contracts/evidence.js";

export type { CalibrationEvidenceEntry, CrossRunEvidence, DiscoveryEvidenceEntry };
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

    // Aggregate pro/con from enriched entries
    if (entry.pro) {
      group.allPro ??= [];
      group.allPro.push(...entry.pro);
    }
    if (entry.con) {
      group.allCon ??= [];
      group.allCon.push(...entry.con);
    }
    // Keep last confidence/decision (most recent entry wins)
    if (entry.confidence) group.lastConfidence = entry.confidence;
    if (entry.decision) group.lastDecision = entry.decision;
  }

  return result;
}

/**
 * Append new calibration evidence entries (overscored/underscored mismatches).
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
    decision?: "APPROVE" | "REJECT" | "REVISE";
  }>,
  fixture: string,
  evidencePath: string = DEFAULT_CALIBRATION_PATH
): void {
  if (reviews.length === 0) return;
  const existing = readValidatedArray(evidencePath, CalibrationEvidenceEntrySchema);
  if (existing.length === 0) return;

  const reviewByRule = new Map(reviews.map((r) => [r.ruleId.trim(), r]));
  const fixtureTrimmed = fixture.trim();

  const enriched = existing.map((entry) => {
    if (entry.fixture.trim() !== fixtureTrimmed) return entry;
    const review = reviewByRule.get(entry.ruleId.trim());
    if (!review) return entry;
    return {
      ...entry,
      ...(review.confidence && { confidence: review.confidence }),
      ...(review.pro && { pro: review.pro }),
      ...(review.con && { con: review.con }),
      ...(review.decision && { decision: review.decision }),
    };
  });

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
