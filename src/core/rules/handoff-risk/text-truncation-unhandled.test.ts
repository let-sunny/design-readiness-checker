import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { textTruncationUnhandled } from "./index.js";

describe("text-truncation-unhandled", () => {
  it("has correct rule definition metadata", () => {
    expect(textTruncationUnhandled.definition.id).toBe("text-truncation-unhandled");
    expect(textTruncationUnhandled.definition.category).toBe("handoff-risk");
  });

  it("flags long text in constrained auto layout parent", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({
      type: "TEXT",
      name: "Description",
      characters: "A".repeat(60),
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
    });
    const result = textTruncationUnhandled.check(node, makeContext({ parent }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("text-truncation-unhandled");
  });

  it("returns null for non-TEXT nodes", () => {
    const node = makeNode({ type: "FRAME" });
    expect(textTruncationUnhandled.check(node, makeContext())).toBeNull();
  });

  it("returns null when parent has no auto layout", () => {
    const parent = makeNode({});
    const node = makeNode({
      type: "TEXT",
      characters: "A".repeat(60),
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
    });
    expect(textTruncationUnhandled.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null for short text", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({
      type: "TEXT",
      name: "Label",
      characters: "Short",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
    });
    expect(textTruncationUnhandled.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null for wide text container (exactly at 300px boundary)", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({
      type: "TEXT",
      characters: "A".repeat(60),
      absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 20 },
    });
    expect(textTruncationUnhandled.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null when no parent", () => {
    const node = makeNode({
      type: "TEXT",
      characters: "A".repeat(60),
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 20 },
    });
    expect(textTruncationUnhandled.check(node, makeContext())).toBeNull();
  });
});
