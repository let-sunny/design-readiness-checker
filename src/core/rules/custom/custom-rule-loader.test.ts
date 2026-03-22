import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { loadCustomRules } from "./custom-rule-loader.js";
import type { RuleContext } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";

function makeContext(overrides?: Partial<RuleContext>): RuleContext {
  return {
    file: {} as never,
    depth: 2,
    maxDepth: 5,
    path: ["Root", "Section"],
    ...overrides,
  };
}

function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "1",
    name: "TestNode",
    type: "FRAME",
    visible: true,
    ...overrides,
  };
}

describe("loadCustomRules", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "custom-rule-loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads valid custom rules with match conditions and returns rules + configs", async () => {
    const rules = [
      {
        id: "my-custom-rule",
        category: "layout",
        severity: "risk",
        score: -3,
        match: { type: ["FRAME"] },
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
        match: { type: ["TEXT"] },
        why: "A reason",
        impact: "A impact",
        fix: "A fix",
      },
      {
        id: "rule-b",
        category: "naming",
        severity: "suggestion",
        score: -1,
        match: { nameContains: "test" },
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
        match: { type: ["FRAME"] },
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
        match: { type: ["FRAME"] },
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

  it("silently ignores old prompt-only format (backward compat)", async () => {
    const rules = [
      {
        id: "old-rule",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { type: ["FRAME"] },
        prompt: "Check something old-style",
        why: "Why",
        impact: "Impact",
        fix: "Fix",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    // Should not throw — prompt field is silently accepted
    const result = await loadCustomRules(filePath);
    expect(result.rules).toHaveLength(1);
  });

  it("check function returns null for DOCUMENT and CANVAS nodes", async () => {
    const rules = [
      {
        id: "test-rule",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { type: ["FRAME"] },
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

    const ctx = makeContext({ depth: 0, path: [] });

    const docResult = rule!.check(
      makeNode({ id: "1", name: "Doc", type: "DOCUMENT" }),
      ctx
    );
    expect(docResult).toBeNull();

    const canvasResult = rule!.check(
      makeNode({ id: "2", name: "Page", type: "CANVAS" }),
      ctx
    );
    expect(canvasResult).toBeNull();
  });
});

describe("pattern matching - type conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("matches when node type is in the type array", async () => {
    const rules = [
      {
        id: "type-match",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { type: ["FRAME", "GROUP"] },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ type: "FRAME" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "GROUP" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "TEXT" }), ctx)).toBeNull();
  });

  it("excludes when node type is in the notType array", async () => {
    const rules = [
      {
        id: "not-type-match",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { notType: ["TEXT", "VECTOR"] },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ type: "FRAME" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "TEXT" }), ctx)).toBeNull();
    expect(check(makeNode({ type: "VECTOR" }), ctx)).toBeNull();
  });
});

describe("pattern matching - name conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-name-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("matches nameContains (case-insensitive)", async () => {
    const rules = [
      {
        id: "name-contains",
        category: "naming",
        severity: "suggestion",
        score: -1,
        match: { nameContains: "icon" },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ name: "Icon/Close" }), ctx)).not.toBeNull();
    expect(check(makeNode({ name: "my-icon-btn" }), ctx)).not.toBeNull();
    expect(check(makeNode({ name: "Button" }), ctx)).toBeNull();
  });

  it("excludes nameNotContains (case-insensitive)", async () => {
    const rules = [
      {
        id: "name-not-contains",
        category: "naming",
        severity: "suggestion",
        score: -1,
        match: { nameNotContains: "placeholder" },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ name: "Image" }), ctx)).not.toBeNull();
    expect(check(makeNode({ name: "Image Placeholder" }), ctx)).toBeNull();
  });

  it("matches namePattern as regex", async () => {
    const rules = [
      {
        id: "name-pattern",
        category: "naming",
        severity: "suggestion",
        score: -1,
        match: { namePattern: "^(Frame|Group)\\s\\d+$" },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ name: "Frame 123" }), ctx)).not.toBeNull();
    expect(check(makeNode({ name: "Group 7" }), ctx)).not.toBeNull();
    expect(check(makeNode({ name: "Button" }), ctx)).toBeNull();
  });
});

describe("pattern matching - size conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-size-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("matches size constraints", async () => {
    const rules = [
      {
        id: "size-match",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { minWidth: 100, maxWidth: 300, minHeight: 50 },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    // Matching
    expect(
      check(
        makeNode({ absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 } }),
        ctx
      )
    ).not.toBeNull();

    // Too narrow
    expect(
      check(
        makeNode({ absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 100 } }),
        ctx
      )
    ).toBeNull();

    // Too wide
    expect(
      check(
        makeNode({ absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 100 } }),
        ctx
      )
    ).toBeNull();

    // No bounding box
    expect(check(makeNode(), ctx)).toBeNull();
  });
});

