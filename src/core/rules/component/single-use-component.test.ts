import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { singleUseComponent } from "./index.js";

describe("single-use-component", () => {
  it("has correct rule definition metadata", () => {
    expect(singleUseComponent.definition.id).toBe("single-use-component");
    expect(singleUseComponent.definition.category).toBe("component");
  });

  it("flags component used only once", () => {
    const component = makeNode({ id: "comp:1", type: "COMPONENT", name: "Badge" });
    const instance = makeNode({ id: "inst:1", type: "INSTANCE", componentId: "comp:1" });
    const document = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [component, instance],
    });

    const ctx = makeContext({
      file: {
        fileKey: "f",
        name: "F",
        lastModified: "",
        version: "1",
        document,
        components: {},
        styles: {},
      },
    });

    const result = singleUseComponent.check(component, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("single-use-component");
    expect(result!.message).toContain("Badge");
  });

  it("returns null for component used multiple times", () => {
    const component = makeNode({ id: "comp:1", type: "COMPONENT", name: "Badge" });
    const inst1 = makeNode({ id: "inst:1", type: "INSTANCE", componentId: "comp:1" });
    const inst2 = makeNode({ id: "inst:2", type: "INSTANCE", componentId: "comp:1" });
    const document = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [component, inst1, inst2],
    });

    const ctx = makeContext({
      file: {
        fileKey: "f",
        name: "F",
        lastModified: "",
        version: "1",
        document,
        components: {},
        styles: {},
      },
    });

    expect(singleUseComponent.check(component, ctx)).toBeNull();
  });

  it("flags single-use component when instance is deeply nested", () => {
    const component = makeNode({ id: "comp:1", type: "COMPONENT", name: "Badge" });
    const instance = makeNode({ id: "inst:1", type: "INSTANCE", componentId: "comp:1" });
    const innerFrame = makeNode({ id: "inner:1", type: "FRAME", children: [instance] });
    const outerFrame = makeNode({ id: "outer:1", type: "FRAME", children: [innerFrame] });
    const document = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [component, outerFrame],
    });

    const ctx = makeContext({
      file: {
        fileKey: "f",
        name: "F",
        lastModified: "",
        version: "1",
        document,
        components: {},
        styles: {},
      },
    });

    const result = singleUseComponent.check(component, ctx);
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("single-use-component");
    expect(result!.message).toContain("Badge");
  });

  it("returns null for non-component nodes", () => {
    const node = makeNode({ type: "FRAME" });
    expect(singleUseComponent.check(node, makeContext())).toBeNull();
  });

  it("returns null for component with zero instances", () => {
    const component = makeNode({ id: "comp:1", type: "COMPONENT", name: "Unused" });
    const document = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [component],
    });

    const ctx = makeContext({
      file: {
        fileKey: "f",
        name: "F",
        lastModified: "",
        version: "1",
        document,
        components: {},
        styles: {},
      },
    });

    expect(singleUseComponent.check(component, ctx)).toBeNull();
  });
});
