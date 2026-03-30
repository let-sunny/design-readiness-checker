import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CAC } from "cac";

import { parseDebateResult } from "../../../agents/run-directory.js";
import { loadCalibrationEvidence, computeEvidenceRatio } from "../../../agents/evidence-collector.js";
import type { EvidenceRatioSummary } from "../../../agents/contracts/evidence.js";
import { RULE_CONFIGS } from "../../../core/rules/rule-config.js";
import { resolveRunDir } from "./cli-helpers.js";

const KNOWN_RULE_IDS = new Set(Object.keys(RULE_CONFIGS));

// ─── calibrate-gather-evidence ──────────────────────────────────────────────

export interface GatheredEvidence {
  ruleImpactAssessment: unknown[];
  uncoveredStruggles: unknown[];
  actionableGaps: unknown[];
  priorEvidence: Record<string, unknown>;
  evidenceRatios: Record<string, EvidenceRatioSummary>;
}

/**
 * Gather structured evidence for the Critic from run artifacts + cross-run data.
 * Pure data extraction — no LLM needed.
 */
export function gatherEvidence(runDir: string, proposedRuleIds: string[]): GatheredEvidence {
  const result: GatheredEvidence = {
    ruleImpactAssessment: [],
    uncoveredStruggles: [],
    actionableGaps: [],
    priorEvidence: {},
    evidenceRatios: {},
  };

  // 1. conversion.json → ruleImpactAssessment, uncoveredStruggles
  const convPath = join(runDir, "conversion.json");
  if (existsSync(convPath)) {
    try {
      const conv = JSON.parse(readFileSync(convPath, "utf-8")) as Record<string, unknown>;
      if (Array.isArray(conv["ruleImpactAssessment"])) {
        result.ruleImpactAssessment = conv["ruleImpactAssessment"];
      }
      if (Array.isArray(conv["uncoveredStruggles"])) {
        result.uncoveredStruggles = conv["uncoveredStruggles"];
      }
    } catch { /* ignore malformed */ }
  }

  // 2. gaps.json → actionable gaps
  const gapsPath = join(runDir, "gaps.json");
  if (existsSync(gapsPath)) {
    try {
      const gaps = JSON.parse(readFileSync(gapsPath, "utf-8")) as Record<string, unknown>;
      const gapList = Array.isArray(gaps["gaps"]) ? gaps["gaps"] : [];
      result.actionableGaps = gapList.filter(
        (g): g is Record<string, unknown> =>
          typeof g === "object" && g !== null && (g as Record<string, unknown>)["actionable"] === true
      );
    } catch { /* ignore malformed */ }
  }

  // 3. Prior evidence filtered to proposed rules only + ratio summaries
  if (proposedRuleIds.length > 0) {
    const allEvidence = loadCalibrationEvidence();
    const ruleSet = new Set(proposedRuleIds.map((id) => id.trim()));
    for (const [ruleId, group] of Object.entries(allEvidence)) {
      if (ruleSet.has(ruleId)) {
        result.priorEvidence[ruleId] = group;
        result.evidenceRatios[ruleId] = computeEvidenceRatio(group);
      }
    }
  }

  return result;
}

/**
 * Load proposed ruleIds from proposed-rules.json (written by calibrate-evaluate).
 * Falls back to regex extraction from summary.md if file doesn't exist.
 */
export function loadProposedRuleIds(runDir: string): string[] {
  // Preferred: deterministic list from calibrate-evaluate
  const proposedPath = join(runDir, "proposed-rules.json");
  if (existsSync(proposedPath)) {
    try {
      const raw: unknown = JSON.parse(readFileSync(proposedPath, "utf-8"));
      if (Array.isArray(raw)) return raw.filter((id): id is string => typeof id === "string");
    } catch { /* fall through to regex */ }
  }

  // Fallback: extract from summary.md, filtered to known rule IDs only
  const summaryPath = join(runDir, "summary.md");
  if (!existsSync(summaryPath)) return [];
  try {
    const content = readFileSync(summaryPath, "utf-8");
    const ids = new Set<string>();
    for (const match of content.matchAll(/`([a-z][\w-]*)`/g)) {
      if (match[1] && KNOWN_RULE_IDS.has(match[1])) ids.add(match[1]);
    }
    return [...ids];
  } catch {
    return [];
  }
}