describe("pattern matching - layout conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-layout-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks hasAutoLayout", async () => {
    const rules = [
      {
        id: "auto-layout-check",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { hasAutoLayout: false },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    // No layoutMode — matches hasAutoLayout: false
    expect(check(makeNode(), ctx)).not.toBeNull();
    // Has layoutMode — does NOT match hasAutoLayout: false
    expect(check(makeNode({ layoutMode: "HORIZONTAL" }), ctx)).toBeNull();
  });

  it("checks hasChildren and child count", async () => {
    const rules = [
      {
        id: "children-check",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { hasChildren: true, minChildren: 2, maxChildren: 5 },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    const child = makeNode({ id: "c1", name: "child" });

    // 3 children — matches
    expect(check(makeNode({ children: [child, child, child] }), ctx)).not.toBeNull();
    // 1 child — fails minChildren
    expect(check(makeNode({ children: [child] }), ctx)).toBeNull();
    // 6 children — fails maxChildren
    expect(
      check(makeNode({ children: [child, child, child, child, child, child] }), ctx)
    ).toBeNull();
    // No children — fails hasChildren
    expect(check(makeNode(), ctx)).toBeNull();
  });
});

describe("pattern matching - component conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-comp-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks isComponent", async () => {
    const rules = [
      {
        id: "component-check",
        category: "component",
        severity: "risk",
        score: -2,
        match: { isComponent: true },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ type: "COMPONENT" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "COMPONENT_SET" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "FRAME" }), ctx)).toBeNull();
  });

  it("checks isInstance", async () => {
    const rules = [
      {
        id: "instance-check",
        category: "component",
        severity: "risk",
        score: -2,
        match: { isInstance: true },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ type: "INSTANCE" }), ctx)).not.toBeNull();
    expect(check(makeNode({ type: "FRAME" }), ctx)).toBeNull();
  });

  it("checks hasComponentId", async () => {
    const rules = [
      {
        id: "component-id-check",
        category: "component",
        severity: "risk",
        score: -2,
        match: { hasComponentId: false },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode(), ctx)).not.toBeNull();
    expect(check(makeNode({ componentId: "123:456" }), ctx)).toBeNull();
  });
});

describe("pattern matching - visibility conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-vis-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks isVisible", async () => {
    const rules = [
      {
        id: "visibility-check",
        category: "ai-readability",
        severity: "blocking",
        score: -5,
        match: { isVisible: false },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    expect(check(makeNode({ visible: false }), ctx)).not.toBeNull();
    expect(check(makeNode({ visible: true }), ctx)).toBeNull();
  });
});

describe("pattern matching - fill/stroke/effect conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-style-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks hasFills, hasStrokes, hasEffects", async () => {
    const rules = [
      {
        id: "fills-check",
        category: "token",
        severity: "risk",
        score: -2,
        match: { hasFills: true, hasStrokes: false },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    // Has fills, no strokes — matches
    expect(check(makeNode({ fills: [{ type: "SOLID" }] }), ctx)).not.toBeNull();
    // Has fills AND strokes — fails hasStrokes: false
    expect(
      check(
        makeNode({ fills: [{ type: "SOLID" }], strokes: [{ type: "SOLID" }] }),
        ctx
      )
    ).toBeNull();
    // No fills — fails hasFills: true
    expect(check(makeNode(), ctx)).toBeNull();
  });
});

describe("pattern matching - depth conditions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-depth-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("checks minDepth and maxDepth", async () => {
    const rules = [
      {
        id: "depth-check",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { minDepth: 2, maxDepth: 5 },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;

    expect(check(makeNode(), makeContext({ depth: 3 }))).not.toBeNull();
    expect(check(makeNode(), makeContext({ depth: 1 }))).toBeNull();
    expect(check(makeNode(), makeContext({ depth: 6 }))).toBeNull();
  });
});

describe("pattern matching - message template", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-msg-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("interpolates {name} and {type} in custom message", async () => {
    const rules = [
      {
        id: "msg-template",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { type: ["FRAME"] },
        message: "\"{name}\" ({type}) needs attention",
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const result = check(makeNode({ name: "Header", type: "FRAME" }), makeContext());

    expect(result).not.toBeNull();
    expect(result!.message).toBe('"Header" (FRAME) needs attention');
  });

  it("uses default message when no custom message is provided", async () => {
    const rules = [
      {
        id: "no-msg",
        category: "layout",
        severity: "risk",
        score: -2,
        match: { type: ["FRAME"] },
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const result = check(makeNode({ name: "MyFrame", type: "FRAME" }), makeContext());

    expect(result).not.toBeNull();
    expect(result!.message).toBe('"MyFrame" matched custom rule "no-msg"');
  });
});

describe("pattern matching - combined conditions (AND logic)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pattern-combined-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("requires ALL conditions to match (icon-not-component example)", async () => {
    const rules = [
      {
        id: "icon-not-component",
        category: "component",
        severity: "blocking",
        score: -10,
        match: {
          type: ["FRAME", "GROUP"],
          maxWidth: 48,
          maxHeight: 48,
          hasChildren: true,
          nameContains: "icon",
        },
        message: "\"{name}\" is an icon but not a component",
        why: "W",
        impact: "I",
        fix: "F",
      },
    ];
    const filePath = join(tempDir, "rules.json");
    writeFileSync(filePath, JSON.stringify(rules));

    const { rules: loaded } = await loadCustomRules(filePath);
    const check = loaded[0]!.check;
    const ctx = makeContext();

    const child = makeNode({ id: "c1", name: "vector" });

    // All conditions met
    expect(
      check(
        makeNode({
          name: "Icon/Close",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
          children: [child],
        }),
        ctx
      )
    ).not.toBeNull();

    // Fails: wrong type
    expect(
      check(
        makeNode({
          name: "Icon/Close",
          type: "TEXT",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
          children: [child],
        }),
        ctx
      )
    ).toBeNull();

    // Fails: too wide
    expect(
      check(
        makeNode({
          name: "Icon/Close",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 24 },
          children: [child],
        }),
        ctx
      )
    ).toBeNull();

    // Fails: no children
    expect(
      check(
        makeNode({
          name: "Icon/Close",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
        }),
        ctx
      )
    ).toBeNull();

    // Fails: name does not contain "icon"
    expect(
      check(
        makeNode({
          name: "Close Button",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
          children: [child],
        }),
        ctx
      )
    ).toBeNull();
  });
});
