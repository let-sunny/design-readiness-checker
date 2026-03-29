import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CAC } from "cac";

import { loadDiscoveryEvidence } from "../../../agents/evidence-collector.js";

// ─── discovery-filter-evidence ──────────────────────────────────────────────

/**
 * Filter discovery evidence by category (case-insensitive).
 * Returns matching entries as JSON to stdout, writes to run dir if provided.
 */
export function filterDiscoveryEvidence(category: string): unknown[] {
  const entries = loadDiscoveryEvidence();
  const catLower = category.toLowerCase().trim();
  return entries.filter((e) => e.category.toLowerCase().trim() === catLower);
}

export function registerFilterDiscoveryEvidence(cli: CAC): void {
  cli
    .command(
      "discovery-filter-evidence <category>",
      "Filter discovery evidence by category for Researcher input"
    )
    .option("--run-dir <path>", "Write filtered evidence to run directory")
    .action((category: string, options: { runDir?: string }) => {
      const filtered = filterDiscoveryEvidence(category);

      if (options.runDir) {
        const dir = resolve(options.runDir);
        if (!existsSync(dir)) {
          console.log(`Run directory not found: ${options.runDir}`);
          return;
        }
        const outPath = join(dir, "prior-evidence.json");
        writeFileSync(outPath, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
        console.log(`Filtered ${filtered.length} entries for category "${category}" → ${outPath}`);
      } else {
        console.log(JSON.stringify(filtered, null, 2));
      }
    });
}

// ─── rule-apply-decision ────────────────────────────────────────────────────

interface DecisionFile {
  decision: string;
  ruleId?: string;
  category?: string;
  changes?: unknown;
  reason?: string;
}

interface ApplyResult {
  action: "commit" | "revert" | "adjust";
  ruleId: string;
  category: string;
  reason: string;
}

/**
 * Read decision.json and determine the action.
 * Does NOT execute git operations — returns the action for the orchestrator.
 */
export function readDecision(runDir: string): ApplyResult | null {
  const decisionPath = join(runDir, "decision.json");
  if (!existsSync(decisionPath)) return null;

  try {
    const raw = JSON.parse(readFileSync(decisionPath, "utf-8")) as DecisionFile;
    const decision = (raw.decision ?? "").trim().toUpperCase();
    const ruleId = raw.ruleId ?? "unknown";
    const category = raw.category ?? "unknown";
    const reason = raw.reason ?? "";

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
      if (!existsSync(dir)) {
        console.log(`Run directory not found: ${runDir}`);
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
