import type { AnalysisNode } from "../contracts/figma-node.js";
import type { RuleContext } from "../contracts/rule.js";
import {
  isAutoLayoutExempt,
  isAbsolutePositionExempt,
  isSizeConstraintExempt,
  isFixedSizeExempt,
} from "./rule-exceptions.js";
import { isVisualOnlyNode } from "./node-semantics.js";

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
    ancestorTypes: [],
    analysisState: new Map(),
    ...overrides,
  };
}

describe("isVisualOnlyNode", () => {
  it("true for vector/shape types", () => {
    expect(isVisualOnlyNode(makeNode({ type: "VECTOR" as any }))).toBe(true);
    expect(isVisualOnlyNode(makeNode({ type: "ELLIPSE" as any }))).toBe(true);
  });

  it("true for nodes with image fills and no children", () => {
    const node = makeNode({ fills: [{ type: "IMAGE" }] });
    expect(isVisualOnlyNode(node)).toBe(true);
  });

  it("false for image fill frame with content children", () => {
    const node = makeNode({
      fills: [{ type: "IMAGE" }],
      children: [makeNode({ type: "TEXT" as any, name: "Title" })],
    });
    expect(isVisualOnlyNode(node)).toBe(false);
  });

  it("true for image fill frame with only visual leaf children", () => {
    const node = makeNode({
      fills: [{ type: "IMAGE" }],
      children: [makeNode({ type: "VECTOR" as any })],
    });
    expect(isVisualOnlyNode(node)).toBe(true);
  });

  it("true for frame with only visual leaf children", () => {
    const node = makeNode({
      children: [makeNode({ type: "VECTOR" as any }), makeNode({ type: "RECTANGLE" as any })],
    });
    expect(isVisualOnlyNode(node)).toBe(true);
  });

  it("false for frame with mixed children", () => {
    const node = makeNode({
      children: [makeNode({ type: "VECTOR" as any }), makeNode({ type: "TEXT" as any })],
    });
    expect(isVisualOnlyNode(node)).toBe(false);
  });

  it("false for plain frame without image fills", () => {
    const node = makeNode({ fills: [{ type: "SOLID" }] });
    expect(isVisualOnlyNode(node)).toBe(false);
  });
});

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

  it("does not exempt image-filled frames with content children", () => {
    const node = makeNode({ fills: [{ type: "IMAGE" }], children: [makeNode({ type: "TEXT" as any })] });
    expect(isAutoLayoutExempt(node)).toBe(false);
  });

  it("does not exempt INSTANCE nodes", () => {
    const node = makeNode({ type: "INSTANCE" as any, children: [makeNode()] });
    expect(isAutoLayoutExempt(node)).toBe(false);
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
    const node = makeNode({
      fills: [{ type: "IMAGE", scaleMode: "FILL" }],
    });
    expect(isAbsolutePositionExempt(node)).toBe(true);
  });

  it("exempts vector nodes", () => {
    const node = makeNode({ type: "VECTOR" as any });
    expect(isAbsolutePositionExempt(node)).toBe(true);
  });

  it("does not exempt plain frame", () => {
    const node = makeNode({ fills: [{ type: "SOLID" }] });
    expect(isAbsolutePositionExempt(node)).toBe(false);
  });
});

describe("isSizeConstraintExempt", () => {
  it("exempts when node has maxWidth", () => {
    const node = makeNode({ maxWidth: 800 });
    expect(isSizeConstraintExempt(node, makeContext())).toBe(true);
  });

  it("exempts when parent has maxWidth", () => {
    const parent = makeNode({ maxWidth: 1200 });
    const node = makeNode({});
    expect(isSizeConstraintExempt(node, makeContext({ parent }))).toBe(true);
  });

  it("exempts root-level frames (depth <= 1)", () => {
    const node = makeNode({});
    expect(isSizeConstraintExempt(node, makeContext({ depth: 1 }))).toBe(true);
  });

  it("does not exempt inside GRID layout", () => {
    const parent = makeNode({ layoutMode: "GRID" as any });
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 100 },
    });
    expect(isSizeConstraintExempt(node, makeContext({ parent }))).toBe(false);
  });

  it("does not exempt inside flex wrap", () => {
    const parent = makeNode({ layoutWrap: "WRAP" as any });
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 100 },
    });
    expect(isSizeConstraintExempt(node, makeContext({ parent }))).toBe(false);
  });
});

describe("isFixedSizeExempt", () => {
  it("exempts visual-only nodes (vector icons)", () => {
    const node = makeNode({
      type: "VECTOR" as any,
      absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
    });
    expect(isFixedSizeExempt(node)).toBe(true);
  });

  it("does not exempt plain small frame (no longer size-based)", () => {
    const node = makeNode({
      absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
      fills: [{ type: "SOLID" }],
    });
    expect(isFixedSizeExempt(node)).toBe(false);
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
