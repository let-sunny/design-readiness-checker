import type { RuleContext } from "../../contracts/rule.js";
import type { AnalysisFile, AnalysisNode } from "../../contracts/figma-node.js";
import { missingComponent } from "./index.js";

// ============================================
// Test helpers
// ============================================

function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "1:1",
    name: "TestFrame",
    type: "FRAME",
    visible: true,
    layoutMode: "VERTICAL",
    ...overrides,
  };
}

function makeFile(
  overrides?: Partial<AnalysisFile>
): AnalysisFile {
  return {
    fileKey: "test-file",
    name: "Test File",
    lastModified: "2026-01-01T00:00:00Z",
    version: "1",
    document: makeNode({ id: "0:1", name: "Document", type: "DOCUMENT" }),
    components: {},
    styles: {},
    ...overrides,
  };
}

/** Each test gets a fresh analysisState to isolate dedup state */
let analysisState: Map<string, unknown>;

function makeContext(overrides?: Partial<RuleContext>): RuleContext {
  return {
    file: makeFile(),
    depth: 2,
    componentDepth: 0,
    maxDepth: 10,
    path: ["Page", "Section"],
    analysisState,
    ...overrides,
  };
}

function makeChildFrame(
  id: string,
  type: AnalysisNode["type"] = "FRAME"
): AnalysisNode {
  return {
    id,
    name: `child-${id}`,
    type,
    visible: true,
  };
}

// ============================================
// Stage 1: Component exists but not used
// ============================================

describe("missing-component — Stage 1: Component exists but not used", () => {
  beforeEach(() => {
    analysisState = new Map();
  });

  it("returns null when no component matches frame name", () => {
    const frame = makeNode({ id: "f:1", name: "Card" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frame, makeNode({ id: "f:2", name: "Card" })],
    });

    const ctx = makeContext({
      file: makeFile({
        document: doc,
        components: {
          "comp:1": { key: "comp:1", name: "Button", description: "" },
        },
      }),
    });

    expect(missingComponent.check(frame, ctx)).toBeNull();
  });

  it("flags when component exists and frame name appears 2+ times", () => {
    const frameA = makeNode({ id: "f:1", name: "Button" });
    const frameB = makeNode({ id: "f:2", name: "Button" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB],
    });

    const ctx = makeContext({
      file: makeFile({
        document: doc,
        components: {
          "comp:1": { key: "comp:1", name: "Button", description: "" },
        },
      }),
    });

    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("missing-component");
    expect(result!.message).toContain('Component "Button" exists');
    expect(result!.message).toContain("2 found");
  });

  it("only flags first occurrence (dedup)", () => {
    const frameA = makeNode({ id: "f:1", name: "Button" });
    const frameB = makeNode({ id: "f:2", name: "Button" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB],
    });

    const ctx = makeContext({
      file: makeFile({
        document: doc,
        components: {
          "comp:1": { key: "comp:1", name: "Button", description: "" },
        },
      }),
    });

    // First call flags
    const result1 = missingComponent.check(frameA, ctx);
    expect(result1).not.toBeNull();

    // Second call with same name is deduped
    const result2 = missingComponent.check(frameA, ctx);
    expect(result2).toBeNull();
  });

  it("case-insensitive name matching", () => {
    const frame = makeNode({ id: "f:1", name: "button" });
    const frame2 = makeNode({ id: "f:2", name: "button" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frame, frame2],
    });

    const ctx = makeContext({
      file: makeFile({
        document: doc,
        components: {
          "comp:1": { key: "comp:1", name: "Button", description: "" },
        },
      }),
    });

    const result = missingComponent.check(frame, ctx);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("Button");
  });
});

// ============================================
// Stage 2: Name-based repetition
// ============================================

