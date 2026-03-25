import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { zIndexDependentLayout } from "./index.js";

describe("z-index-dependent-layout", () => {
  it("has correct rule definition metadata", () => {
    expect(zIndexDependentLayout.definition.id).toBe("z-index-dependent-layout");
    expect(zIndexDependentLayout.definition.category).toBe("ai-readability");
  });

  it("flags container with significant overlap (>20% of smaller element)", () => {
    const childA = makeNode({
      id: "c:1",
      name: "Background",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    });
    const childB = makeNode({
      id: "c:2",
      name: "Overlay",
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
    });
    const node = makeNode({
      type: "FRAME",
      name: "Stack",
      children: [childA, childB],
    });

    const result = zIndexDependentLayout.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("z-index-dependent-layout");
    expect(result!.message).toContain("Stack");
  });

  it("returns null when children don't overlap", () => {
    const childA = makeNode({
      id: "c:1",
      name: "Left",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    });
    const childB = makeNode({
      id: "c:2",
      name: "Right",
      absoluteBoundingBox: { x: 200, y: 0, width: 100, height: 100 },
    });
    const node = makeNode({
      type: "FRAME",
      name: "Row",
      children: [childA, childB],
    });

    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });

  it("returns null for non-container nodes", () => {
    const node = makeNode({ type: "TEXT" });
    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });

  it("returns null when fewer than 2 children", () => {
    const node = makeNode({ type: "FRAME", children: [makeNode()] });
    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });

  it("returns null when overlapping child is invisible", () => {
    const childA = makeNode({
      id: "c:1",
      name: "Bg",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
    });
    const childB = makeNode({
      id: "c:2",
      name: "Hidden",
      visible: false,
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 100 },
    });
    const node = makeNode({
      type: "FRAME",
      name: "Container",
      children: [childA, childB],
    });

    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });

  it("returns null when overlap is exactly 20% (boundary: > not >=)", () => {
    // overlapX=2, overlapY=5 → area=10, smallerArea=50 → 10/50=0.2 exactly
    const childA = makeNode({
      id: "c:1",
      name: "A",
      absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
    });
    const childB = makeNode({
      id: "c:2",
      name: "B",
      absoluteBoundingBox: { x: 8, y: 0, width: 10, height: 5 },
    });
    const node = makeNode({
      type: "FRAME",
      name: "Boundary",
      children: [childA, childB],
    });

    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });

  it("returns null when children lack absoluteBoundingBox", () => {
    const childA = makeNode({ id: "c:1", name: "NoBbox" });
    const childB = makeNode({ id: "c:2", name: "AlsoNoBbox" });
    const node = makeNode({
      type: "FRAME",
      name: "NoBounds",
      children: [childA, childB],
    });

    expect(zIndexDependentLayout.check(node, makeContext())).toBeNull();
  });
});
