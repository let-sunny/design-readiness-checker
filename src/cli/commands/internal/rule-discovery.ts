import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CAC } from "cac";
import { loadDiscoveryEvidence } from "../../../agents/evidence-collector.js";
import type { DiscoveryEvidenceEntry } from "../../../agents/evidence-collector.js";
import { DecisionFileSchema } from "../../../agents/contracts/evidence.js";

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
      try {
        const filtered = filterDiscoveryEvidence(keyword);

        if (options.runDir) {
          const dir = resolve(options.runDir);
          if (!existsSync(dir) || !statSync(dir).isDirectory()) {
            console.log(`Run directory not found or is not a directory: ${options.runDir}`);
            return;
          }
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
      const dir = resolve(runDir);
      if (!existsSync(dir) || !statSync(dir).isDirectory()) {
        console.log(`Run directory not found or is not a directory: ${runDir}`);
        return;
      }

      const result = readDecision(dir);
      if (!result) {
        console.log("No valid decision.json found");
        return;
      }

      console.log(JSON.stringify(result));
    });
}
