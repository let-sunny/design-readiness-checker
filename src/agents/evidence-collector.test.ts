import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadCalibrationEvidence,
  appendCalibrationEvidence,
  enrichCalibrationEvidence,
  pruneCalibrationEvidence,
  computeEvidenceRatio,
  loadDiscoveryEvidence,
  appendDiscoveryEvidence,
  pruneDiscoveryEvidence,
  DISCOVERY_EVIDENCE_SCHEMA_VERSION,
} from "./evidence-collector.js";
import type {
  CalibrationEvidenceEntry,
  CrossRunEvidenceGroup,
  DiscoveryEvidenceEntry,
} from "./evidence-collector.js";

describe("evidence-collector", () => {
  const tmpDir = join(tmpdir(), "canicode-evidence-test");
  const calPath = join(tmpDir, "calibration-evidence.json");
  const disPath = join(tmpDir, "discovery-evidence.json");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  // --- Calibration evidence ---

  describe("loadCalibrationEvidence", () => {
    it("returns empty object when file does not exist", () => {
      const result = loadCalibrationEvidence(calPath);
      expect(result).toEqual({});
    });

    it("returns empty object for empty array", () => {
      writeFileSync(calPath, "[]", "utf-8");
      const result = loadCalibrationEvidence(calPath);
      expect(result).toEqual({});
    });

    it("groups entries by ruleId correctly", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "moderate", fixture: "fx2", timestamp: "t2" },
        { ruleId: "rule-a", type: "underscored", actualDifficulty: "hard", fixture: "fx3", timestamp: "t3" },
        { ruleId: "rule-b", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t1" },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      const result = loadCalibrationEvidence(calPath);

      expect(result["rule-a"]).toEqual({
        overscoredCount: 2,
        underscoredCount: 1,
        overscoredDifficulties: ["easy", "moderate"],
        underscoredDifficulties: ["hard"],
        allPro: [],
        allCon: [],
      });
      expect(result["rule-b"]).toEqual({
        overscoredCount: 0,
        underscoredCount: 1,
        overscoredDifficulties: [],
        underscoredDifficulties: ["hard"],
        allPro: [],
        allCon: [],
      });
    });

    it("deduplicates pro/con across entries", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1",
          pro: ["easy in practice", "common pattern"], con: ["small fixture"] },
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx2", timestamp: "t2",
          pro: ["easy in practice", "new evidence"], con: ["small fixture", "single run"] },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      const result = loadCalibrationEvidence(calPath);
      expect(result["rule-a"]!.allPro).toEqual(["easy in practice", "common pattern", "new evidence"]);
      expect(result["rule-a"]!.allCon).toEqual(["small fixture", "single run"]);
    });

    it("handles malformed JSON gracefully", () => {
      writeFileSync(calPath, "not json", "utf-8");
      const result = loadCalibrationEvidence(calPath);
      expect(result).toEqual({});
    });
  });

  describe("appendCalibrationEvidence", () => {
    it("creates file and appends entries", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ];
      appendCalibrationEvidence(entries, calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(1);
      expect(raw[0]!.ruleId).toBe("rule-a");
    });

    it("appends to existing entries", () => {
      writeFileSync(calPath, JSON.stringify([
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ]), "utf-8");

      appendCalibrationEvidence([
        { ruleId: "rule-b", type: "underscored", actualDifficulty: "hard", fixture: "fx2", timestamp: "t2" },
      ], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(2);
    });

    it("replaces prior entry for same ruleId and fixture (latest run wins)", () => {
      writeFileSync(calPath, JSON.stringify([
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ]), "utf-8");

      appendCalibrationEvidence([
        { ruleId: "rule-a", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t2" },
      ], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(1);
      expect(raw[0]!.type).toBe("underscored");
    });

    it("dedupes within a single append call (last row for same ruleId and fixture wins)", () => {
      appendCalibrationEvidence([
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
        { ruleId: "rule-a", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t2" },
      ], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(1);
      expect(raw[0]!.type).toBe("underscored");
    });

    it("does nothing for empty entries", () => {
      writeFileSync(calPath, "[]", "utf-8");
      appendCalibrationEvidence([], calPath);
      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(0);
    });
  });

  describe("enrichCalibrationEvidence", () => {
    it("enriches entries matching (ruleId, fixture)", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "moderate", fixture: "fx2", timestamp: "t2" },
        { ruleId: "rule-b", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t3" },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      enrichCalibrationEvidence(
        [{ ruleId: "rule-a", confidence: "high", pro: ["easy in practice"], con: ["only 1 case"], decision: "APPROVE" }],
        "fx1",
        calPath,
      );

      const result = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      // Only fx1 entry for rule-a is enriched
      expect(result[0]!.confidence).toBe("high");
      expect(result[0]!.pro).toEqual(["easy in practice"]);
      // fx2 entry for rule-a is NOT enriched (different fixture)
      expect(result[1]!.confidence).toBeUndefined();
      // rule-b is NOT enriched (different ruleId)
      expect(result[2]!.confidence).toBeUndefined();
    });

    it("does nothing when evidence file is empty", () => {
      enrichCalibrationEvidence([{ ruleId: "rule-a" }], "fx1", calPath);
      expect(existsSync(calPath)).toBe(false);
    });

    it("does nothing when reviews array is empty", () => {
      writeFileSync(calPath, JSON.stringify([
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ]), "utf-8");
      enrichCalibrationEvidence([], "fx1", calPath);
      const result = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(result[0]!.confidence).toBeUndefined();
    });
  });

  describe("pruneCalibrationEvidence", () => {
    it("removes entries for specified ruleIds", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx2", timestamp: "t2" },
        { ruleId: "rule-b", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t1" },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      pruneCalibrationEvidence(["rule-a"], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(1);
      expect(raw[0]!.ruleId).toBe("rule-b");
    });

    it("trims ruleIds when matching stored entries", () => {
      writeFileSync(calPath, JSON.stringify([
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ]), "utf-8");

      pruneCalibrationEvidence(["  rule-a  "], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(0);
    });

    it("does nothing for empty ruleIds", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      pruneCalibrationEvidence([], calPath);

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(1);
    });

    it("handles missing file gracefully", () => {
      expect(() => pruneCalibrationEvidence(["rule-a"], calPath)).not.toThrow();
    });

    it("prunes only matching fixture when fixture is specified", () => {
      const entries: CalibrationEvidenceEntry[] = [
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx1", timestamp: "t1" },
        { ruleId: "rule-a", type: "overscored", actualDifficulty: "easy", fixture: "fx2", timestamp: "t2" },
        { ruleId: "rule-b", type: "underscored", actualDifficulty: "hard", fixture: "fx1", timestamp: "t1" },
      ];
      writeFileSync(calPath, JSON.stringify(entries), "utf-8");

      pruneCalibrationEvidence(["rule-a"], calPath, "fx1");

      const raw = JSON.parse(readFileSync(calPath, "utf-8")) as CalibrationEvidenceEntry[];
      expect(raw).toHaveLength(2);
      // rule-a fx2 should survive, rule-b fx1 should survive
      expect(raw.map(e => `${e.ruleId}:${e.fixture}`)).toEqual(["rule-a:fx2", "rule-b:fx1"]);
    });
  });

  // --- Evidence ratio computation ---

  describe("computeEvidenceRatio", () => {
    it("returns insufficient for empty group", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 0,
        underscoredCount: 0,
        overscoredDifficulties: [],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.confidence).toBe("insufficient");
      expect(ratio.totalSamples).toBe(0);
      expect(ratio.dominantDirection).toBe("mixed");
    });

    it("detects clear overscored direction (7/10 = 70%)", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 7,
        underscoredCount: 3,
        overscoredDifficulties: ["easy", "easy", "easy", "easy", "moderate", "easy", "easy"],
        underscoredDifficulties: ["hard", "hard", "failed"],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.totalSamples).toBe(10);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.dominantRate).toBe(0.7);
      expect(ratio.expectedDifficulty).toBe("easy");
      expect(ratio.confidence).toBe("high");
      expect(ratio.summary).toContain("overscored");
      expect(ratio.summary).toContain("7/10");
    });

    it("detects clear underscored direction (7/10 = 70%)", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 3,
        underscoredCount: 7,
        overscoredDifficulties: ["easy", "easy", "easy"],
        underscoredDifficulties: ["hard", "hard", "failed", "hard", "hard", "failed", "hard"],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("underscored");
      expect(ratio.dominantRate).toBe(0.7);
      expect(ratio.expectedDifficulty).toBe("hard");
      expect(ratio.confidence).toBe("high");
    });

    it("returns mixed when neither side has 60%+ majority", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 5,
        underscoredCount: 5,
        overscoredDifficulties: ["easy", "easy", "easy", "moderate", "easy"],
        underscoredDifficulties: ["hard", "hard", "hard", "failed", "hard"],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("mixed");
      expect(ratio.confidence).toBe("low");
      expect(ratio.summary).toContain("Mixed signals");
    });

    it("returns insufficient confidence for < 2 samples", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 1,
        underscoredCount: 0,
        overscoredDifficulties: ["easy"],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.confidence).toBe("insufficient");
    });

    it("returns medium confidence for 2 samples with 100% dominance", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 2,
        underscoredCount: 0,
        overscoredDifficulties: ["easy", "easy"],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.confidence).toBe("medium");
    });

    it("returns medium confidence for 60%+ with 3-4 samples", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 2,
        underscoredCount: 1,
        overscoredDifficulties: ["easy", "easy"],
        underscoredDifficulties: ["hard"],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.confidence).toBe("medium");
      expect(ratio.dominantRate).toBeCloseTo(0.667, 2);
    });

    it("returns high confidence for 3 samples with 100% dominance", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 3,
        underscoredCount: 0,
        overscoredDifficulties: ["easy", "easy", "moderate"],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.dominantRate).toBe(1);
      expect(ratio.confidence).toBe("high");
    });

    it("handles all-one-direction case", () => {
      const group: CrossRunEvidenceGroup = {
        overscoredCount: 5,
        underscoredCount: 0,
        overscoredDifficulties: ["easy", "easy", "moderate", "easy", "easy"],
        underscoredDifficulties: [],
        allPro: [],
        allCon: [],
      };
      const ratio = computeEvidenceRatio(group);
      expect(ratio.dominantDirection).toBe("overscored");
      expect(ratio.dominantRate).toBe(1);
      expect(ratio.confidence).toBe("high");
    });
  });

  // --- Discovery evidence ---

  describe("loadDiscoveryEvidence", () => {
    it("returns empty array when file does not exist", () => {
      const result = loadDiscoveryEvidence(disPath);
      expect(result).toEqual([]);
    });

    it("loads entries from versioned format", () => {
      const file = {
        schemaVersion: DISCOVERY_EVIDENCE_SCHEMA_VERSION,
        entries: [
          { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        ],
      };
      writeFileSync(disPath, JSON.stringify(file), "utf-8");

      const result = loadDiscoveryEvidence(disPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe("pixel-critical");
    });

    it("loads entries from legacy plain-array format (v0 fallback)", () => {
      const entries: DiscoveryEvidenceEntry[] = [
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ];
      writeFileSync(disPath, JSON.stringify(entries), "utf-8");

      const result = loadDiscoveryEvidence(disPath);
      expect(result).toHaveLength(1);
      expect(result[0]!.category).toBe("pixel-critical");
    });

    it("handles malformed JSON gracefully", () => {
      writeFileSync(disPath, "not json", "utf-8");
      const result = loadDiscoveryEvidence(disPath);
      expect(result).toEqual([]);
    });

    it("skips invalid entries in legacy array", () => {
      writeFileSync(disPath, JSON.stringify([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        { bad: "entry" },
      ]), "utf-8");

      const result = loadDiscoveryEvidence(disPath);
      expect(result).toHaveLength(1);
    });

    it("skips invalid entries in versioned format (partial corruption)", () => {
      const file = {
        schemaVersion: DISCOVERY_EVIDENCE_SCHEMA_VERSION,
        entries: [
          { description: "good", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
          { bad: "entry" },
          { description: "also good", category: "color", impact: "easy", fixture: "fx2", timestamp: "t2", source: "gap-analysis" },
        ],
      };
      writeFileSync(disPath, JSON.stringify(file), "utf-8");

      const result = loadDiscoveryEvidence(disPath);
      expect(result).toHaveLength(2);
      expect(result[0]!.description).toBe("good");
      expect(result[1]!.description).toBe("also good");
    });

    it("throws on unsupported schemaVersion to prevent silent overwrite", () => {
      const file = {
        schemaVersion: 999,
        entries: [
          { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        ],
      };
      writeFileSync(disPath, JSON.stringify(file), "utf-8");

      expect(() => loadDiscoveryEvidence(disPath)).toThrow(/Unsupported discovery-evidence schemaVersion: 999/);
    });
  });

  describe("appendDiscoveryEvidence", () => {
    it("creates file in versioned format", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "gap-analysis" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { schemaVersion: number; entries: DiscoveryEvidenceEntry[] };
      expect(raw.schemaVersion).toBe(DISCOVERY_EVIDENCE_SCHEMA_VERSION);
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.source).toBe("gap-analysis");
    });

    it("appends to existing entries (different keys)", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      appendDiscoveryEvidence([
        { description: "gap2", category: "code-quality", impact: "moderate", fixture: "fx2", timestamp: "t2", source: "gap-analysis" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(2);
    });

    it("deduplicates by (category + description + fixture), last-write-wins", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      // Same category+description+fixture, different impact/timestamp → replaces
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "moderate", fixture: "fx1", timestamp: "t2", source: "evaluation" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.impact).toBe("moderate");
      expect(raw.entries[0]!.timestamp).toBe("t2");
    });

    it("dedupe is case-insensitive for category and description", () => {
      appendDiscoveryEvidence([
        { description: "Gap One", category: "Pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      appendDiscoveryEvidence([
        { description: "gap one", category: "pixel-critical", impact: "easy", fixture: "fx1", timestamp: "t2", source: "evaluation" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.impact).toBe("easy");
    });

    it("dedupe is case-insensitive for fixture", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "FX1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "easy", fixture: "fx1", timestamp: "t2", source: "evaluation" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.impact).toBe("easy");
    });

    it("dedupes within a single append call (last row wins)", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        { description: "gap1", category: "pixel-critical", impact: "easy", fixture: "fx1", timestamp: "t2", source: "evaluation" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.impact).toBe("easy");
    });

    it("same description different fixture → kept as separate entries", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx2", timestamp: "t1", source: "evaluation" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(2);
    });

    it("migrates legacy array to versioned format on append", () => {
      // Write legacy format
      writeFileSync(disPath, JSON.stringify([
        { description: "old", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t0", source: "evaluation" },
      ]), "utf-8");

      appendDiscoveryEvidence([
        { description: "new", category: "pixel-critical", impact: "easy", fixture: "fx2", timestamp: "t1", source: "gap-analysis" },
      ], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { schemaVersion: number; entries: DiscoveryEvidenceEntry[] };
      expect(raw.schemaVersion).toBe(DISCOVERY_EVIDENCE_SCHEMA_VERSION);
      expect(raw.entries).toHaveLength(2);
    });

    it("does nothing for empty entries", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);
      const before = readFileSync(disPath, "utf-8");

      appendDiscoveryEvidence([], disPath);

      const after = readFileSync(disPath, "utf-8");
      expect(after).toBe(before);
    });

    it("warns on non-standard category", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      appendDiscoveryEvidence([
        { description: "gap1", category: "old-structure", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Non-standard category "old-structure"'));
      spy.mockRestore();
    });

    it("does not warn on standard category", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("throws when file has unsupported schemaVersion", () => {
      const file = { schemaVersion: 999, entries: [] };
      writeFileSync(disPath, JSON.stringify(file), "utf-8");
      const before = readFileSync(disPath, "utf-8");

      expect(() => appendDiscoveryEvidence([
        { description: "new", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath)).toThrow(/Unsupported discovery-evidence schemaVersion/);

      // File must not be overwritten
      expect(readFileSync(disPath, "utf-8")).toBe(before);
    });
  });

  describe("pruneDiscoveryEvidence", () => {
    it("removes entries for specified categories (case-insensitive)", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "Pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
        { description: "gap2", category: "pixel-critical", impact: "hard", fixture: "fx2", timestamp: "t2", source: "gap-analysis" },
        { description: "gap3", category: "token-management", impact: "moderate", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      pruneDiscoveryEvidence(["pixel-critical"], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
      expect(raw.entries[0]!.category).toBe("token-management");
    });

    it("writes versioned format after prune", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      pruneDiscoveryEvidence(["pixel-critical"], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { schemaVersion: number; entries: DiscoveryEvidenceEntry[] };
      expect(raw.schemaVersion).toBe(DISCOVERY_EVIDENCE_SCHEMA_VERSION);
      expect(raw.entries).toHaveLength(0);
    });

    it("does nothing for empty categories", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      pruneDiscoveryEvidence([], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(1);
    });

    it("trims categories when matching", () => {
      appendDiscoveryEvidence([
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ], disPath);

      pruneDiscoveryEvidence(["  pixel-critical  "], disPath);

      const raw = JSON.parse(readFileSync(disPath, "utf-8")) as { entries: DiscoveryEvidenceEntry[] };
      expect(raw.entries).toHaveLength(0);
    });

    it("throws when file has unsupported schemaVersion", () => {
      const file = { schemaVersion: 999, entries: [
        { description: "gap1", category: "pixel-critical", impact: "hard", fixture: "fx1", timestamp: "t1", source: "evaluation" },
      ]};
      writeFileSync(disPath, JSON.stringify(file), "utf-8");
      const before = readFileSync(disPath, "utf-8");

      expect(() => pruneDiscoveryEvidence(["pixel-critical"], disPath)).toThrow(/Unsupported discovery-evidence schemaVersion/);

      expect(readFileSync(disPath, "utf-8")).toBe(before);
    });
  });
});
