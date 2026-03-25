import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { nonSemanticName } from "./index.js";

describe("non-semantic-name", () => {
  it("has correct rule definition metadata", () => {
    expect(nonSemanticName.definition.id).toBe("non-semantic-name");
    expect(nonSemanticName.definition.category).toBe("naming");
  });

  it("flags non-semantic name on container node", () => {
    const node = makeNode({ type: "FRAME", name: "ellipse", children: [makeNode()] });
    const result = nonSemanticName.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("non-semantic-name");
  });

  it.each(["ellipse", "vector", "line", "polygon", "star", "path", "shape", "fill", "stroke"])(
    "flags non-semantic name: %s (on container)",
    (name) => {
      const node = makeNode({ type: "FRAME", name, children: [makeNode()] });
      expect(nonSemanticName.check(node, makeContext())).not.toBeNull();
    },
  );

  it.each(["rectangle", "image"])(
    "returns null for %s (excluded by name pattern)",
    (name) => {
      const node = makeNode({ type: "FRAME", name, children: [makeNode()] });
      expect(nonSemanticName.check(node, makeContext())).toBeNull();
    },
  );

  it("allows non-semantic names on leaf shape primitives", () => {
    const node = makeNode({ type: "RECTANGLE", name: "vector" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });

  it("allows non-semantic names on leaf ELLIPSE", () => {
    const node = makeNode({ type: "ELLIPSE", name: "ellipse" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });

  it("returns null for semantic names", () => {
    const node = makeNode({ name: "Divider" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });

  it("returns null for excluded name patterns", () => {
    const node = makeNode({ name: "icon" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });
});