describe("missing-component — Stage 2: Name-based repetition", () => {
  beforeEach(() => {
    analysisState = new Map();
  });

  it("returns null below minRepetitions threshold", () => {
    const frameA = makeNode({ id: "f:1", name: "Card" });
    const frameB = makeNode({ id: "f:2", name: "Card" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB],
    });

    const ctx = makeContext({
      file: makeFile({ document: doc }),
    });

    // Default minRepetitions is 3, only 2 frames
    expect(missingComponent.check(frameA, ctx)).toBeNull();
  });

  it("flags at threshold, only first occurrence", () => {
    const frameA = makeNode({ id: "f:1", name: "Card" });
    const frameB = makeNode({ id: "f:2", name: "Card" });
    const frameC = makeNode({ id: "f:3", name: "Card" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB, frameC],
    });

    const ctx = makeContext({
      file: makeFile({ document: doc }),
    });

    // First frame should be flagged
    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("missing-component");
    expect(result!.message).toContain('"Card" appears 3 times');

    // Second frame should not be flagged
    expect(missingComponent.check(frameB, ctx)).toBeNull();
  });

  it("respects custom minRepetitions option", () => {
    const frameA = makeNode({ id: "f:1", name: "Card" });
    const frameB = makeNode({ id: "f:2", name: "Card" });
    const frameC = makeNode({ id: "f:3", name: "Card" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB, frameC],
    });

    const ctx = makeContext({
      file: makeFile({ document: doc }),
    });

    // With minRepetitions: 4, 3 frames should NOT be enough
    expect(
      missingComponent.check(frameA, ctx, { minRepetitions: 4 })
    ).toBeNull();

    // With minRepetitions: 2, should flag
    const result = missingComponent.check(frameA, ctx, { minRepetitions: 2 });
    expect(result).not.toBeNull();
  });

  it("does NOT fire if Stage 1 already matched", () => {
    // If a component named "Card" exists and there are 3 frames named "Card",
    // Stage 1 should fire (threshold 2) and Stage 2 should not fire for the same node
    const frameA = makeNode({ id: "f:1", name: "Card" });
    const frameB = makeNode({ id: "f:2", name: "Card" });
    const frameC = makeNode({ id: "f:3", name: "Card" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB, frameC],
    });

    const ctx = makeContext({
      file: makeFile({
        document: doc,
        components: {
          "comp:1": { key: "comp:1", name: "Card", description: "" },
        },
      }),
    });

    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();
    // Stage 1 message pattern
    expect(result!.message).toContain('Component "Card" exists');
  });
});

// ============================================
// Stage 3: Structure-based repetition
// ============================================

describe("missing-component — Stage 3: Structure-based repetition", () => {
  beforeEach(() => {
    analysisState = new Map();
  });

  it("detects identical sibling structure", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", name: "Card A", children: [childA] });
    const frameB = makeNode({ id: "f:2", name: "Card B", children: [childB] });

    const siblings = [frameA, frameB];
    const ctx = makeContext({ siblings });

    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("missing-component");
    expect(result!.message).toContain("Card A");
    expect(result!.message).toContain("1 sibling frame(s)");
    expect(result!.message).toContain("extract a shared component");
  });

  it("only flags first matching sibling", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", name: "Card A", children: [childA] });
    const frameB = makeNode({ id: "f:2", name: "Card B", children: [childB] });

    const siblings = [frameA, frameB];
    const ctxB = makeContext({ siblings });

    expect(missingComponent.check(frameB, ctxB)).toBeNull();
  });

  it("skips inside INSTANCE subtree", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const childC = makeChildFrame("c:3", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", children: [childA] });
    const frameB = makeNode({ id: "f:2", children: [childB] });
    const frameC = makeNode({ id: "f:3", children: [childC] });

    const instanceParent: AnalysisNode = {
      id: "inst:1",
      name: "MyInstance",
      type: "INSTANCE",
      visible: true,
    };

    const ctx = makeContext({
      parent: instanceParent,
      siblings: [frameA, frameB, frameC],
    });

    expect(missingComponent.check(frameA, ctx)).toBeNull();
  });

  it("skips COMPONENT_SET parent", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const childC = makeChildFrame("c:3", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", children: [childA] });
    const frameB = makeNode({ id: "f:2", children: [childB] });
    const frameC = makeNode({ id: "f:3", children: [childC] });

    const compSetParent: AnalysisNode = {
      id: "cs:1",
      name: "ButtonSet",
      type: "COMPONENT_SET",
      visible: true,
    };

    const ctx = makeContext({
      parent: compSetParent,
      siblings: [frameA, frameB, frameC],
    });

    expect(missingComponent.check(frameA, ctx)).toBeNull();
  });

  it("respects structureMinRepetitions option", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", name: "Card A", children: [childA] });
    const frameB = makeNode({ id: "f:2", name: "Card B", children: [childB] });

    const siblings = [frameA, frameB];
    const ctx = makeContext({ siblings });

    // Default structureMinRepetitions is 2 — should flag
    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();

    // With structureMinRepetitions: 3 — should NOT flag with only 2
    expect(
      missingComponent.check(frameA, ctx, { structureMinRepetitions: 3 })
    ).toBeNull();
  });

  it("does NOT fire if Stage 2 already matched", () => {
    // 3 frames with same name AND same structure — Stage 2 fires first
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const childC = makeChildFrame("c:3", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", name: "Card", children: [childA] });
    const frameB = makeNode({ id: "f:2", name: "Card", children: [childB] });
    const frameC = makeNode({ id: "f:3", name: "Card", children: [childC] });

    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB, frameC],
    });

    const ctx = makeContext({
      file: makeFile({ document: doc }),
      siblings: [frameA, frameB, frameC],
    });

    const result = missingComponent.check(frameA, ctx);
    expect(result).not.toBeNull();
    // Stage 2 message pattern (not Stage 3)
    expect(result!.message).toContain('"Card" appears 3 times');
  });

  it("returns null when node has no children", () => {
    const node = makeNode({ id: "f:1", children: [] });
    const ctx = makeContext({ siblings: [node] });
    expect(missingComponent.check(node, ctx)).toBeNull();
  });

  it("does not flag siblings with different structures", () => {
    const childRect = makeChildFrame("c:1", "RECTANGLE");
    const childText = makeChildFrame("c:2", "TEXT");

    const frameA = makeNode({ id: "f:1", children: [childRect] });
    const frameB = makeNode({ id: "f:2", children: [childText] });

    const siblings = [frameA, frameB];
    const ctx = makeContext({ siblings });

    expect(missingComponent.check(frameA, ctx)).toBeNull();
  });

  it("does not flag siblings that are not FRAME type", () => {
    const childA = makeChildFrame("c:1", "RECTANGLE");
    const childB = makeChildFrame("c:2", "RECTANGLE");
    const childC = makeChildFrame("c:3", "RECTANGLE");
    const frameA = makeNode({ id: "f:1", name: "Card A", children: [childA] });
    const textNode: AnalysisNode = {
      id: "t:1",
      name: "Label",
      type: "TEXT",
      visible: true,
      children: [childB],
    };
    const groupNode: AnalysisNode = {
      id: "g:1",
      name: "Group",
      type: "GROUP",
      visible: true,
      children: [childC],
    };

    const siblings = [frameA, textNode, groupNode];
    const ctx = makeContext({ siblings });

    // Only one qualifying FRAME sibling — below threshold
    expect(missingComponent.check(frameA, ctx)).toBeNull();
  });
});

