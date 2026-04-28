import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyComponentize } from "./apply-componentize.js";
import {
  createFigmaGlobal,
  installFigmaGlobal,
  uninstallFigmaGlobal,
  type FigmaGlobalMock,
} from "./test-utils.js";
import type { CanicodeCategories, FigmaNode } from "./types.js";

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

const RULE_ID = "missing-component";

function autoLayoutParent(): FigmaNode {
  return {
    id: "parent-auto",
    name: "Cards Container",
    type: "FRAME",
    layoutMode: "VERTICAL",
  };
}

function freeFormParent(): FigmaNode {
  return {
    id: "parent-free",
    name: "Canvas",
    type: "FRAME",
    layoutMode: "NONE",
  };
}

function instanceAncestorChain(): FigmaNode {
  const inst: FigmaNode = {
    id: "inst-1",
    name: "Instance",
    type: "INSTANCE",
  };
  const wrapper: FigmaNode = {
    id: "wrap-1",
    name: "Wrap",
    type: "FRAME",
    layoutMode: "VERTICAL",
    parent: inst,
  };
  return wrapper;
}

function makeFrame(name: string, parent: FigmaNode): FigmaNode {
  return {
    id: `frame-${name}`,
    name,
    type: "FRAME",
    annotations: [],
    parent,
  };
}

let mock: FigmaGlobalMock;

beforeEach(() => {
  mock = createFigmaGlobal();
  installFigmaGlobal(mock);
});

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyComponentize — guards", () => {
  it("rejects nodes inside an INSTANCE subtree and annotates instead", () => {
    const wrapper = instanceAncestorChain();
    const target = makeFrame("Card", wrapper);
    const telemetry = vi.fn();
    mock.createComponentFromNode = vi.fn();

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("skipped-inside-instance");
    expect(result.icon).toBe("📝");
    expect(result.newComponentId).toBeUndefined();
    expect(mock.createComponentFromNode).not.toHaveBeenCalled();
    expect(target.annotations?.[0]?.labelMarkdown).toContain(
      "inside an INSTANCE subtree"
    );
    expect(target.annotations?.[0]?.categoryId).toBe(CATEGORIES.flag);
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_componentize",
      expect.objectContaining({
        outcome: "skipped-inside-instance",
        ruleId: RULE_ID,
      })
    );
  });

  it("rejects free-form parents (layoutMode=NONE) and annotates instead", () => {
    const target = makeFrame("Card", freeFormParent());
    const telemetry = vi.fn();
    mock.createComponentFromNode = vi.fn();

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("skipped-free-form-parent");
    expect(mock.createComponentFromNode).not.toHaveBeenCalled();
    expect(target.annotations?.[0]?.labelMarkdown).toContain("Auto Layout");
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_componentize",
      expect.objectContaining({ outcome: "skipped-free-form-parent" })
    );
  });

  it("treats a missing parent as free-form (no implicit layout)", () => {
    const orphan: FigmaNode = {
      id: "orphan",
      name: "Card",
      type: "FRAME",
      annotations: [],
    };
    const result = applyComponentize({
      node: orphan,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });
    expect(result.outcome).toBe("skipped-free-form-parent");
  });

  it("walks past non-instance ancestors before clearing the inside-instance guard", () => {
    const root: FigmaNode = {
      id: "root",
      name: "Root",
      type: "FRAME",
      layoutMode: "VERTICAL",
    };
    const wrapA: FigmaNode = {
      id: "wrap-a",
      name: "WrapA",
      type: "FRAME",
      layoutMode: "VERTICAL",
      parent: root,
    };
    const wrapB: FigmaNode = {
      id: "wrap-b",
      name: "WrapB",
      type: "FRAME",
      layoutMode: "VERTICAL",
      parent: wrapA,
    };
    const target = makeFrame("Card", wrapB);
    mock.createComponentFromNode = vi.fn(() => ({
      id: "comp-x",
      name: "Card",
      type: "COMPONENT",
    }));

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });
    expect(result.outcome).toBe("componentized");
  });
});

describe("applyComponentize — success path", () => {
  it("creates the component and returns the new component id", () => {
    const target = makeFrame("Card", autoLayoutParent());
    const created: FigmaNode = {
      id: "comp-new",
      name: "Card",
      type: "COMPONENT",
    };
    mock.createComponentFromNode = vi.fn(() => created);
    const telemetry = vi.fn();

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("componentized");
    expect(result.icon).toBe("✅");
    expect(result.newComponentId).toBe("comp-new");
    expect(result.finalName).toBe("Card");
    expect(result.nameCollisionResolved).toBeUndefined();
    expect(mock.createComponentFromNode).toHaveBeenCalledWith(target);
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_componentize",
      expect.objectContaining({
        outcome: "componentized",
        nameCollisionResolved: false,
      })
    );
  });

  it("auto-suffixes ` 2` on a name collision and reports the rename", () => {
    const target = makeFrame("Card", autoLayoutParent());
    const created: FigmaNode = {
      id: "comp-new",
      name: "Card",
      type: "COMPONENT",
    };
    mock.createComponentFromNode = vi.fn(() => created);

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(["Card"]),
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("componentized");
    expect(result.finalName).toBe("Card 2");
    expect(result.nameCollisionResolved).toBe(true);
    expect(result.label).toContain("renamed from collision");
    expect(created.name).toBe("Card 2");
  });

  it("walks the suffix counter when ` 2` also collides", () => {
    const target = makeFrame("Card", autoLayoutParent());
    const created: FigmaNode = {
      id: "comp-new",
      name: "Card",
      type: "COMPONENT",
    };
    mock.createComponentFromNode = vi.fn(() => created);

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(["Card", "Card 2", "Card 3"]),
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.finalName).toBe("Card 4");
    expect(result.nameCollisionResolved).toBe(true);
  });
});

describe("applyComponentize — error and host gaps", () => {
  it("annotates and reports outcome=error when the host omits createComponentFromNode", () => {
    const target = makeFrame("Card", autoLayoutParent());
    mock.createComponentFromNode = undefined;
    const telemetry = vi.fn();

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("error");
    expect(result.icon).toBe("📝");
    expect(target.annotations?.[0]?.labelMarkdown).toContain(
      "createComponentFromNode"
    );
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_componentize",
      expect.objectContaining({
        outcome: "error",
        reason: "createComponentFromNode-missing",
      })
    );
  });

  it("annotates and reports the thrown message when the call throws", () => {
    const target = makeFrame("Card", autoLayoutParent());
    mock.createComponentFromNode = vi.fn(() => {
      throw new Error("Locked layer");
    });
    const telemetry = vi.fn();

    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("error");
    expect(result.label).toContain("Locked layer");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("Locked layer");
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_componentize",
      expect.objectContaining({ outcome: "error", reason: "Locked layer" })
    );
  });

  it("skips annotation gracefully when categories are not supplied", () => {
    const target = makeFrame("Card", freeFormParent());
    const result = applyComponentize({
      node: target,
      existingComponentNames: new Set(),
      ruleId: RULE_ID,
    });
    expect(result.outcome).toBe("skipped-free-form-parent");
    expect(target.annotations).toEqual([]);
  });
});
