import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { nonSemanticName } from "./index.js";

describe("non-semantic-name", () => {
  it("has correct rule definition metadata", () => {
    expect(nonSemanticName.definition.id).toBe("non-semantic-name");
    expect(nonSemanticName.definition.category).toBe("semantic");
  });

  // Default name detection (merged from default-name) — exact subType per node type
  it.each([
    { name: "Frame 1", type: "FRAME", expectedSubType: "frame" },
    { name: "Group 12", type: "GROUP", expectedSubType: "group" },
    { name: "Ellipse", type: "ELLIPSE", expectedSubType: "shape" },
    { name: "Vector 1", type: "VECTOR", expectedSubType: "vector" },
    { name: "Text 2", type: "TEXT", expectedSubType: "text" },
    { name: "Component 1", type: "COMPONENT", expectedSubType: "component" },
    { name: "Instance 3", type: "INSTANCE", expectedSubType: "instance" },
  ] as const)("flags default name $name → subType $expectedSubType", ({ name, type, expectedSubType }) => {
    const node = makeNode({ name, type: type as any });
    const result = nonSemanticName.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("non-semantic-name");
    expect(result!.subType).toBe(expectedSubType);
  });

  // Shape name detection (names only in NON_SEMANTIC_NAMES, not DEFAULT_NAME_PATTERNS)
  it.each(["polygon", "star", "path", "shape", "fill", "stroke"])(
    "flags shape name: %s (on container)",
    (name) => {
      const node = makeNode({ type: "FRAME", name, children: [makeNode()] });
      const result = nonSemanticName.check(node, makeContext());
      expect(result).not.toBeNull();
      expect(result!.subType).toBe("shape-name");
    },
  );

  // Names that overlap DEFAULT_NAME_PATTERNS — caught as default names, not shape names
  it.each(["ellipse", "vector", "line"])(
    "flags %s as default name (overlaps with Figma defaults)",
    (name) => {
      const node = makeNode({ type: "FRAME", name, children: [makeNode()] });
      const result = nonSemanticName.check(node, makeContext());
      expect(result).not.toBeNull();
      expect(result!.subType).toBe("frame"); // FRAME type → caught by isDefaultName first
    },
  );

  // Exclusions
  it.each(["rectangle", "image"])(
    "returns null for %s (excluded by name pattern)",
    (name) => {
      const node = makeNode({ type: "FRAME", name, children: [makeNode()] });
      expect(nonSemanticName.check(node, makeContext())).toBeNull();
    },
  );

  it("allows shape names on leaf shape primitives", () => {
    const node = makeNode({ type: "ELLIPSE" as any, name: "polygon" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });

  it("returns null for semantic names", () => {
    const node = makeNode({ name: "ProductCard" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });

  it("returns null for excluded name patterns", () => {
    const node = makeNode({ name: "Icon Badge" });
    expect(nonSemanticName.check(node, makeContext())).toBeNull();
  });
});
