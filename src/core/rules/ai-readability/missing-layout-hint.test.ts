import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { missingLayoutHint } from "./index.js";

describe("missing-layout-hint", () => {
  it("has correct rule definition metadata", () => {
    expect(missingLayoutHint.definition.id).toBe("missing-layout-hint");
    expect(missingLayoutHint.definition.category).toBe("ai-readability");
  });

  it("flags container with 2+ nested containers without auto layout", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME", name: "Panel A" });
    const childB = makeNode({ id: "c:2", type: "FRAME", name: "Panel B" });
    const node = makeNode({
      type: "FRAME",
      name: "Wrapper",
      children: [childA, childB],
    });

    const result = missingLayoutHint.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("missing-layout-hint");
    expect(result!.message).toContain("Wrapper");
  });

  it("returns null when node has auto layout", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME" });
    const childB = makeNode({ id: "c:2", type: "FRAME" });
    const node = makeNode({
      type: "FRAME",
      layoutMode: "VERTICAL",
      children: [childA, childB],
    });

    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });

  it("returns null when nested containers have auto layout", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME", layoutMode: "HORIZONTAL" });
    const childB = makeNode({ id: "c:2", type: "FRAME", layoutMode: "VERTICAL" });
    const node = makeNode({
      type: "FRAME",
      name: "Wrapper",
      children: [childA, childB],
    });

    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });

  it("does not flag when only one of two nested containers has auto layout", () => {
    const childA = makeNode({ id: "c:1", type: "FRAME", layoutMode: "HORIZONTAL" });
    const childB = makeNode({ id: "c:2", type: "FRAME" });
    const node = makeNode({
      type: "FRAME",
      name: "MixedWrapper",
      children: [childA, childB],
    });

    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });

  it("returns null for non-container nodes", () => {
    const node = makeNode({ type: "TEXT" });
    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });

  it("returns null when fewer than 2 nested containers", () => {
    const child = makeNode({ id: "c:1", type: "FRAME" });
    const text = makeNode({ id: "c:2", type: "TEXT" });
    const node = makeNode({
      type: "FRAME",
      name: "Simple",
      children: [child, text],
    });

    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });

  it("returns null when no children", () => {
    const node = makeNode({ type: "FRAME" });
    expect(missingLayoutHint.check(node, makeContext())).toBeNull();
  });
});
