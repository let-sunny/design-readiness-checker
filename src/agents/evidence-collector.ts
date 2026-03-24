import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  CalibrationEvidenceEntrySchema,
  DiscoveryEvidenceEntrySchema,
} from "./contracts/evidence.js";
import type {
  CalibrationEvidenceEntry,
  CrossRunEvidence,
  DiscoveryEvidenceEntry,
} from "./contracts/evidence.js";

export type { CalibrationEvidenceEntry, CrossRunEvidence, DiscoveryEvidenceEntry };

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

// --- Discovery evidence ---

const DEFAULT_DISCOVERY_PATH = resolve("data/discovery-evidence.json");

/**
 * Load all discovery evidence entries.
 */
export function loadDiscoveryEvidence(
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): DiscoveryEvidenceEntry[] {
  return readValidatedArray(evidencePath, DiscoveryEvidenceEntrySchema);
}

/**
 * Append new discovery evidence entries (missing-rule + gap analysis).
 */
export function appendDiscoveryEvidence(
  entries: DiscoveryEvidenceEntry[],
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): void {
  if (entries.length === 0) return;
  const existing = readValidatedArray(evidencePath, DiscoveryEvidenceEntrySchema);
  existing.push(...entries);
  writeJsonArray(evidencePath, existing);
}

/**
 * Remove entries for categories that were addressed by rule discovery.
 */
export function pruneDiscoveryEvidence(
  categories: string[],
  evidencePath: string = DEFAULT_DISCOVERY_PATH
): void {
  if (categories.length === 0) return;
  const catSet = new Set(categories.map((c) => c.toLowerCase()));
  const existing = readValidatedArray(evidencePath, DiscoveryEvidenceEntrySchema);
  const pruned = existing.filter((e) => !catSet.has(e.category.toLowerCase()));
  writeJsonArray(evidencePath, pruned);
}
