import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { detachedInstance } from "./index.js";

describe("detached-instance", () => {
  it("has correct rule definition metadata", () => {
    expect(detachedInstance.definition.id).toBe("detached-instance");
    expect(detachedInstance.definition.category).toBe("code-quality");
  });

  it("flags FRAME whose name matches a component", () => {
    const file = makeFile({
      components: {
        "comp-1": { key: "k1", name: "Button", description: "A button" },
      },
    });
    const node = makeNode({ type: "FRAME", name: "Button" });
    const result = detachedInstance.check(node, makeContext({ file }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("detached-instance");
    expect(result!.message).toContain("Button");
  });

  it("flags FRAME whose name contains a component name", () => {
    const file = makeFile({
      components: {
        "comp-1": { key: "k1", name: "Card", description: "" },
      },
    });
    const node = makeNode({ type: "FRAME", name: "Card Copy" });
    const result = detachedInstance.check(node, makeContext({ file }));
    expect(result).not.toBeNull();
    expect(result!.message).toContain("Card");
  });

  it("returns null for non-FRAME nodes", () => {
    const node = makeNode({ type: "INSTANCE" });
    expect(detachedInstance.check(node, makeContext())).toBeNull();
  });

  it("returns null when no components match", () => {
    const file = makeFile({
      components: {
        "comp-1": { key: "k1", name: "Checkbox", description: "" },
      },
    });
    const node = makeNode({ type: "FRAME", name: "Header" });
    expect(detachedInstance.check(node, makeContext({ file }))).toBeNull();
  });

  it("case-sensitive: 'button' does not match component 'Button'", () => {
    const file = makeFile({
      components: {
        "comp-1": { key: "k1", name: "Button", description: "" },
      },
    });
    const node = makeNode({ type: "FRAME", name: "button" });
    expect(detachedInstance.check(node, makeContext({ file }))).toBeNull();
  });

  it("word boundary: 'Discard' does not match component 'Card'", () => {
    const file = makeFile({
      components: {
        "comp-1": { key: "k1", name: "Card", description: "" },
      },
    });
    const node = makeNode({ type: "FRAME", name: "Discard" });
    expect(detachedInstance.check(node, makeContext({ file }))).toBeNull();
  });

  it("returns null when file has no components", () => {
    const node = makeNode({ type: "FRAME", name: "SomeFrame" });
    expect(detachedInstance.check(node, makeContext())).toBeNull();
  });
});
