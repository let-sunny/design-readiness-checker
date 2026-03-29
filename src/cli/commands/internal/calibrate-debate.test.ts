import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

/**
 * Import the functions directly to test as units.
 * These are the same functions the CLI commands call.
 */

// We can't import the CLI registration functions directly (they register on CAC),
// so we test the underlying logic by importing from the modules they depend on.
import { parseDebateResult } from "../../../agents/run-directory.js";
import { loadCalibrationEvidence } from "../../../agents/evidence-collector.js";

describe("calibrate-gather-evidence logic", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "gather-test-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("conversion.json ruleImpactAssessment is parseable", () => {
    writeFileSync(join(runDir, "conversion.json"), JSON.stringify({
      ruleImpactAssessment: [
        { ruleId: "no-auto-layout", issueCount: 3, actualImpact: "easy" },
      ],
      uncoveredStruggles: [
        { description: "border radius mismatch" },
      ],
    }));

    const conv = JSON.parse(readFileSync(join(runDir, "conversion.json"), "utf-8")) as Record<string, unknown>;
    expect(Array.isArray(conv["ruleImpactAssessment"])).toBe(true);
    expect(conv["ruleImpactAssessment"]).toHaveLength(1);
    expect(Array.isArray(conv["uncoveredStruggles"])).toBe(true);
  });

  it("gaps.json actionable filtering works", () => {
    writeFileSync(join(runDir, "gaps.json"), JSON.stringify({
      gaps: [
        { category: "spacing", actionable: true, description: "padding off" },
        { category: "rendering", actionable: false, description: "font fallback" },
      ],
    }));

    const gaps = JSON.parse(readFileSync(join(runDir, "gaps.json"), "utf-8")) as Record<string, unknown>;
    const gapList = Array.isArray(gaps["gaps"]) ? gaps["gaps"] : [];
    const actionable = gapList.filter(
      (g): g is Record<string, unknown> =>
        typeof g === "object" && g !== null && (g as Record<string, unknown>)["actionable"] === true
    );
    expect(actionable).toHaveLength(1);
    expect((actionable[0] as Record<string, unknown>)["description"]).toBe("padding off");
  });

  it("proposed ruleIds are extracted from summary.md", () => {
    writeFileSync(join(runDir, "summary.md"), "## Overscored\n| `no-auto-layout` | -10 | easy |\n| `raw-value` | -3 | moderate |");

    const content = readFileSync(join(runDir, "summary.md"), "utf-8");
    const ids = new Set<string>();
    for (const match of content.matchAll(/`([a-z][\w-]*)`/g)) {
      if (match[1]) ids.add(match[1]);
    }
    expect([...ids]).toContain("no-auto-layout");
    expect([...ids]).toContain("raw-value");
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
    expect(debate.critic).not.toBeNull();
    expect(debate.arbitrator).toBeNull();

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
    const debate = parseDebateResult(runDir);
    expect(debate).toBeNull();
  });
});
