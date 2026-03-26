import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { rawColor } from "./index.js";

describe("raw-color", () => {
  it("has correct rule definition metadata", () => {
    const def = rawColor.definition;
    expect(def.id).toBe("raw-color");
    expect(def.category).toBe("token");
    expect(def.why).toContain("Raw hex");
    expect(def.fix).toContain("color style");
  });

  it("returns null for nodes without fills", () => {
    const node = makeNode({});
    const ctx = makeContext();
    expect(rawColor.check(node, ctx)).toBeNull();
  });

  it("returns null for empty fills array", () => {
    const node = makeNode({ fills: [] });
    const ctx = makeContext();
    expect(rawColor.check(node, ctx)).toBeNull();
  });

  it("returns null when fill style is applied", () => {
    const node = makeNode({
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      styles: { fill: "S:style-id" },
    });
    const ctx = makeContext();
    expect(rawColor.check(node, ctx)).toBeNull();
  });

  it("returns null when fills variable is bound", () => {
    const node = makeNode({
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
      boundVariables: { fills: "var-id" },
    });
    const ctx = makeContext();
    expect(rawColor.check(node, ctx)).toBeNull();
  });

  it("flags solid fill without style or variable", () => {
    const node = makeNode({
      name: "RawBox",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
    });
    const ctx = makeContext();

    const result = rawColor.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("raw-color");
    expect(result!.message).toContain("RawBox");
    expect(result!.message).toContain("raw fill color");
  });

  it("returns null for gradient fills (non-SOLID)", () => {
    const node = makeNode({
      fills: [{ type: "GRADIENT_LINEAR" }],
    });
    const ctx = makeContext();
    expect(rawColor.check(node, ctx)).toBeNull();
  });
});
