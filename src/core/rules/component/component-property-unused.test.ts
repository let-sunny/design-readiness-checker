import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { componentPropertyUnused } from "./index.js";

describe("component-property-unused", () => {
  it("has correct rule definition metadata", () => {
    expect(componentPropertyUnused.definition.id).toBe("component-property-unused");
    expect(componentPropertyUnused.definition.category).toBe("component");
  });

  it("returns null for non-component nodes", () => {
    const node = makeNode({ type: "FRAME" });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it("returns null for components without property definitions", () => {
    const node = makeNode({ type: "COMPONENT" });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it("returns null for components with empty property definitions", () => {
    const node = makeNode({ type: "COMPONENT", componentPropertyDefinitions: {} });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it.todo("flags component with unused property bindings (binding check not yet implemented)");
});
