import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { nonStandardNaming } from "./index.js";

describe("non-standard-naming", () => {
  it("has correct rule definition metadata", () => {
    const def = nonStandardNaming.definition;
    expect(def.id).toBe("non-standard-naming");
    expect(def.category).toBe("semantic");
  });

  it("flags non-standard state name 'Clicked'", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Clicked", "Disabled"] },
      },
    });
    const ctx = makeContext();
    const result = nonStandardNaming.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("state-name");
    expect(result!.message).toContain("Clicked");
    expect(result!.suggestion).toContain("pressed");
  });

  it("flags 'On' → suggests 'active'", () => {
    const node = makeNode({
      id: "1:1",
      name: "Toggle",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "On"] },
      },
    });
    const ctx = makeContext();
    const result = nonStandardNaming.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.message).toContain("On");
    expect(result!.suggestion).toContain("active");
  });

  it("flags 'Inactive' → suggests 'disabled'", () => {
    const node = makeNode({
      id: "1:1",
      name: "Toggle",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Inactive"] },
      },
    });
    const ctx = makeContext();
    const result = nonStandardNaming.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.message).toContain("Inactive");
    expect(result!.suggestion).toContain("disabled");
  });

  it("passes when all state names are standard", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Hover", "Pressed", "Disabled"] },
      },
    });
    const ctx = makeContext();
    expect(nonStandardNaming.check(node, ctx)).toBeNull();
  });

  it("passes for non-state variant properties", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "Size": { type: "VARIANT", variantOptions: ["Small", "Medium", "Large"] },
      },
    });
    const ctx = makeContext();
    expect(nonStandardNaming.check(node, ctx)).toBeNull();
  });

  it("skips non-COMPONENT_SET nodes", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
    });
    const ctx = makeContext();
    expect(nonStandardNaming.check(node, ctx)).toBeNull();
  });

  it("accepts platform-standard names (pressed, selected, highlighted, focused)", () => {
    const node = makeNode({
      id: "1:1",
      name: "Nav Item",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Pressed", "Selected", "Highlighted", "Focused"] },
      },
    });
    const ctx = makeContext();
    expect(nonStandardNaming.check(node, ctx)).toBeNull();
  });

  it("accepts enabled and dragged (CSS/Material standard)", () => {
    const node = makeNode({
      id: "1:1",
      name: "Chip",
      type: "COMPONENT_SET",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Enabled", "Dragged", "Disabled"] },
      },
    });
    const ctx = makeContext();
    expect(nonStandardNaming.check(node, ctx)).toBeNull();
  });
});
