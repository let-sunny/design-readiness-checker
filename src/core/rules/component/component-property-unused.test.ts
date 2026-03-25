import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import type { AnalysisFile } from "../../contracts/figma-node.js";
import { componentPropertyUnused } from "./index.js";

function makeFileWithComponentDefs(defs: Record<string, unknown>): AnalysisFile {
  return {
    ...makeFile(),
    componentDefinitions: {
      "comp:1": makeNode({
        id: "comp:1",
        type: "COMPONENT",
        name: "Button",
        componentPropertyDefinitions: defs,
      }),
    },
  };
}

describe("component-property-unused", () => {
  it("has correct rule definition metadata", () => {
    expect(componentPropertyUnused.definition.id).toBe("component-property-unused");
    expect(componentPropertyUnused.definition.category).toBe("component");
  });

  it("returns null for non-INSTANCE nodes", () => {
    const node = makeNode({ type: "FRAME" });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it("returns null for instance without componentId", () => {
    const node = makeNode({ type: "INSTANCE" });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it("returns null when component has no property definitions", () => {
    const file = makeFileWithComponentDefs({});
    const node = makeNode({ type: "INSTANCE", componentId: "comp:1" });
    expect(componentPropertyUnused.check(node, makeContext({ file }))).toBeNull();
  });

  it("returns null when no componentDefinitions in file", () => {
    const node = makeNode({ type: "INSTANCE", componentId: "comp:1" });
    expect(componentPropertyUnused.check(node, makeContext())).toBeNull();
  });

  it("flags instance that does not customize any properties", () => {
    const file = makeFileWithComponentDefs({ label: { type: "TEXT" }, icon: { type: "BOOLEAN" } });
    const node = makeNode({ type: "INSTANCE", name: "MyButton", componentId: "comp:1" });
    const result = componentPropertyUnused.check(node, makeContext({ file }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("component-property-unused");
    expect(result!.message).toContain("2 available component properties");
  });

  it("returns null when instance has property overrides", () => {
    const file = makeFileWithComponentDefs({ label: { type: "TEXT" } });
    const node = makeNode({
      type: "INSTANCE",
      componentId: "comp:1",
      componentProperties: { label: { value: "Submit" } },
    });
    expect(componentPropertyUnused.check(node, makeContext({ file }))).toBeNull();
  });
});
