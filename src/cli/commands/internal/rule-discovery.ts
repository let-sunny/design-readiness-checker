import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CAC } from "cac";
import { z } from "zod";
import { loadDiscoveryEvidence, appendDiscoveryEvidence } from "../../../agents/evidence-collector.js";
import type { DiscoveryEvidenceEntry } from "../../../agents/evidence-collector.js";
import { DecisionFileSchema } from "../../../agents/contracts/evidence.js";
import { resolveRunDir, KEYWORD_ARG_SCHEMA } from "./cli-helpers.js";

// ─── discovery-filter-evidence ──────────────────────────────────────────────

/**
 * Filter discovery evidence by keyword (case-insensitive).
 * Matches against both `category` and `description` fields using substring search.
 * This handles the concept-to-evidence mapping: a concept like "component description"
 * may match evidence with category "component" or description containing "component".
 */
const MIN_TOKEN_LENGTH = 2;

export function filterDiscoveryEvidence(keyword: string): DiscoveryEvidenceEntry[] {
  const kw = keyword.toLowerCase().trim();
  if (kw.length === 0) return [];

  const tokens = kw.split(/\s+/).filter((w) => w.length >= MIN_TOKEN_LENGTH);
  if (tokens.length === 0) return [];

  const entries = loadDiscoveryEvidence();

  return entries.filter((e) => {
    const cat = e.category.toLowerCase();
    const desc = e.description.toLowerCase();
    return tokens.some((t) => cat.includes(t) || desc.includes(t));
  });
}

export function registerFilterDiscoveryEvidence(cli: CAC): void {
  cli
    .command(
      "discovery-filter-evidence <keyword>",
      "Filter discovery evidence by keyword (matches category + description)"
    )
    .option("--run-dir <path>", "Write filtered evidence to run directory")
    .action((keyword: string, options: { runDir?: string }) => {
      const kParsed = KEYWORD_ARG_SCHEMA.safeParse(keyword);
      if (!kParsed.success) { console.log(`Invalid keyword: ${kParsed.error.issues[0]?.message}`); return; }
      try {
        const filtered = filterDiscoveryEvidence(kParsed.data);

        if (options.runDir) {
          const dir = resolveRunDir(options.runDir);
          if (!dir) return;
          const outPath = join(dir, "prior-evidence.json");
          writeFileSync(outPath, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
          console.log(`Filtered ${filtered.length} entries for "${keyword}" → ${outPath}`);
        } else {
          console.log(JSON.stringify(filtered, null, 2));
        }
      } catch (err) {
        // loadDiscoveryEvidence throws on unsupported schemaVersion
        console.log(`Failed to filter discovery evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}

// ─── rule-apply-decision ────────────────────────────────────────────────────

export interface ApplyResult {
  action: "commit" | "revert" | "adjust";
  ruleId: string;
  category: string;
  reason: string;
}

/**
 * Read decision.json, validate with Zod, and determine the action.
 * Does NOT execute git operations — returns the action for the orchestrator.
 */
export function readDecision(runDir: string): ApplyResult | null {
  const decisionPath = join(runDir, "decision.json");
  if (!existsSync(decisionPath)) return null;

  try {
    const raw: unknown = JSON.parse(readFileSync(decisionPath, "utf-8"));
    const parsed = DecisionFileSchema.safeParse(raw);
    if (!parsed.success) return null;

    const decision = parsed.data.decision.trim().toUpperCase();
    const ruleId = parsed.data.ruleId ?? "unknown";
    const category = parsed.data.category ?? "unknown";
    const reason = parsed.data.reason ?? "";

    switch (decision) {
      case "KEEP":
        return { action: "commit", ruleId, category, reason };
      case "ADJUST":
        return { action: "adjust", ruleId, category, reason };
      case "DROP":
        return { action: "revert", ruleId, category, reason };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

export function registerApplyDecision(cli: CAC): void {
  cli
    .command(
      "rule-apply-decision <runDir>",
      "Read decision.json and output the action (commit/revert/adjust)"
    )
    .action((runDir: string) => {
      const dir = resolveRunDir(runDir);
      if (!dir) return;

      const result = readDecision(dir);
      if (!result) {
        console.log("No valid decision.json found");
        return;
      }

      console.log(JSON.stringify(result));
    });
}

// ─── calibrate-collect-gap-evidence ─────────────────────────────────────────

const GapSchema = z.object({
  category: z.string(),
  description: z.string(),
  actionable: z.boolean(),
  coveredByRule: z.unknown().default(null),
}).passthrough();

const GapsFileSchema = z.object({
  fixture: z.string().optional(),
  gaps: z.array(GapSchema),
}).passthrough();

/**
 * Extract uncovered actionable gaps from gaps.json and append to discovery evidence.
 * Deterministic — no LLM needed.
 */
export function collectGapEvidence(runDir: string, fixture: string): DiscoveryEvidenceEntry[] {
  const gapsPath = join(runDir, "gaps.json");
  if (!existsSync(gapsPath)) return [];

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(gapsPath, "utf-8"));
  } catch {
    return [];
  }
  const parsed = GapsFileSchema.safeParse(raw);
  if (!parsed.success) return [];

  const timestamp = new Date().toISOString();
  const entries: DiscoveryEvidenceEntry[] = [];

  for (const gap of parsed.data.gaps) {
    // Only actionable gaps not covered by existing rules
    if (!gap.actionable) continue;
    // Skip when coveredByRule is present (non-nullish).
    // Empty string is intentionally treated as "marked covered" — the Gap Analyzer sets
    // coveredByRule to "" when a gap is partially covered but the exact rule ID is unknown.
    if (gap.coveredByRule != null) continue;

    entries.push({
      description: gap.description,
      category: gap.category,
      impact: "moderate",
      fixture,
      timestamp,
      source: "gap-analysis",
    });
  }

  return entries;
}

export function registerCollectGapEvidence(cli: CAC): void {
  cli
    .command(
      "calibrate-collect-gap-evidence <runDir>",
      "Collect uncovered actionable gaps from gaps.json into discovery evidence"
    )
    .action((runDir: string) => {
      const dir = resolveRunDir(runDir);
      if (!dir) return;

      // Extract fixture name from run dir
      const dirName = dir.split(/[/\\]/).pop() ?? "";
      const idx = dirName.lastIndexOf("--");
      const fixture = idx === -1 ? dirName : dirName.slice(0, idx);

      try {
        const entries = collectGapEvidence(dir, fixture);
        if (entries.length === 0) {
          console.log("No uncovered actionable gaps found");
          return;
        }

        appendDiscoveryEvidence(entries);
        console.log(`Collected ${entries.length} gap evidence entries for fixture "${fixture}"`);
      } catch (err) {
        console.log(`Failed to collect gap evidence: ${err instanceof Error ? err.message : String(err)}`);
      }
    });
}
