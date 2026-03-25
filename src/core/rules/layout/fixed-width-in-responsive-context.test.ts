import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { fixedWidthInResponsiveContext } from "./index.js";

describe("fixed-width-in-responsive-context", () => {
  it("has correct rule definition metadata", () => {
    expect(fixedWidthInResponsiveContext.definition.id).toBe("fixed-width-in-responsive-context");
    expect(fixedWidthInResponsiveContext.definition.category).toBe("layout");
  });

  it("flags container with FIXED horizontal sizing in auto layout parent", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "FRAME", name: "LeftPanel", layoutSizingHorizontal: "FIXED" });
    const result = fixedWidthInResponsiveContext.check(node, makeContext({ parent }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fixed-width-in-responsive-context");
  });

  it("returns null when no parent", () => {
    const node = makeNode({ type: "FRAME", layoutSizingHorizontal: "FIXED" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext())).toBeNull();
  });

  it("returns null when parent has no auto layout", () => {
    const parent = makeNode({});
    const node = makeNode({ type: "FRAME", layoutSizingHorizontal: "FIXED" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null for non-container nodes", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "TEXT", layoutSizingHorizontal: "FIXED" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null when sizing is FILL", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "FRAME", layoutSizingHorizontal: "FILL" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null when sizing is HUG", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "FRAME", layoutSizingHorizontal: "HUG" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("returns null for excluded name patterns", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "FRAME", name: "navigation", layoutSizingHorizontal: "FIXED" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("fallback: returns null when layoutAlign is STRETCH (no layoutSizingHorizontal)", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({ type: "FRAME", layoutAlign: "STRETCH" });
    expect(fixedWidthInResponsiveContext.check(node, makeContext({ parent }))).toBeNull();
  });

  it("fallback: flags when layoutAlign is INHERIT (no layoutSizingHorizontal)", () => {
    const parent = makeNode({ layoutMode: "HORIZONTAL" });
    const node = makeNode({
      type: "FRAME",
      name: "FixedPanel",
      layoutAlign: "INHERIT",
      absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
    });
    const result = fixedWidthInResponsiveContext.check(node, makeContext({ parent }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("fixed-width-in-responsive-context");
  });
});
