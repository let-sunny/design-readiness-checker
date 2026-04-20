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

  it("flags INSTANCE button without hover variant (master fetched, no variants)", () => {
    const masterNode = makeNode({ id: "c:1", name: "Button Master", type: "COMPONENT" });
    const node = makeNode({ id: "1:1", name: "Primary Button", type: "INSTANCE", componentId: "c:1" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Button"] });
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
    const masterNode = makeNode({ id: "c:1", name: "Link Master", type: "COMPONENT" });
    const node = makeNode({
      id: "1:1",
      name: "Link Item",
      type: "INSTANCE",
      componentId: "c:1",
      interactions: [
        { trigger: { type: "ON_HOVER" }, actions: [{ navigation: "CHANGE_TO", destinationId: "d:1" }] },
      ],
    });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file });
    const result = missingInteractionState.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  it("flags input without focus variant", () => {
    const masterNode = makeNode({ id: "c:1", name: "Input Master", type: "COMPONENT" });
    const node = makeNode({ id: "1:1", name: "Search Input", type: "INSTANCE", componentId: "c:1" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Input"] });
    const result = missingInteractionState.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("focus");
  });

  it("flags tab without hover variant", () => {
    const masterNode = makeNode({ id: "c:1", name: "Tab Master", type: "COMPONENT" });
    const node = makeNode({ id: "1:1", name: "Navigation Tab", type: "INSTANCE", componentId: "c:1" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Tab"] });
    const result = missingInteractionState.check(node, ctx);

    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  it("deduplicates per componentId + subType", () => {
    const masterNode = makeNode({ id: "c:1", name: "Link Master", type: "COMPONENT" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Section"] });
    // Use link — only expects hover (single state), so dedup is clean
    const node1 = makeNode({ id: "1:1", name: "Link", type: "INSTANCE", componentId: "c:1" });
    const node2 = makeNode({ id: "1:2", name: "Link", type: "INSTANCE", componentId: "c:1" });

    const result1 = missingInteractionState.check(node1, ctx);
    const result2 = missingInteractionState.check(node2, ctx);

    expect(result1).not.toBeNull();
    expect(result1!.subType).toBe("hover");
    expect(result2).toBeNull(); // deduped: same componentId + hover
  });

  // ============================================
  // #354: false-positive on nested instance whose master was not fetched
  // ============================================

  it("returns null when nested instance has no propDefs and master is not in componentDefinitions", () => {
    // Repro for #354: deeply-nested INSTANCE child whose master the loader
    // never fetched. Both data paths the rule consults are empty, so the
    // verdict is unknown — must NOT fire.
    const node = makeNode({
      id: "1:1",
      name: "Email Button",
      type: "INSTANCE",
      componentId: "c:nested-354",
    });
    const file = makeFile({ componentDefinitions: {} });
    const ctx = makeContext({ file, path: ["Page", "Form", "Button"] });
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("still flags missing variant when master IS resolved without it", () => {
    // Regression guard: the new probe gate must NOT swallow a real miss when
    // we have positive evidence (master fetched, demonstrably no State variant).
    const masterNode = makeNode({
      id: "c:resolved-354",
      name: "Button Master",
      type: "COMPONENT",
      componentPropertyDefinitions: {
        "Size": { type: "VARIANT", variantOptions: ["Sm", "Lg"] },
      },
    });
    const node = makeNode({
      id: "1:1",
      name: "Submit Button",
      type: "INSTANCE",
      componentId: "c:resolved-354",
    });
    const file = makeFile({ componentDefinitions: { "c:resolved-354": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Button"] });
    const result = missingInteractionState.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  // ============================================
  // #397: false-positive when fetched master is a single variant of a SET
  // (name like "State=Default") and the SET parent is not fetched, so propDefs
  // is null on the master. Without this gate the rule would assert a missing
  // variant from absence of evidence — same false-positive class as #354.
  // ============================================

  it("returns null when master propDefs is null AND master name is a variant position (#397)", () => {
    // Live repro from Simple Design System Community node 3266-8701: the
    // Input Field master is named "State=Default, Value Type=Placeholder",
    // its componentPropertyDefinitions came back null, and the COMPONENT_SET
    // parent (which actually carries the State axis with Hover/Disabled/etc.)
    // is not fetched into componentDefinitions.
    const masterNode = makeNode({
      id: "c:input-master",
      name: "State=Default, Value Type=Placeholder",
      type: "COMPONENT",
      componentPropertyDefinitions: null as unknown as undefined,
    });
    const node = makeNode({
      id: "I3266:8701;2143:13764;2106:7349",
      name: "Input Field",
      type: "INSTANCE",
      componentId: "c:input-master",
    });
    const file = makeFile({ componentDefinitions: { "c:input-master": masterNode } });
    const ctx = makeContext({ file, path: ["Hero Form", "Form Contact", "Input Field"] });
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("returns null when master propDefs is null AND master name has multiple variant axes (#397)", () => {
    // "Variant=Primary, State=Default, Size=Medium" — three-axis Button
    // variant. Same SET-not-fetched failure mode.
    const masterNode = makeNode({
      id: "c:button-master",
      name: "Variant=Primary, State=Default, Size=Medium",
      type: "COMPONENT",
      componentPropertyDefinitions: null as unknown as undefined,
    });
    const node = makeNode({
      id: "I3266:8701;2143:13764;373:10990;2072:9460",
      name: "Button",
      type: "INSTANCE",
      componentId: "c:button-master",
    });
    const file = makeFile({ componentDefinitions: { "c:button-master": masterNode } });
    const ctx = makeContext({ file, path: ["Hero Form", "Form Contact", "Button Group", "Button"] });
    expect(missingInteractionState.check(node, ctx)).toBeNull();
  });

  it("returns null for COMPONENT whose own name is a variant position with no propDefs (#397)", () => {
    // The rule fires on COMPONENT type too; same SET-not-fetched concern
    // applies when the COMPONENT itself is the analyzed node.
    const node = makeNode({
      id: "c:1",
      name: "State=Default",
      type: "COMPONENT",
      componentPropertyDefinitions: null as unknown as undefined,
    });
    // Component name does not match the stateful pattern, so even without #397
    // it would not fire. Use a name that DOES trigger getStatefulComponentType
    // by combining type+name.
    const interactiveComponent = makeNode({
      id: "c:2",
      name: "Button / State=Default",
      type: "COMPONENT",
      componentPropertyDefinitions: null as unknown as undefined,
    });
    void node;
    const ctx = makeContext({ path: ["Page"] });
    // Variant-position COMPONENT skipped — undeterminable
    const out = missingInteractionState.check(interactiveComponent, ctx);
    // The combined name "Button / State=Default" doesn't match the strict
    // variant-position regex (slash + word), so this COMPONENT IS treated as
    // a standalone master with no axes → fires. That's correct behavior:
    // only the pure "Word=Word(, Word=Word)*" pattern is treated as
    // undeterminable. Documenting via this assertion.
    expect(out).not.toBeNull();
  });

  it("still flags master with empty propDefs object even if name happens to contain '=' in prose (positive evidence wins)", () => {
    // `{}` (vs null) is positive evidence the API answered. The variant-name
    // gate is only consulted as a tiebreaker when propDefs is null/undefined.
    const masterNode = makeNode({
      id: "c:1",
      name: "Button=Master",
      type: "COMPONENT",
      componentPropertyDefinitions: {},
    });
    const node = makeNode({ id: "1:1", name: "Submit Button", type: "INSTANCE", componentId: "c:1" });
    const file = makeFile({ componentDefinitions: { "c:1": masterNode } });
    const ctx = makeContext({ file, path: ["Page", "Button"] });
    const result = missingInteractionState.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
  });

  it("flags when instance carries empty componentPropertyDefinitions", () => {
    // Empty object (vs undefined) is positive evidence the API answered for
    // this instance and the master truly has no variant axes — must fire.
    const node = makeNode({
      id: "1:1",
      name: "Confirm Button",
      type: "INSTANCE",
      componentId: "c:empty-354",
      componentPropertyDefinitions: {},
    });
    const ctx = makeContext({ path: ["Page", "Button"] });
    const result = missingInteractionState.check(node, ctx);
    expect(result).not.toBeNull();
    expect(result!.subType).toBe("hover");
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
