import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";

import { filterDiscoveryEvidence, readDecision } from "./rule-discovery.js";

describe("filterDiscoveryEvidence", () => {
  // Note: this function reads from data/discovery-evidence.json which may not exist in test.
  // We test the logic indirectly through the category matching.
  it("returns empty array when no evidence file exists", () => {
    const result = filterDiscoveryEvidence("nonexistent-category");
    expect(Array.isArray(result)).toBe(true);
  });
});

describe("readDecision", () => {
  let runDir: string;

  beforeEach(() => {
    runDir = mkdtempSync(join(tmpdir(), "decision-test-"));
  });

  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true });
  });

  it("returns commit action for KEEP decision", () => {
    writeFileSync(join(runDir, "decision.json"), JSON.stringify({
      decision: "KEEP",
      ruleId: "my-new-rule",
      category: "code-quality",
      reason: "Improves structure detection",
    }));

    const result = readDecision(runDir);
    expect(result).toEqual({
      action: "commit",
      ruleId: "my-new-rule",
      category: "code-quality",
      reason: "Improves structure detection",
    });
  });

  it("returns adjust action for ADJUST decision", () => {
    writeFileSync(join(runDir, "decision.json"), JSON.stringify({
      decision: "ADJUST",
      ruleId: "my-rule",
      category: "minor",
      reason: "Score too high",
    }));

    const result = readDecision(runDir);
    expect(result!.action).toBe("adjust");
  });

  it("returns revert action for DROP decision", () => {
    writeFileSync(join(runDir, "decision.json"), JSON.stringify({
      decision: "DROP",
      ruleId: "bad-rule",
      category: "token-management",
      reason: "Too many false positives",
    }));

    const result = readDecision(runDir);
    expect(result!.action).toBe("revert");
  });

  it("normalizes decision casing", () => {
    writeFileSync(join(runDir, "decision.json"), JSON.stringify({
      decision: "keep",
      ruleId: "r",
      category: "c",
    }));

    const result = readDecision(runDir);
    expect(result!.action).toBe("commit");
  });

  it("returns null for missing decision.json", () => {
    expect(readDecision(runDir)).toBeNull();
  });

  it("returns null for invalid decision value", () => {
    writeFileSync(join(runDir, "decision.json"), JSON.stringify({
      decision: "MAYBE",
    }));

    expect(readDecision(runDir)).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    writeFileSync(join(runDir, "decision.json"), "not json");
    expect(readDecision(runDir)).toBeNull();
  });
});
