import type { RuleContext } from "../../contracts/rule.js";
import type { AnalysisNode } from "../../contracts/figma-node.js";
import { inconsistentBorderRadius } from "./index.js";

// ============================================
// Test helpers
// ============================================

function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "1:1",
    name: "TestNode",
    type: "RECTANGLE",
    visible: true,
    ...overrides,
  };
}

function makeContext(overrides?: Partial<RuleContext>): RuleContext {
  return {
    file: {
      fileKey: "test-file",
      name: "Test File",
      lastModified: "2026-01-01T00:00:00Z",
      version: "1",
      document: makeNode({ id: "0:1", name: "Document", type: "DOCUMENT" }),
      components: {},
      styles: {},
    },
    depth: 2,
    componentDepth: 0,
    maxDepth: 10,
    path: ["Page", "Frame"],
    ...overrides,
  };
}

// ============================================
// inconsistent-border-radius
// ============================================

describe("inconsistent-border-radius", () => {
  it("returns null when node has no cornerRadius", () => {
    const node = makeNode({ id: "1:1", name: "Box", cornerRadius: undefined });
    const siblings = [
      makeNode({ id: "1:2", cornerRadius: 8 }),
      makeNode({ id: "1:3", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings: [node, ...siblings] });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("returns null when all siblings have the same radius", () => {
    const node = makeNode({ id: "1:1", name: "Box", type: "RECTANGLE", cornerRadius: 8 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "RECTANGLE", cornerRadius: 8 }),
      makeNode({ id: "1:3", type: "RECTANGLE", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("fires violation when current node differs from majority", () => {
    const node = makeNode({ id: "1:1", name: "Odd Box", type: "RECTANGLE", cornerRadius: 4 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "RECTANGLE", cornerRadius: 8 }),
      makeNode({ id: "1:3", type: "RECTANGLE", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings });
    const result = inconsistentBorderRadius.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("inconsistent-border-radius");
    expect(result?.message).toContain("4px");
    expect(result?.message).toContain("8px");
    expect(result?.message).toContain("Odd Box");
  });

  it("returns null for circle idiom (cornerRadius >= 100)", () => {
    const node = makeNode({ id: "1:1", name: "Circle", type: "ELLIPSE", cornerRadius: 100 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "ELLIPSE", cornerRadius: 8 }),
      makeNode({ id: "1:3", type: "ELLIPSE", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("only compares siblings of the same type", () => {
    // node is RECTANGLE with radius 4; the FRAME siblings have radius 8 (different type)
    const node = makeNode({ id: "1:1", name: "Rect", type: "RECTANGLE", cornerRadius: 4 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "FRAME", cornerRadius: 8 }),
      makeNode({ id: "1:3", type: "FRAME", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings });
    // No same-type qualifying siblings → null
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("returns null when fewer than 2 total siblings", () => {
    const node = makeNode({ id: "1:1", name: "Lonely", type: "RECTANGLE", cornerRadius: 4 });
    const ctx = makeContext({ siblings: [node] });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("returns null when no siblings context provided", () => {
    const node = makeNode({ id: "1:1", name: "NoCtx", type: "RECTANGLE", cornerRadius: 4 });
    const ctx = makeContext({ siblings: undefined });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("fires violation with one differing sibling of same type", () => {
    const node = makeNode({ id: "1:1", name: "DiffCard", type: "FRAME", cornerRadius: 0 });
    const sibling = makeNode({ id: "1:2", type: "FRAME", cornerRadius: 12 });
    const ctx = makeContext({ siblings: [node, sibling] });
    const result = inconsistentBorderRadius.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result?.message).toContain("0px");
    expect(result?.message).toContain("12px");
  });

  it("returns null when all same-type siblings have undefined cornerRadius", () => {
    const node = makeNode({ id: "1:1", name: "Box", type: "RECTANGLE", cornerRadius: 4 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "RECTANGLE", cornerRadius: undefined }),
      makeNode({ id: "1:3", type: "RECTANGLE", cornerRadius: undefined }),
    ];
    const ctx = makeContext({ siblings });
    // No qualifying siblings (undefined radius filtered out) → null
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });

  it("breaks ties in majority by choosing lower value", () => {
    // Tie: one sibling has radius 4, another has radius 8, current is 12
    // Majority tie broken by lower value → majority = 4
    const node = makeNode({ id: "1:1", name: "TieBox", type: "RECTANGLE", cornerRadius: 12 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "RECTANGLE", cornerRadius: 4 }),
      makeNode({ id: "1:3", type: "RECTANGLE", cornerRadius: 8 }),
    ];
    const ctx = makeContext({ siblings });
    const result = inconsistentBorderRadius.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result?.message).toContain("4px");
  });

  it("returns null when current node matches majority even with a dissenting sibling", () => {
    // siblings (excluding current): sib1(8), sib2(8), sib3(4)
    // majority is 8 (two siblings at 8 vs one at 4), current is also 8 → no violation
    const node = makeNode({ id: "1:1", name: "Normal", type: "RECTANGLE", cornerRadius: 8 });
    const siblings = [
      node,
      makeNode({ id: "1:2", type: "RECTANGLE", cornerRadius: 8 }),
      makeNode({ id: "1:3", type: "RECTANGLE", cornerRadius: 8 }),
      makeNode({ id: "1:4", type: "RECTANGLE", cornerRadius: 4 }),
    ];
    const ctx = makeContext({ siblings });
    expect(inconsistentBorderRadius.check(node, ctx)).toBeNull();
  });
});
