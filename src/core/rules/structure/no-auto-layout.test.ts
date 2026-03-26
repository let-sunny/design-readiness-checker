import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { noAutoLayout } from "./index.js";

describe("no-auto-layout", () => {
  it("has correct rule definition metadata", () => {
    const def = noAutoLayout.definition;
    expect(def.id).toBe("no-auto-layout");
    expect(def.category).toBe("structure");
    expect(def.why).toContain("Auto Layout");
    expect(def.fix).toContain("Auto Layout");
  });

  it("returns null for non-FRAME nodes without overlapping/nested issues", () => {
    const textNode = makeNode({ type: "TEXT" });
    const ctx = makeContext();
    expect(noAutoLayout.check(textNode, ctx)).toBeNull();
  });

  it("returns null for frame with auto layout", () => {
    const node = makeNode({
      layoutMode: "HORIZONTAL",
      children: [makeNode({ id: "c:1", name: "Child" })],
    });
    const ctx = makeContext();
    expect(noAutoLayout.check(node, ctx)).toBeNull();
  });

  it("returns null for empty frame (no children)", () => {
    const node = makeNode({ children: [] });
    const ctx = makeContext();
    expect(noAutoLayout.check(node, ctx)).toBeNull();
  });

  it("returns null for frame without children property", () => {
    const node = makeNode({});
    const ctx = makeContext();
    expect(noAutoLayout.check(node, ctx)).toBeNull();
  });

  it("flags frame without auto layout that has children", () => {
    const child = makeNode({ id: "c:1", name: "Child" });
    const node = makeNode({ name: "Container", children: [child] });
    const ctx = makeContext();

    const result = noAutoLayout.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("no-auto-layout");
    expect(result!.message).toContain("Container");
    expect(result!.message).toContain("no auto-layout");
  });

  it("flags frame with layoutMode NONE that has children", () => {
    const child = makeNode({ id: "c:1", name: "Child" });
    const node = makeNode({
      name: "NoneLayout",
      layoutMode: "NONE",
      children: [child],
    });
    const ctx = makeContext();

    const result = noAutoLayout.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("no-auto-layout");
    expect(result!.message).toContain("NoneLayout");
  });

  // Merged: ambiguous-structure checks
  it("flags container with overlapping visible children (ambiguous-structure)", () => {
    const child1 = makeNode({
      id: "c:1",
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    });
    const child2 = makeNode({
      id: "c:2",
      absoluteBoundingBox: { x: 50, y: 50, width: 100, height: 100 },
    });
    const node = makeNode({
      name: "Ambiguous",
      children: [child1, child2],
    });
    const ctx = makeContext();

    const result = noAutoLayout.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("no-auto-layout");
    expect(result!.message).toContain("Ambiguous");
    expect(result!.message).toContain("overlapping");
  });

  it("flags basic no-auto-layout when overlapping children are hidden", () => {
    const child1 = makeNode({
      id: "c:1",
      visible: false,
      absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    });
    const child2 = makeNode({
      id: "c:2",
      absoluteBoundingBox: { x: 50, y: 50, width: 100, height: 100 },
    });
    const node = makeNode({
      name: "Container",
      children: [child1, child2],
    });
    const ctx = makeContext();
    // Should not flag overlapping since one is hidden; falls through to basic check
    const result = noAutoLayout.check(node, ctx);
    // Still flags as basic no-auto-layout since it's a FRAME with children
    expect(result).not.toBeNull();
    expect(result!.message).not.toContain("overlapping");
  });

  // Merged: missing-layout-hint checks
  it("flags container with 2+ nested containers without auto layout (missing-layout-hint)", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME", name: "Panel A" });
    const childB = makeNode({ id: "c:2", type: "FRAME", name: "Panel B" });
    const node = makeNode({
      type: "FRAME",
      name: "Wrapper",
      children: [childA, childB],
    });

    const result = noAutoLayout.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("no-auto-layout");
    expect(result!.message).toContain("nested containers");
  });

  it("returns null when nested containers have auto layout", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME", layoutMode: "HORIZONTAL" });
    const childB = makeNode({ id: "c:2", type: "FRAME", layoutMode: "VERTICAL" });
    const node = makeNode({
      type: "FRAME",
      layoutMode: "VERTICAL",
      name: "Wrapper",
      children: [childA, childB],
    });

    expect(noAutoLayout.check(node, makeContext())).toBeNull();
  });
});
