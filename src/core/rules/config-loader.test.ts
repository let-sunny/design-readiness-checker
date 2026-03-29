import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { loadConfigFile, mergeConfigs } from "./config-loader.js";
import type { ConfigFile } from "./config-loader.js";
import type { RuleConfig } from "../../contracts/rule.js";

describe("loadConfigFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads a valid config file with all optional fields", async () => {
    const config = {
      excludeNodeTypes: ["SLICE"],
      excludeNodeNames: ["_ignore"],
      gridBase: 4,
      rules: {
        "no-auto-layout": { score: -8, severity: "blocking", enabled: false },
      },
    };
    const filePath = join(tempDir, "config.json");
    writeFileSync(filePath, JSON.stringify(config));

    const result = await loadConfigFile(filePath);
    expect(result.gridBase).toBe(4);

    expect(result.excludeNodeTypes).toEqual(["SLICE"]);
    expect(result.excludeNodeNames).toEqual(["_ignore"]);
    expect(result.rules?.["no-auto-layout"]?.score).toBe(-8);
    expect(result.rules?.["no-auto-layout"]?.severity).toBe("blocking");
    expect(result.rules?.["no-auto-layout"]?.enabled).toBe(false);
  });

  it("loads a minimal empty config", async () => {
    const filePath = join(tempDir, "empty.json");
    writeFileSync(filePath, "{}");

    const result = await loadConfigFile(filePath);
    expect(result).toEqual({});
  });

  it("throws for invalid types", async () => {
    const invalid = { gridBase: "not-a-number" };
    const filePath = join(tempDir, "invalid.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadConfigFile(filePath)).rejects.toThrow();
  });

  it("throws for non-existent file", async () => {
    await expect(
      loadConfigFile(join(tempDir, "nope.json"))
    ).rejects.toThrow();
  });

  it("throws for invalid severity in rule override", async () => {
    const invalid = {
      rules: {
        "some-rule": { severity: "critical" }, // not a valid severity
      },
    };
    const filePath = join(tempDir, "bad-severity.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadConfigFile(filePath)).rejects.toThrow();
  });

  it("throws for positive score in rule override", async () => {
    const invalid = {
      rules: {
        "some-rule": { score: 5 }, // must be <= 0
      },
    };
    const filePath = join(tempDir, "bad-score.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadConfigFile(filePath)).rejects.toThrow();
  });

  it("throws for unknown rule ID", async () => {
    const invalid = {
      rules: {
        "nonexistent-rule": { score: -5 },
      },
    };
    const filePath = join(tempDir, "unknown-rule.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadConfigFile(filePath)).rejects.toThrow(/Unknown rule ID[\s\S]*Valid IDs/i);
  });
});

describe("mergeConfigs", () => {
  const baseConfigs: Record<string, RuleConfig> = {
    "irregular-spacing": {
      severity: "missing-info",
      score: -2,
      enabled: true,
      options: { gridBase: 4 },
    },
    "raw-value": {
      severity: "missing-info",
      score: -3,
      enabled: true,
    },
    "no-auto-layout": {
      severity: "blocking",
      score: -5,
      enabled: true,
    },
  };

  it("returns a copy of base when overrides are empty", () => {
    const overrides: ConfigFile = {};
    const result = mergeConfigs(baseConfigs, overrides);

    expect(result["irregular-spacing"]?.score).toBe(-2);
    expect(result["no-auto-layout"]?.score).toBe(-5);
  });

  it("applies per-rule score override", () => {
    const overrides: ConfigFile = {
      rules: {
        "no-auto-layout": { score: -10 },
      },
    };
    const result = mergeConfigs(baseConfigs, overrides);
    expect(result["no-auto-layout"]?.score).toBe(-10);
    // severity unchanged
    expect(result["no-auto-layout"]?.severity).toBe("blocking");
  });

  it("applies per-rule severity override", () => {
    const overrides: ConfigFile = {
      rules: {
        "no-auto-layout": { severity: "suggestion" },
      },
    };
    const result = mergeConfigs(baseConfigs, overrides);
    expect(result["no-auto-layout"]?.severity).toBe("suggestion");
    // score unchanged
    expect(result["no-auto-layout"]?.score).toBe(-5);
  });

  it("applies per-rule enabled override", () => {
    const overrides: ConfigFile = {
      rules: {
        "no-auto-layout": { enabled: false },
      },
    };
    const result = mergeConfigs(baseConfigs, overrides);
    expect(result["no-auto-layout"]?.enabled).toBe(false);
  });

  it("applies gridBase to rules with gridBase in options", () => {
    const overrides: ConfigFile = { gridBase: 8 };
    const result = mergeConfigs(baseConfigs, overrides);

    expect(
      (result["irregular-spacing"]?.options as Record<string, unknown>)?.["gridBase"]
    ).toBe(8);
    // no-auto-layout has no options, should be unaffected
    expect(result["no-auto-layout"]?.options).toBeUndefined();
  });

  it("does not modify base configs object", () => {
    const overrides: ConfigFile = {
      gridBase: 8,
      rules: {
        "no-auto-layout": { score: -10 },
      },
    };
    mergeConfigs(baseConfigs, overrides);

    // Original should be unchanged
    expect(baseConfigs["no-auto-layout"]?.score).toBe(-5);
    expect(
      (baseConfigs["irregular-spacing"]?.options as Record<string, unknown>)?.["gridBase"]
    ).toBe(4);
  });

  it("ignores rule overrides for non-existent rules", () => {
    const overrides: ConfigFile = {
      rules: {
        "nonexistent-rule": { score: -99 },
      },
    };
    const result = mergeConfigs(baseConfigs, overrides);
    expect(result["nonexistent-rule"]).toBeUndefined();
  });
});
