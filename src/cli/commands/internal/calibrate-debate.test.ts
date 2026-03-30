import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

import { gatherEvidence, loadProposedRuleIds } from "./calibrate-debate.js";
import { parseDebateResult } from "../../../agents/run-directory.js";

describe("gatherEvidence", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "gather-test-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("extracts ruleImpactAssessment and uncoveredStruggles from conversion.json", () => {
    writeFileSync(join(runDir, "conversion.json"), JSON.stringify({
      ruleImpactAssessment: [
        { ruleId: "no-auto-layout", issueCount: 3, actualImpact: "easy" },
      ],
      uncoveredStruggles: [
        { description: "border radius mismatch" },
      ],
    }));

    const evidence = gatherEvidence(runDir, []);
    expect(evidence.ruleImpactAssessment).toHaveLength(1);
    expect(evidence.uncoveredStruggles).toHaveLength(1);
  });

  it("filters gaps to actionable only", () => {
    writeFileSync(join(runDir, "gaps.json"), JSON.stringify({
      gaps: [
        { category: "spacing", actionable: true, description: "padding off" },
        { category: "rendering", actionable: false, description: "font fallback" },
        { category: "color", actionable: true, description: "wrong shade" },
      ],
    }));

    const evidence = gatherEvidence(runDir, []);
    expect(evidence.actionableGaps).toHaveLength(2);
  });

  it("handles missing files gracefully", () => {
    const evidence = gatherEvidence(runDir, []);
    expect(evidence.ruleImpactAssessment).toHaveLength(0);
    expect(evidence.uncoveredStruggles).toHaveLength(0);
    expect(evidence.actionableGaps).toHaveLength(0);
    expect(evidence.priorEvidence).toEqual({});
    expect(evidence.evidenceRatios).toEqual({});
  });

  it("returns empty priorEvidence and evidenceRatios when no ruleIds proposed", () => {
    const evidence = gatherEvidence(runDir, []);
    expect(evidence.priorEvidence).toEqual({});
    expect(evidence.evidenceRatios).toEqual({});
  });
});

describe("loadProposedRuleIds", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "proposed-test-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("loads from proposed-rules.json when available", () => {
    writeFileSync(join(runDir, "proposed-rules.json"), JSON.stringify(["no-auto-layout", "raw-value"]));
    const ids = loadProposedRuleIds(runDir);
    expect(ids).toEqual(["no-auto-layout", "raw-value"]);
  });

  it("falls back to summary.md regex when no proposed-rules.json", () => {
    writeFileSync(join(runDir, "summary.md"), "## Overscored\n| `no-auto-layout` | -10 | easy |\n| `raw-value` | -3 |");
    const ids = loadProposedRuleIds(runDir);
    expect(ids).toContain("no-auto-layout");
    expect(ids).toContain("raw-value");
  });

  it("filters summary.md fallback to known RULE_CONFIGS keys only", () => {
    writeFileSync(join(runDir, "summary.md"), "Results: `no-auto-layout`, `fake-rule-id`, `moderate`, `raw-value`");
    const ids = loadProposedRuleIds(runDir);
    expect(ids).toContain("no-auto-layout");
    expect(ids).toContain("raw-value");
    expect(ids).not.toContain("fake-rule-id");
    expect(ids).not.toContain("moderate");
  });

  it("returns empty for missing files", () => {
    const ids = loadProposedRuleIds(runDir);
    expect(ids).toEqual([]);
  });

  it("prefers proposed-rules.json over summary.md", () => {
    writeFileSync(join(runDir, "proposed-rules.json"), JSON.stringify(["rule-a"]));
    writeFileSync(join(runDir, "summary.md"), "| `rule-a` | | |\n| `rule-b` | | |");
    const ids = loadProposedRuleIds(runDir);
    // Should only have rule-a from proposed-rules.json, not rule-b from summary.md
    expect(ids).toEqual(["rule-a"]);
  });
});

describe("calibrate-finalize-debate logic", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "finalize-test-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("detects early-stop when all critic reviews are high-confidence REJECT", () => {
    writeFileSync(join(runDir, "debate.json"), JSON.stringify({
      critic: {
        summary: "rejected=2",
        reviews: [
          { ruleId: "a", decision: "REJECT", confidence: "high", pro: [], con: ["weak"], reason: "x" },
          { ruleId: "b", decision: "REJECT", confidence: "high", pro: [], con: ["weak"], reason: "y" },
        ],
      },
    }));

    const debate = parseDebateResult(runDir)!;
    const reviews = debate.critic!.reviews;
    const allHighConfidenceReject = reviews.length > 0 && reviews.every((r) =>
      r.decision.trim().toUpperCase() === "REJECT" && r.confidence === "high"
    );
    expect(allHighConfidenceReject).toBe(true);
  });

  it("does NOT early-stop when reviews are mixed", () => {
    writeFileSync(join(runDir, "debate.json"), JSON.stringify({
      critic: {
        summary: "approved=1 rejected=1",
        reviews: [
          { ruleId: "a", decision: "APPROVE", confidence: "high", reason: "x" },
          { ruleId: "b", decision: "REJECT", confidence: "medium", reason: "y" },
        ],
      },
    }));

    const debate = parseDebateResult(runDir)!;
    const reviews = debate.critic!.reviews;
    const allHighConfidenceReject = reviews.length > 0 && reviews.every((r) =>
      r.decision.trim().toUpperCase() === "REJECT" && r.confidence === "high"
    );
    expect(allHighConfidenceReject).toBe(false);
  });

  it("detects low-confidence-hold when all arbitrator decisions are hold", () => {
    writeFileSync(join(runDir, "debate.json"), JSON.stringify({
      critic: { summary: "revised=2", reviews: [] },
      arbitrator: {
        summary: "hold=2",
        decisions: [
          { ruleId: "a", decision: "hold" },
          { ruleId: "b", decision: "hold" },
        ],
      },
    }));

    const debate = parseDebateResult(runDir)!;
    const decisions = debate.arbitrator!.decisions;
    const allHold = decisions.length > 0 && decisions.every((d) =>
      d.decision.trim().toLowerCase() === "hold"
    );
    expect(allHold).toBe(true);
  });

  it("no stoppingReason for normal completion", () => {
    writeFileSync(join(runDir, "debate.json"), JSON.stringify({
      critic: { summary: "approved=1", reviews: [] },
      arbitrator: {
        summary: "applied=1",
        decisions: [
          { ruleId: "a", decision: "applied", before: -10, after: -7 },
        ],
      },
    }));

    const debate = parseDebateResult(runDir)!;
    const decisions = debate.arbitrator!.decisions;
    const allHold = decisions.length > 0 && decisions.every((d) =>
      d.decision.trim().toLowerCase() === "hold"
    );
    expect(allHold).toBe(false);
  });

  it("returns null for missing debate.json", () => {
    expect(parseDebateResult(runDir)).toBeNull();
  });
});
