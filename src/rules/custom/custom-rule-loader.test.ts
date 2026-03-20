import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { loadCustomRules } from "./custom-rule-loader.js";

describe("loadCustomRules", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "custom-rule-loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads valid custom rules and returns rules + configs", async () => {
    const rules = [
      {
        id: "my-custom-rule",
        category: "layout",
        severity: "risk",
        score: -3,
        prompt: "Check for something",
        why: "Because it matters",
        impact: "Causes confusion",
        fix: "Fix the thing",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const result = await loadCustomRules(filePath);

    expect(result.rules).toHaveLength(1);
    const rule = result.rules[0];
    expect(rule).toBeDefined();
    expect(rule!.definition.id).toBe("my-custom-rule");
    expect(rule!.definition.category).toBe("layout");
    expect(rule!.definition.why).toBe("Because it matters");
    expect(rule!.definition.impact).toBe("Causes confusion");
    expect(rule!.definition.fix).toBe("Fix the thing");
    // name is derived from id
    expect(rule!.definition.name).toBe("My Custom Rule");

    const config = result.configs["my-custom-rule"];
    expect(config).toBeDefined();
    expect(config!.severity).toBe("risk");
    expect(config!.score).toBe(-3);
    expect(config!.enabled).toBe(true);
  });

  it("loads multiple custom rules", async () => {
    const rules = [
      {
        id: "rule-a",
        category: "token",
        severity: "blocking",
        score: -5,
        prompt: "Check A",
        why: "A reason",
        impact: "A impact",
        fix: "A fix",
      },
      {
        id: "rule-b",
        category: "naming",
        severity: "suggestion",
        score: -1,
        prompt: "Check B",
        why: "B reason",
        impact: "B impact",
        fix: "B fix",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const result = await loadCustomRules(filePath);
    expect(result.rules).toHaveLength(2);
    expect(Object.keys(result.configs)).toHaveLength(2);
    expect(result.configs["rule-a"]?.severity).toBe("blocking");
    expect(result.configs["rule-b"]?.severity).toBe("suggestion");
  });

  it("returns empty rules and configs for empty array", async () => {
    const filePath = join(tempDir, "empty.json");
    writeFileSync(filePath, "[]");

    const result = await loadCustomRules(filePath);
    expect(result.rules).toHaveLength(0);
    expect(Object.keys(result.configs)).toHaveLength(0);
  });

  it("throws Zod validation error for missing required fields", async () => {
    const invalid = [{ id: "bad-rule" }]; // missing most required fields
    const filePath = join(tempDir, "invalid.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadCustomRules(filePath)).rejects.toThrow();
  });

  it("throws Zod validation error for invalid category", async () => {
    const invalid = [
      {
        id: "bad-rule",
        category: "not-a-category",
        severity: "risk",
        score: -1,
        prompt: "Check",
        why: "Why",
        impact: "Impact",
        fix: "Fix",
      },
    ];
    const filePath = join(tempDir, "invalid-cat.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadCustomRules(filePath)).rejects.toThrow();
  });

  it("throws Zod validation error for positive score", async () => {
    const invalid = [
      {
        id: "bad-rule",
        category: "layout",
        severity: "risk",
        score: 5, // must be <= 0
        prompt: "Check",
        why: "Why",
        impact: "Impact",
        fix: "Fix",
      },
    ];
    const filePath = join(tempDir, "invalid-score.json");
    writeFileSync(filePath, JSON.stringify(invalid));

    await expect(loadCustomRules(filePath)).rejects.toThrow();
  });

  it("throws for non-existent file", async () => {
    await expect(
      loadCustomRules(join(tempDir, "nonexistent.json"))
    ).rejects.toThrow();
  });

  it("check function returns null for DOCUMENT and CANVAS nodes", async () => {
    const rules = [
      {
        id: "test-rule",
        category: "layout",
        severity: "risk",
        score: -2,
        prompt: "Check something",
        why: "Why",
        impact: "Impact",
        fix: "Fix",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const result = await loadCustomRules(filePath);
    const rule = result.rules[0];
    expect(rule).toBeDefined();

    const mockContext = {
      file: {} as never,
      depth: 0,
      maxDepth: 5,
      path: [],
    };

    // DOCUMENT node -> null
    const docResult = rule!.check(
      { id: "1", name: "Doc", type: "DOCUMENT", visible: true },
      mockContext
    );
    expect(docResult).toBeNull();

    // CANVAS node -> null
    const canvasResult = rule!.check(
      { id: "2", name: "Page", type: "CANVAS", visible: true },
      mockContext
    );
    expect(canvasResult).toBeNull();

    // FRAME node -> null (placeholder returns null)
    const frameResult = rule!.check(
      { id: "3", name: "Frame", type: "FRAME", visible: true },
      mockContext
    );
    expect(frameResult).toBeNull();
  });
});
