import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyReplaceWithInstance } from "./apply-replace-with-instance.js";
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

interface FakeParent extends FigmaNode {
  children: FigmaNode[];
  insertChild: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>;
}

interface FakeMain extends FigmaNode {
  createInstance: ReturnType<typeof vi.fn>;
}

interface FakeTarget extends FigmaNode {
  remove: ReturnType<typeof vi.fn>;
}

function autoLayoutParent(): FakeParent {
  const parent: FakeParent = {
    id: "parent-auto",
    name: "Container",
    type: "FRAME",
    layoutMode: "VERTICAL",
    children: [],
    insertChild: vi.fn((index: number, child: FigmaNode) => {
      parent.children.splice(index, 0, child);
    }),
    appendChild: vi.fn((child: FigmaNode) => {
      parent.children.push(child);
    }),
  };
  return parent;
}

function freeFormParent(): FakeParent {
  const parent: FakeParent = {
    id: "parent-free",
    name: "Canvas",
    type: "FRAME",
    layoutMode: "NONE",
    children: [],
    insertChild: vi.fn(),
    appendChild: vi.fn(),
  };
  return parent;
}

function attachTarget(parent: FakeParent, name: string): FakeTarget {
  const target: FakeTarget = {
    id: `target-${name}`,
    name,
    type: "FRAME",
    annotations: [],
    parent,
    remove: vi.fn(() => {
      const idx = parent.children.findIndex((c) => c.id === target.id);
      if (idx >= 0) parent.children.splice(idx, 1);
    }),
  };
  parent.children.push(target);
  return target;
}

function makeMain(id: string, name: string, type = "COMPONENT"): FakeMain {
  let counter = 0;
  const main: FakeMain = {
    id,
    name,
    type,
    annotations: [],
    createInstance: vi.fn(() => {
      counter += 1;
      return { id: `${id}-inst-${counter}`, name, type: "INSTANCE" };
    }),
  };
  return main;
}

let mock: FigmaGlobalMock;

beforeEach(() => {
  mock = createFigmaGlobal();
  installFigmaGlobal(mock);
});

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyReplaceWithInstance — success", () => {
  it("inserts the new instance at the original index and removes the FRAME", async () => {
    const parent = autoLayoutParent();
    const sibling1 = attachTarget(parent, "Other");
    const target = attachTarget(parent, "Card");
    const main = makeMain("main-card", "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      if (id === sibling1.id) return sibling1;
      return null;
    });
    const telemetry = vi.fn();

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("replaced");
    expect(result.icon).toBe("✅");
    expect(result.newInstanceId).toBe("main-card-inst-1");
    expect(parent.insertChild).toHaveBeenCalledWith(1, expect.objectContaining({ type: "INSTANCE" }));
    expect(target.remove).toHaveBeenCalledOnce();
    expect(parent.children.map((c) => c.id)).toEqual([sibling1.id, "main-card-inst-1"]);
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_replace_with_instance",
      expect.objectContaining({ outcome: "replaced", ruleId: RULE_ID })
    );
  });

  it("falls back to appendChild when target is not in parent.children (orphaned index)", async () => {
    const parent = autoLayoutParent();
    const target: FakeTarget = {
      id: "target-x",
      name: "Card",
      type: "FRAME",
      annotations: [],
      parent,
      remove: vi.fn(),
    };
    // Note: target is NOT pushed into parent.children — synthetic edge case.
    const main = makeMain("main-card", "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("replaced");
    expect(parent.appendChild).toHaveBeenCalledOnce();
    expect(parent.insertChild).not.toHaveBeenCalled();
  });
});

