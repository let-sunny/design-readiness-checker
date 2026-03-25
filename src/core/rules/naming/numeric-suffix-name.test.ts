import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { numericSuffixName } from "./index.js";

describe("numeric-suffix-name", () => {
  it("has correct rule definition metadata", () => {
    expect(numericSuffixName.definition.id).toBe("numeric-suffix-name");
    expect(numericSuffixName.definition.category).toBe("naming");
  });

  it("flags names with numeric suffix like 'Card 2'", () => {
    const node = makeNode({ name: "Card 2" });
    const result = numericSuffixName.check(node, makeContext());
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("numeric-suffix-name");
  });

  it("flags names like 'Section 10'", () => {
    const node = makeNode({ name: "Section 10" });
    const result = numericSuffixName.check(node, makeContext());
    expect(result).not.toBeNull();
  });

  it("does not flag default names (caught by default-name rule)", () => {
    const node = makeNode({ name: "Frame 1" });
    expect(numericSuffixName.check(node, makeContext())).toBeNull();
  });

  it("returns null for names without numeric suffix", () => {
    const node = makeNode({ name: "ProductCard" });
    expect(numericSuffixName.check(node, makeContext())).toBeNull();
  });

  it("returns null for excluded name patterns", () => {
    const node = makeNode({ name: "icon 3" });
    expect(numericSuffixName.check(node, makeContext())).toBeNull();
  });

  it("returns null for names ending in number without space", () => {
    const node = makeNode({ name: "Step3" });
    expect(numericSuffixName.check(node, makeContext())).toBeNull();
  });

  it("returns null for empty name", () => {
    const node = makeNode({ name: "" });
    expect(numericSuffixName.check(node, makeContext())).toBeNull();
  });
});
