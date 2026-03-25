import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { emptyFrame } from "./index.js";

describe("empty-frame", () => {
  it("has correct rule definition metadata", () => {
    expect(emptyFrame.definition.id).toBe("empty-frame");
    expect(emptyFrame.definition.category).toBe("ai-readability");
  });

  it("flags empty frame with no children", () => {
    const node = makeNode({
      type: "FRAME",
      name: "EmptySection",
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
    });
    const result = emptyFrame.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("empty-frame");
    expect(result!.message).toContain("EmptySection");
  });

  it("returns null for frame with children", () => {
    const node = makeNode({
      type: "FRAME",
      children: [makeNode({ id: "c:1" })],
    });
    expect(emptyFrame.check(node, makeContext())).toBeNull();
  });

  it("returns null for non-FRAME nodes", () => {
    const node = makeNode({ type: "GROUP" });
    expect(emptyFrame.check(node, makeContext())).toBeNull();
  });

  it("allows small placeholder frames (<=48x48)", () => {
    const node = makeNode({
      type: "FRAME",
      name: "Spacer",
      absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
    });
    expect(emptyFrame.check(node, makeContext())).toBeNull();
  });

  it("allows placeholder frames exactly at 48x48 boundary", () => {
    const node = makeNode({
      type: "FRAME",
      name: "IconPlaceholder",
      absoluteBoundingBox: { x: 0, y: 0, width: 48, height: 48 },
    });
    expect(emptyFrame.check(node, makeContext())).toBeNull();
  });

  it("flags empty frame when only one dimension is <= 48", () => {
    const node = makeNode({
      type: "FRAME",
      name: "TallSpacer",
      absoluteBoundingBox: { x: 0, y: 0, width: 48, height: 80 },
    });
    expect(emptyFrame.check(node, makeContext())).not.toBeNull();
  });

  it("flags empty frame without bounding box", () => {
    const node = makeNode({ type: "FRAME", name: "NoBox" });
    const result = emptyFrame.check(node, makeContext());
    expect(result).not.toBeNull();
  });
});
