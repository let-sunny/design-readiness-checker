import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";

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
