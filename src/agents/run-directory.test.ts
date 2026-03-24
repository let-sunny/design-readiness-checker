import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import {
  extractFixtureName,
  parseRunDirName,
  createCalibrationRunDir,
  createRuleDiscoveryRunDir,
  listCalibrationRuns,
  extractAppliedRuleIds,
  isConverged,
} from "./run-directory.js";

describe("extractFixtureName", () => {
  it("extracts name from fixture directory path", () => {
    expect(extractFixtureName("fixtures/material3-kit")).toBe("material3-kit");
  });

  it("extracts name from data.json path", () => {
    expect(extractFixtureName("fixtures/material3-kit/data.json")).toBe("material3-kit");
  });

  it("handles trailing slash", () => {
    expect(extractFixtureName("fixtures/something/")).toBe("something");
  });

  it("handles nested directory paths", () => {
    expect(extractFixtureName("a/b/c/deep-nested")).toBe("deep-nested");
  });
});

describe("parseRunDirName", () => {
  it("splits on last double-dash", () => {
    const result = parseRunDirName("material3-kit--2026-03-24-0200");
    expect(result.name).toBe("material3-kit");
    expect(result.timestamp).toBe("2026-03-24-0200");
  });

  it("handles names with multiple dashes", () => {
    const result = parseRunDirName("simple-ds-card-grid--2026-03-24-0200");
    expect(result.name).toBe("simple-ds-card-grid");
    expect(result.timestamp).toBe("2026-03-24-0200");
  });

  it("returns full string as name when no double-dash", () => {
    const result = parseRunDirName("no-separator");
    expect(result.name).toBe("no-separator");
    expect(result.timestamp).toBe("");
  });
});

describe("createCalibrationRunDir", () => {
  const origCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "run-dir-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates directory and returns path with fixture name and timestamp", () => {
    const runDir = createCalibrationRunDir("material3-kit");
    expect(existsSync(runDir)).toBe(true);

    const dirName = basename(runDir);
    expect(dirName).toMatch(/^material3-kit--\d{4}-\d{2}-\d{2}-\d{4}$/);
  });

  it("creates directory under logs/calibration/", () => {
    const runDir = createCalibrationRunDir("test-fixture");
    expect(runDir).toContain("logs/calibration/");
  });
});

describe("createRuleDiscoveryRunDir", () => {
  const origCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "run-dir-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates directory with date-only timestamp", () => {
    const runDir = createRuleDiscoveryRunDir("text-alignment");
    expect(existsSync(runDir)).toBe(true);

    const dirName = basename(runDir);
    expect(dirName).toMatch(/^text-alignment--\d{4}-\d{2}-\d{2}$/);
  });
});

describe("extractAppliedRuleIds", () => {
  it("trims ruleId and normalizes decision casing", () => {
    const ids = extractAppliedRuleIds({
      critic: null,
      arbitrator: {
        summary: "test",
        decisions: [
          { ruleId: "  my-rule  ", decision: "Applied" },
          { ruleId: "b", decision: "REVISED" },
          { ruleId: "c", decision: "rejected" },
        ],
      },
    });
    expect(ids).toEqual(["my-rule", "b"]);
  });

  it("returns empty array when arbitrator is null", () => {
    expect(extractAppliedRuleIds({ critic: null, arbitrator: null })).toEqual([]);
  });

  it("returns empty array when no applied/revised decisions", () => {
    const ids = extractAppliedRuleIds({
      critic: null,
      arbitrator: {
        summary: "x",
        decisions: [
          { ruleId: "a", decision: "rejected" },
          { ruleId: "b", decision: "kept" },
        ],
      },
    });
    expect(ids).toEqual([]);
  });
});

describe("isConverged", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "converge-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("strict: false when rejections remain with no applies", () => {
    writeFileSync(
      join(tempDir, "debate.json"),
      JSON.stringify({
        arbitrator: {
          summary: "applied=0 rejected=1",
          decisions: [{ ruleId: "x", decision: "rejected" }],
        },
      }),
    );
    expect(isConverged(tempDir)).toBe(false);
  });

  it("lenient: true when no applied/revised even if rejected", () => {
    writeFileSync(
      join(tempDir, "debate.json"),
      JSON.stringify({
        arbitrator: {
          summary: "applied=0 rejected=1",
          decisions: [{ ruleId: "x", decision: "rejected" }],
        },
      }),
    );
    expect(isConverged(tempDir, { lenient: true })).toBe(true);
  });

  it("returns false when debate.json has missing decisions field (Zod rejects)", () => {
    writeFileSync(
      join(tempDir, "debate.json"),
      JSON.stringify({
        arbitrator: {
          summary: "incomplete",
        },
      }),
    );
    expect(isConverged(tempDir)).toBe(false);
    expect(isConverged(tempDir, { lenient: true })).toBe(false);
  });

  it("returns false when decisions array has malformed entries (Zod rejects)", () => {
    writeFileSync(
      join(tempDir, "debate.json"),
      JSON.stringify({
        arbitrator: {
          summary: "mixed",
          decisions: [null, { ruleId: "x", decision: "rejected" }],
        },
      }),
    );
    // Zod rejects null in decisions array → parseDebateResult returns null
    expect(isConverged(tempDir)).toBe(false);
    expect(isConverged(tempDir, { lenient: true })).toBe(false);
  });
});

describe("listCalibrationRuns", () => {
  const origCwd = process.cwd();
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "run-dir-test-"));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    process.chdir(origCwd);
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when no runs exist", () => {
    expect(listCalibrationRuns()).toEqual([]);
  });

  it("lists run directories sorted, ignoring non-run files", () => {
    const dir1 = createCalibrationRunDir("aaa-fixture");
    const dir2 = createCalibrationRunDir("zzz-fixture");
    const runs = listCalibrationRuns();

    expect(runs.length).toBe(2);
    expect(runs[0]).toBe(dir1);
    expect(runs[1]).toBe(dir2);
  });
});