describe("applyReplaceWithInstance — guards", () => {
  it("returns `target-missing` without annotation when target id does not resolve", async () => {
    mock.getNodeByIdAsync.mockResolvedValue(null);
    const telemetry = vi.fn();

    const result = await applyReplaceWithInstance({
      mainComponentId: "main-x",
      targetNodeId: "missing",
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("skipped-prereq-missing");
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_replace_with_instance",
      expect.objectContaining({ reason: "target-missing" })
    );
  });

  it("annotates the target when main component is missing", async () => {
    const parent = autoLayoutParent();
    const target = attachTarget(parent, "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: "ghost-main",
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("skipped-prereq-missing");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("ghost-main");
    expect(target.remove).not.toHaveBeenCalled();
  });

  it("annotates when the resolved main is not COMPONENT or COMPONENT_SET", async () => {
    const parent = autoLayoutParent();
    const target = attachTarget(parent, "Card");
    const wrongMain: FigmaNode = {
      id: "main-x",
      name: "WrongMain",
      type: "FRAME",
    };
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === wrongMain.id) return wrongMain;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: wrongMain.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("skipped-prereq-missing");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("not a COMPONENT");
  });

  it("accepts COMPONENT_SET as a valid main", async () => {
    const parent = autoLayoutParent();
    const target = attachTarget(parent, "Card");
    const setMain = makeMain("main-set", "Card", "COMPONENT_SET");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === setMain.id) return setMain;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: setMain.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("replaced");
  });

  it("annotates and refuses when target equals main", async () => {
    const parent = autoLayoutParent();
    const main = makeMain("dual", "Card");
    main.parent = parent;
    parent.children.push(main);
    mock.getNodeByIdAsync.mockResolvedValue(main);

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: main.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("skipped-prereq-missing");
    expect(main.annotations?.[0]?.labelMarkdown).toContain(
      "target and main are the same"
    );
  });

  it("annotates when target has no parent", async () => {
    const orphan: FakeTarget = {
      id: "orphan",
      name: "Card",
      type: "FRAME",
      annotations: [],
      remove: vi.fn(),
    };
    const main = makeMain("main-x", "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === orphan.id) return orphan;
      if (id === main.id) return main;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: orphan.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("skipped-prereq-missing");
    expect(orphan.annotations?.[0]?.labelMarkdown).toContain("no parent");
  });

  it("rejects free-form parents and reports `skipped-free-form-parent`", async () => {
    const parent = freeFormParent();
    const target = attachTarget(parent, "Card");
    const main = makeMain("main-card", "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      return null;
    });
    const telemetry = vi.fn();

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("skipped-free-form-parent");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("Auto Layout");
    expect(target.remove).not.toHaveBeenCalled();
    expect(main.createInstance).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_replace_with_instance",
      expect.objectContaining({ outcome: "skipped-free-form-parent" })
    );
  });
});

describe("applyReplaceWithInstance — error path", () => {
  it("annotates and reports error when createInstance throws", async () => {
    const parent = autoLayoutParent();
    const target = attachTarget(parent, "Card");
    const main = makeMain("main-card", "Card");
    main.createInstance = vi.fn(() => {
      throw new Error("locked layer");
    });
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      return null;
    });
    const telemetry = vi.fn();

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("error");
    expect(result.label).toContain("locked layer");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("locked layer");
    expect(target.remove).not.toHaveBeenCalled();
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_replace_with_instance",
      expect.objectContaining({ outcome: "error", reason: "locked layer" })
    );
  });

  it("reports error when the resolved main exposes no createInstance", async () => {
    const parent = autoLayoutParent();
    const target = attachTarget(parent, "Card");
    const main: FigmaNode = {
      id: "main-x",
      name: "Card",
      type: "COMPONENT",
    };
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("error");
    expect(target.annotations?.[0]?.labelMarkdown).toContain("createInstance");
  });

  it("skips annotation when categories are not supplied", async () => {
    const parent = freeFormParent();
    const target = attachTarget(parent, "Card");
    const main = makeMain("main-card", "Card");
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === target.id) return target;
      if (id === main.id) return main;
      return null;
    });

    const result = await applyReplaceWithInstance({
      mainComponentId: main.id,
      targetNodeId: target.id,
      ruleId: RULE_ID,
    });

    expect(result.outcome).toBe("skipped-free-form-parent");
    expect(target.annotations).toEqual([]);
  });
});