export function registerGatherEvidence(cli: CAC): void {
  cli
    .command(
      "calibrate-gather-evidence <runDir>",
      "Gather structured evidence for Critic from run artifacts + cross-run data"
    )
    .action((runDir: string) => {
      const dir = resolveRunDir(runDir);
      if (!dir) return;

      const proposedRuleIds = loadProposedRuleIds(dir);
      const evidence = gatherEvidence(dir, proposedRuleIds);

      // Write to file for orchestrator to include in Critic prompt
      const outPath = join(dir, "critic-evidence.json");
      writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n", "utf-8");
      const ratioCount = Object.keys(evidence.evidenceRatios).length;
      console.log(`Gathered evidence: ${evidence.ruleImpactAssessment.length} impact assessments, ${evidence.actionableGaps.length} gaps, ${Object.keys(evidence.priorEvidence).length} prior rules (${ratioCount} with ratio summaries)`);
      console.log(`Written to ${outPath}`);
    });
}

// ─── calibrate-finalize-debate ──────────────────────────────────────────────

interface FinalizeResult {
  action: "early-stop" | "continue" | "finalized";
  stoppingReason?: string;
}

export function registerFinalizeDebate(cli: CAC): void {
  cli
    .command(
      "calibrate-finalize-debate <runDir>",
      "Check early-stop or determine stoppingReason after debate"
    )
    .action((runDir: string) => {
      const dir = resolveRunDir(runDir);
      if (!dir) return;

      const debate = parseDebateResult(dir);
      if (!debate) {
        console.log("No debate.json found");
        return;
      }

      const debatePath = join(dir, "debate.json");
      let raw: Record<string, unknown>;
      try {
        raw = JSON.parse(readFileSync(debatePath, "utf-8")) as Record<string, unknown>;
      } catch {
        console.log(JSON.stringify({ action: "continue" }));
        return;
      }

      // Case 1: Critic done, no Arbitrator yet → check early-stop
      if (debate.critic && !debate.arbitrator) {
        const reviews = debate.critic.reviews;
        const allHighConfidenceReject = reviews.length > 0 && reviews.every((r) => {
          return r.decision.trim().toUpperCase() === "REJECT" && r.confidence === "high";
        });

        if (allHighConfidenceReject) {
          raw["stoppingReason"] = "all-high-confidence-reject";
          writeFileSync(debatePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
          const result: FinalizeResult = { action: "early-stop", stoppingReason: "all-high-confidence-reject" };
          console.log(JSON.stringify(result));
          // exit 0 = early-stop, orchestrator should skip Arbitrator
          return;
        }

        const result: FinalizeResult = { action: "continue" };
        console.log(JSON.stringify(result));
        // exit 0 but action=continue → orchestrator proceeds to Arbitrator
        return;
      }

      // Case 2: Both Critic and Arbitrator done → determine stoppingReason
      if (debate.arbitrator) {
        const decisions = debate.arbitrator.decisions;
        const allHold = decisions.length > 0 && decisions.every((d) =>
          d.decision.trim().toLowerCase() === "hold"
        );

        if (allHold) {
          raw["stoppingReason"] = "low-confidence-hold";
          writeFileSync(debatePath, JSON.stringify(raw, null, 2) + "\n", "utf-8");
          const result: FinalizeResult = { action: "finalized", stoppingReason: "low-confidence-hold" };
          console.log(JSON.stringify(result));
          return;
        }

        // Normal completion — no stoppingReason needed
        const result: FinalizeResult = { action: "finalized" };
        console.log(JSON.stringify(result));
        return;
      }

      // Fallback
      const result: FinalizeResult = { action: "continue" };
      console.log(JSON.stringify(result));
    });
}
