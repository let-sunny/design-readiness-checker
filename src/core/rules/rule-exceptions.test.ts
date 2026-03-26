import type { AnalysisNode } from "../contracts/figma-node.js";
import type { RuleContext } from "../contracts/rule.js";
import {
  isAutoLayoutExempt,
  isAbsolutePositionExempt,
  isSizeConstraintExempt,
  isFixedSizeExempt,
} from "./rule-exceptions.js";

function makeNode(overrides: Partial<AnalysisNode> = {}): AnalysisNode {
  return {
    id: "test",
    name: "Test",
    type: "FRAME",
    visible: true,
    ...overrides,
  } as AnalysisNode;
}

function makeContext(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    file: {} as RuleContext["file"],
    depth: 2,
    componentDepth: 0,
    maxDepth: 10,
    path: ["Root", "Test"],
    analysisState: new Map(),
    ...overrides,
  };
}

describe("isAutoLayoutExempt", () => {
  it("exempts frames with only visual leaf children", () => {
    const node = makeNode({
      children: [
        makeNode({ type: "VECTOR" as any }),
        makeNode({ type: "ELLIPSE" as any }),
      ],
    });
    expect(isAutoLayoutExempt(node)).toBe(true);
  });

  it("exempts INSTANCE nodes", () => {
    const node = makeNode({ type: "INSTANCE" as any, children: [makeNode()] });
    expect(isAutoLayoutExempt(node)).toBe(true);
  });

  it("does not exempt frames with mixed children", () => {
    const node = makeNode({
      children: [
        makeNode({ type: "VECTOR" as any }),
        makeNode({ type: "TEXT" as any }),
      ],
    });
    expect(isAutoLayoutExempt(node)).toBe(false);
  });
});

describe("isAbsolutePositionExempt", () => {
  it("exempts nodes with image fills", () => {
    const parent = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
    });
    const node = makeNode({
      absoluteBoundingBox: { x: 10, y: 10, width: 150, height: 150 },
      fills: [{ type: "IMAGE", scaleMode: "FILL" }],
    });
    const ctx = makeContext({ parent });
    expect(isAbsolutePositionExempt(node, ctx)).toBe(true);
  });

  it("does not exempt medium-sized elements", () => {
    const parent = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
    });
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 150 },
    });
    const ctx = makeContext({ parent });
    expect(isAbsolutePositionExempt(node, ctx)).toBe(false);
  });
});

describe("isSizeConstraintExempt", () => {
  it("exempts TEXT nodes", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" as any });
    const node = makeNode({ type: "TEXT" as any, layoutSizingHorizontal: "FILL" as any });
    const ctx = makeContext({
      parent,
      siblings: [node, makeNode({ layoutSizingHorizontal: "FILL" as any })],
    });
    expect(isSizeConstraintExempt(node, ctx)).toBe(true);
  });
});

describe("isFixedSizeExempt", () => {
  it("exempts small elements (icons)", () => {
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
    });
    expect(isFixedSizeExempt(node)).toBe(true);
  });

  it("exempts nodes with image fills", () => {
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      fills: [{ type: "IMAGE", scaleMode: "FILL" }],
    });
    expect(isFixedSizeExempt(node)).toBe(true);
  });

  it("does not exempt large nodes without image fills", () => {
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    });
    expect(isFixedSizeExempt(node)).toBe(false);
  });
});
