import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { inconsistentSiblingLayoutDirection } from "./index.js";

describe("inconsistent-sibling-layout-direction", () => {
  it("has correct rule definition metadata", () => {
    expect(inconsistentSiblingLayoutDirection.definition.id).toBe("inconsistent-sibling-layout-direction");
    expect(inconsistentSiblingLayoutDirection.definition.category).toBe("layout");
  });

  it("flags node with different direction from siblings", () => {
    const siblingA = makeNode({ id: "2:1", type: "FRAME", name: "SibA", layoutMode: "HORIZONTAL" });
    const siblingB = makeNode({ id: "2:2", type: "FRAME", name: "SibB", layoutMode: "HORIZONTAL" });
    const node = makeNode({ id: "1:1", type: "FRAME", name: "Outlier", layoutMode: "VERTICAL" });
    const siblings = [node, siblingA, siblingB];

    const result = inconsistentSiblingLayoutDirection.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("inconsistent-sibling-layout-direction");
    expect(result!.message).toContain("VERTICAL");
    expect(result!.message).toContain("HORIZONTAL");
  });

  it("returns null for non-container nodes", () => {
    const node = makeNode({ type: "TEXT" });
    expect(inconsistentSiblingLayoutDirection.check(node, makeContext())).toBeNull();
  });

  it("returns null when no siblings", () => {
    const node = makeNode({ type: "FRAME", layoutMode: "VERTICAL" });
    expect(inconsistentSiblingLayoutDirection.check(node, makeContext())).toBeNull();
  });

  it("returns null when all siblings have the same direction", () => {
    const siblingA = makeNode({ id: "2:1", type: "FRAME", name: "SibA", layoutMode: "VERTICAL" });
    const node = makeNode({ id: "1:1", type: "FRAME", name: "Card", layoutMode: "VERTICAL" });
    const siblings = [node, siblingA];

    expect(inconsistentSiblingLayoutDirection.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("returns null when node has no layout mode", () => {
    const siblingA = makeNode({ id: "2:1", type: "FRAME", name: "SibA", layoutMode: "HORIZONTAL" });
    const node = makeNode({ id: "1:1", type: "FRAME", name: "Plain" });
    const siblings = [node, siblingA];

    expect(inconsistentSiblingLayoutDirection.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("returns null when only one sibling (< 2 siblings)", () => {
    const node = makeNode({ id: "1:1", type: "FRAME", name: "Solo", layoutMode: "VERTICAL" });
    expect(inconsistentSiblingLayoutDirection.check(node, makeContext({ siblings: [node] }))).toBeNull();
  });

  it("allows card-in-row pattern (parent HORIZONTAL, child VERTICAL)", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const siblingA = makeNode({ id: "2:1", type: "FRAME", name: "SibA", layoutMode: "HORIZONTAL" });
    const siblingB = makeNode({ id: "2:2", type: "FRAME", name: "SibB", layoutMode: "HORIZONTAL" });
    const node = makeNode({ id: "1:1", type: "FRAME", name: "Card", layoutMode: "VERTICAL" });
    const siblings = [node, siblingA, siblingB];

    expect(inconsistentSiblingLayoutDirection.check(node, makeContext({ parent, siblings }))).toBeNull();
  });
});