// ============================================
// Stage 4: Instance style override detection (master comparison)
// ============================================

describe("missing-component — Stage 4: Instance style overrides", () => {
  beforeEach(() => {
    analysisState = new Map();
  });

  it("returns null for non-INSTANCE nodes", () => {
    const node = makeNode({ type: "FRAME", componentId: "comp:1" });
    const ctx = makeContext();
    expect(missingComponent.check(node, ctx)).toBeNull();
  });

  it("returns null when no componentId", () => {
    const node = makeNode({ type: "INSTANCE" });
    const ctx = makeContext();
    expect(missingComponent.check(node, ctx)).toBeNull();
  });

  it("returns null when no componentDefinitions in file", () => {
    const inst = makeNode({
      id: "inst:1",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });

    const ctx = makeContext({
      file: makeFile({ document: inst }),
    });

    expect(missingComponent.check(inst, ctx)).toBeNull();
  });

  it("returns null when master not found in componentDefinitions", () => {
    const inst = makeNode({
      id: "inst:1",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });

    const ctx = makeContext({
      file: makeFile({
        document: inst,
        componentDefinitions: {
          "comp:999": makeNode({ id: "comp:999", name: "Other", type: "COMPONENT" }),
        },
      }),
    });

    expect(missingComponent.check(inst, ctx)).toBeNull();
  });

  it("flags when instance has different fills from master", () => {
    const master = makeNode({
      id: "comp:1",
      name: "Button",
      type: "COMPONENT",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
    });
    const inst = makeNode({
      id: "inst:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });

    const ctx = makeContext({
      file: makeFile({
        document: inst,
        components: { "comp:1": { key: "k", name: "Button", description: "" } },
        componentDefinitions: { "comp:1": master },
      }),
    });

    const result = missingComponent.check(inst, ctx);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("Button");
    expect(result!.message).toContain("fills");
    expect(result!.message).toContain("create a new variant");
  });

  it("flags when instance has different cornerRadius from master", () => {
    const master = makeNode({
      id: "comp:1",
      name: "Card",
      type: "COMPONENT",
      cornerRadius: 8,
    });
    const inst = makeNode({
      id: "inst:1",
      name: "Card",
      type: "INSTANCE",
      componentId: "comp:1",
      cornerRadius: 0,
    });

    const ctx = makeContext({
      file: makeFile({
        document: inst,
        components: { "comp:1": { key: "k", name: "Card", description: "" } },
        componentDefinitions: { "comp:1": master },
      }),
    });

    const result = missingComponent.check(inst, ctx);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("cornerRadius");
  });

  it("returns null when instance styles match master exactly", () => {
    const fills = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }];
    const master = makeNode({
      id: "comp:1",
      name: "Button",
      type: "COMPONENT",
      fills,
      cornerRadius: 8,
    });
    const inst = makeNode({
      id: "inst:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills,
      cornerRadius: 8,
    });

    const ctx = makeContext({
      file: makeFile({
        document: inst,
        componentDefinitions: { "comp:1": master },
      }),
    });

    expect(missingComponent.check(inst, ctx)).toBeNull();
  });

  it("deduplicates per componentId", () => {
    const master = makeNode({
      id: "comp:1",
      name: "Button",
      type: "COMPONENT",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }],
    });
    const inst1 = makeNode({
      id: "inst:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });
    const inst2 = makeNode({
      id: "inst:2",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0 } }],
    });

    const file = makeFile({
      document: makeNode({ id: "0:1", name: "Doc", type: "DOCUMENT", children: [inst1, inst2] }),
      components: { "comp:1": { key: "k", name: "Button", description: "" } },
      componentDefinitions: { "comp:1": master },
    });

    const ctx1 = makeContext({ file });
    const ctx2 = makeContext({ file });

    expect(missingComponent.check(inst1, ctx1)).not.toBeNull();
    expect(missingComponent.check(inst2, ctx2)).toBeNull();
  });

  it("flags later instance when first instance has no overrides", () => {
    const masterFills = [{ type: "SOLID", color: { r: 0, g: 0, b: 1 } }];
    const master = makeNode({
      id: "comp:1",
      name: "Button",
      type: "COMPONENT",
      fills: masterFills,
    });
    // inst1 matches master — no override
    const inst1 = makeNode({
      id: "inst:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: masterFills,
    });
    // inst2 has different fills — override
    const inst2 = makeNode({
      id: "inst:2",
      name: "Button",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });

    const file = makeFile({
      document: makeNode({ id: "0:1", name: "Doc", type: "DOCUMENT", children: [inst1, inst2] }),
      components: { "comp:1": { key: "k", name: "Button", description: "" } },
      componentDefinitions: { "comp:1": master },
    });

    const ctx1 = makeContext({ file });
    const ctx2 = makeContext({ file });

    // First instance matches master — no violation
    expect(missingComponent.check(inst1, ctx1)).toBeNull();
    // Second instance has override — should flag (not deduped)
    expect(missingComponent.check(inst2, ctx2)).not.toBeNull();
  });

  it("lists multiple overridden properties in message", () => {
    const master = makeNode({
      id: "comp:1",
      name: "Card",
      type: "COMPONENT",
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      cornerRadius: 8,
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
    });
    const inst = makeNode({
      id: "inst:1",
      name: "Card",
      type: "INSTANCE",
      componentId: "comp:1",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
      cornerRadius: 0,
      strokes: [],
    });

    const ctx = makeContext({
      file: makeFile({
        document: inst,
        components: { "comp:1": { key: "k", name: "Card", description: "" } },
        componentDefinitions: { "comp:1": master },
      }),
    });

    const result = missingComponent.check(inst, ctx);
    expect(result).not.toBeNull();
    expect(result!.message).toContain("fills");
    expect(result!.message).toContain("strokes");
    expect(result!.message).toContain("cornerRadius");
  });
});

// ============================================
// General
// ============================================

describe("missing-component — General", () => {
  beforeEach(() => {
    analysisState = new Map();
  });

  it("has correct rule definition metadata", () => {
    const def = missingComponent.definition;
    expect(def.id).toBe("missing-component");
    expect(def.category).toBe("component");
    expect(def.why).toBeTruthy();
    expect(def.impact).toBeTruthy();
    expect(def.fix).toBeTruthy();
  });

  it("fresh analysisState clears dedup state", () => {
    const frameA = makeNode({ id: "f:1", name: "Button" });
    const frameB = makeNode({ id: "f:2", name: "Button" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB],
    });

    const file = makeFile({
      document: doc,
      components: {
        "comp:1": { key: "comp:1", name: "Button", description: "" },
      },
    });

    const ctx = makeContext({ file });

    // First call flags (Stage 1)
    expect(missingComponent.check(frameA, ctx)).not.toBeNull();

    // Deduped
    expect(missingComponent.check(frameA, ctx)).toBeNull();

    // Fresh analysisState simulates a new analysis run — should flag again
    analysisState = new Map();
    const freshCtx = makeContext({ file });
    expect(missingComponent.check(frameA, freshCtx)).not.toBeNull();
  });
});
