import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { overflowHiddenAbuse } from "./index.js";

describe("overflow-hidden-abuse", () => {
  it("has correct rule definition metadata", () => {
    expect(overflowHiddenAbuse.definition.id).toBe("overflow-hidden-abuse");
    expect(overflowHiddenAbuse.definition.category).toBe("layout");
  });

  it("flags non-auto-layout container with clipsContent and children", () => {
    const node = makeNode({
      type: "FRAME",
      name: "ClippedFrame",
      clipsContent: true,
      children: [makeNode({ id: "c:1" })],
    });
    const result = overflowHiddenAbuse.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("overflow-hidden-abuse");
    expect(result!.message).toContain("ClippedFrame");
  });

  it("returns null for auto-layout container with clipsContent", () => {
    const node = makeNode({
      type: "FRAME",
      clipsContent: true,
      layoutMode: "VERTICAL",
      children: [makeNode({ id: "c:1" })],
    });
    expect(overflowHiddenAbuse.check(node, makeContext())).toBeNull();
  });

  it("returns null for container without clipsContent", () => {
    const node = makeNode({
      type: "FRAME",
      children: [makeNode({ id: "c:1" })],
    });
    expect(overflowHiddenAbuse.check(node, makeContext())).toBeNull();
  });

  it("returns null for small elements (icons/avatars)", () => {
    const node = makeNode({
      type: "FRAME",
      clipsContent: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
      children: [makeNode({ id: "c:1" })],
    });
    expect(overflowHiddenAbuse.check(node, makeContext())).toBeNull();
  });

  it("returns null for non-container nodes", () => {
    const node = makeNode({ type: "TEXT", clipsContent: true });
    expect(overflowHiddenAbuse.check(node, makeContext())).toBeNull();
  });

  it("returns null for empty container with clipsContent", () => {
    const node = makeNode({
      type: "FRAME",
      clipsContent: true,
    });
    expect(overflowHiddenAbuse.check(node, makeContext())).toBeNull();
  });
});
