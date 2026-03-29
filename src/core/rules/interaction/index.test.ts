import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { missingInteractionState, missingPrototype } from "./index.js";

// ============================================
// missing-interaction-state
// ============================================

describe("missing-interaction-state", () => {
  it("has correct rule definition metadata", () => {
    const def = missingInteractionState.definition;
    expect(def.id).toBe("missing-interaction-state");
    expect(def.category).toBe("interaction");
  });

  it("flags INSTANCE button without hover variant", () => {
    const node = makeNode({ id: "1:1", name: "Primary Button", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Button"] });
    const result = missingInteractionState.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
    expect(result!.message).toContain("Hover");
  });

  it("skips non-interactive names", () => {
    const node = makeNode({ id: "1:1", name: "Card", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext();
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("skips FRAME nodes (only INSTANCE/COMPONENT)", () => {
    const node = makeNode({ id: "1:1", name: "Button", type: "FRAME" });
    const ctx = makeContext();
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("passes when variant property has pressed option (active subType)", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "c:1",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Hover", "Pressed", "Disabled"] },
      },
    });
    const ctx = makeContext();
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("passes when variant property has hover option", () => {
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "c:1",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Hover", "Pressed", "Disabled"] },
      },
    });
    const ctx = makeContext();
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("passes when component master has hover variant", () => {
    const masterNode = makeNode({
      id: "c:1",
      name: "Button Master",
      type: "COMPONENT",
      componentPropertyDefinitions: {
        "State": { type: "VARIANT", variantOptions: ["Default", "Hover", "Pressed", "Disabled"] },
      },
    });
    const node = makeNode({
      id: "1:1",
      name: "Button",
      type: "INSTANCE",
      componentId: "c:1",
    });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file });
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("still flags hover even when ON_HOVER prototype exists (prototype ≠ variant)", () => {
    const node = makeNode({
      id: "1:1",
      name: "Link Item",
      type: "INSTANCE",
      componentId: "c:1",
      interactions: [
        { trigger: { type: "ON_HOVER" }, actions: [{ navigation: "CHANGE_TO", destinationId: "d:1" }] },
      ],
    });
    const ctx = makeContext();
    const result = missingInteractionState.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  it("flags input without focus variant", () => {
    const node = makeNode({ id: "1:1", name: "Search Input", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Input"] });
    const result = missingInteractionState.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("focus");
  });

  it("flags tab without hover variant", () => {
    const node = makeNode({ id: "1:1", name: "Navigation Tab", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Tab"] });
    const result = missingInteractionState.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  it("deduplicates per componentId + subType", () => {
    const ctx = makeContext({ path: ["Page", "Section"] });
    // Use link — only expects hover (single state), so dedup is clean
    const node1 = makeNode({ id: "1:1", name: "Link", type: "INSTANCE", componentId: "c:1" });
    const node2 = makeNode({ id: "1:2", name: "Link", type: "INSTANCE", componentId: "c:1" });

    const result1 = missingInteractionState.check(node1, ctx);
    const result2 = missingInteractionState.check(node2, ctx);

    expect(result1).not.toBeNull();
    expect(result1!.subType).toBe("hover");
    expect(result2).toBeNull(); // deduped: same componentId + hover
  });
});

// ============================================
// missing-prototype
// ============================================

describe("missing-prototype", () => {
  it("has correct rule definition metadata", () => {
    const def = missingPrototype.definition;
    expect(def.id).toBe("missing-prototype");
    expect(def.category).toBe("interaction");
  });

  it("flags button without ON_CLICK", () => {
    const node = makeNode({ id: "1:1", name: "CTA Button", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Button"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("button");
  });

  it("flags link without ON_CLICK", () => {
    const node = makeNode({ id: "1:1", name: "Footer Link", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Link"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("navigation");
  });

  it("flags dropdown without ON_CLICK (overlay subType)", () => {
    const node = makeNode({ id: "1:1", name: "Country Dropdown", type: "FRAME" });
    const ctx = makeContext({ path: ["Page", "Dropdown"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("overlay");
  });

  it("flags drawer without ON_CLICK (overlay subType)", () => {
    const node = makeNode({ id: "1:1", name: "Side Drawer", type: "FRAME" });
    const ctx = makeContext({ path: ["Page", "Drawer"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("overlay");
  });

  it("passes when ON_CLICK interaction exists", () => {
    const node = makeNode({
      id: "1:1",
      name: "Nav Link",
      type: "INSTANCE",
      componentId: "c:1",
      interactions: [
        { trigger: { type: "ON_CLICK" }, actions: [{ navigation: "NAVIGATE", destinationId: "page:2" }] },
      ],
    });
    const ctx = makeContext();
    expect(missingPrototype.check(node, ctx)).toBeNull();
  });

  it("passes when component master has ON_CLICK (instance inheritance)", () => {
    const masterNode = makeNode({
      id: "c:1",
      name: "Button Master",
      type: "COMPONENT",
      interactions: [
        { trigger: { type: "ON_CLICK" }, actions: [{ navigation: "NAVIGATE", destinationId: "page:2" }] },
      ],
    });
    const node = makeNode({ id: "1:1", name: "CTA Button", type: "INSTANCE", componentId: "c:1" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Button"] });
    expect(missingPrototype.check(node, ctx)).toBeNull();
  });

  it("skips non-interactive names", () => {
    const node = makeNode({ id: "1:1", name: "Product Card", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext();
    expect(missingPrototype.check(node, ctx)).toBeNull();
  });

  it("flags input without ON_CLICK", () => {
    const node = makeNode({ id: "1:1", name: "Email Input", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Input"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("input");
  });

  it("flags toggle without ON_CLICK", () => {
    const node = makeNode({ id: "1:1", name: "Dark Mode Toggle", type: "INSTANCE", componentId: "c:1" });
    const ctx = makeContext({ path: ["Page", "Toggle"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("toggle");
  });

  it("deduplicates per componentId + subType", () => {
    const ctx = makeContext({ path: ["Page", "Section"] });
    const node1 = makeNode({ id: "1:1", name: "Tab Item", type: "INSTANCE", componentId: "c:1" });
    const node2 = makeNode({ id: "1:2", name: "Tab Item", type: "INSTANCE", componentId: "c:1" });

    const result1 = missingPrototype.check(node1, ctx);
    const result2 = missingPrototype.check(node2, ctx);

    expect(result1).not.toBeNull();
    expect(result2).toBeNull(); // deduped
  });

  it("flags FRAME with interactive name (detached instance)", () => {
    const node = makeNode({ id: "1:1", name: "Submit Button", type: "FRAME" });
    const ctx = makeContext({ path: ["Page", "Form"] });
    const result = missingPrototype.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("button");
  });
});
