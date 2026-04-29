import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyGroupComponentize } from "./apply-group-componentize.js";
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

interface FakeFrame extends FigmaNode {
  remove: ReturnType<typeof vi.fn>;
}

function attachFrame(parent: FakeParent, name: string): FakeFrame {
  const frame: FakeFrame = {
    id: `frame-${name}`,
    name,
    type: "FRAME",
    annotations: [],
    parent,
    remove: vi.fn(() => {
      const idx = parent.children.findIndex((c) => c.id === frame.id);
      if (idx >= 0) parent.children.splice(idx, 1);
    }),
  };
  parent.children.push(frame);
  return frame;
}

let mock: FigmaGlobalMock;
let nextComponentInstanceCounter: number;

function setupCreateFromNode() {
  // The componentize step calls `figma.createComponentFromNode(node)`.
  // Our mock returns a COMPONENT node with `createInstance` wired so the
  // subsequent replace step can land instances back into the parent.
  mock.createComponentFromNode = vi.fn((node: FigmaNode) => {
    nextComponentInstanceCounter = 0;
    const componentId = `comp-${node.id}`;
    const componentNode: FigmaNode = {
      id: componentId,
      name: node.name,
      type: "COMPONENT",
      annotations: [],
      createInstance: vi.fn(() => {
        nextComponentInstanceCounter += 1;
        return {
          id: `${componentId}-inst-${nextComponentInstanceCounter}`,
          name: node.name,
          type: "INSTANCE",
        };
      }),
    };
    return componentNode;
  });
}

beforeEach(() => {
  mock = createFigmaGlobal();
  installFigmaGlobal(mock);
  nextComponentInstanceCounter = 0;
});

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyGroupComponentize — happy path", () => {
  it("componentizes the first member and swaps the rest with instances", async () => {
    const parent = autoLayoutParent();
    const cardA = attachFrame(parent, "A");
    const cardB = attachFrame(parent, "B");
    const cardC = attachFrame(parent, "C");
    setupCreateFromNode();

    // Test orchestration relies on getNodeByIdAsync resolving each member +
    // the freshly-componentized main. The mock's default impl returns null;
    // intercept to look up our local fakes.
    const newComponent = mock.createComponentFromNode!.getMockImplementation()!;
    let createdMain: FigmaNode | null = null;
    mock.createComponentFromNode = vi.fn((node: FigmaNode) => {
      createdMain = newComponent(node);
      return createdMain!;
    });
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === cardA.id) return cardA;
      if (id === cardB.id) return cardB;
      if (id === cardC.id) return cardC;
      if (createdMain && id === createdMain.id) return createdMain;
      return null;
    });

    const telemetry = vi.fn();

    const result = await applyGroupComponentize({
      question: {
        ruleId: RULE_ID,
        groupMembers: [cardA.id, cardB.id, cardC.id],
      },
      existingComponentNames: new Set(),
      categories: CATEGORIES,
      telemetry,
    });

    expect(result.outcome).toBe("componentized-and-swapped");
    expect(result.componentizeResult?.outcome).toBe("componentized");
    expect(result.componentizeResult?.newComponentId).toBe(`comp-${cardA.id}`);
    expect(result.replaceResults).toHaveLength(2);
    expect(result.replaceResults.every((r) => r.outcome === "replaced")).toBe(
      true
    );
    expect(cardB.remove).toHaveBeenCalledOnce();
    expect(cardC.remove).toHaveBeenCalledOnce();
    expect(result.summary).toBe(
      `componentized "A", swapped 2/2 siblings`
    );

    // Telemetry: 1 componentize event + 2 replace events.
    const events = telemetry.mock.calls.map((c) => c[0]);
    expect(events).toEqual([
      "cic_roundtrip_componentize",
      "cic_roundtrip_replace_with_instance",
      "cic_roundtrip_replace_with_instance",
    ]);
  });

  it("uses the suffixed name when componentize resolves a name collision", async () => {
    const parent = autoLayoutParent();
    const cardA = attachFrame(parent, "Card");
    const cardB = attachFrame(parent, "Card");
    setupCreateFromNode();

    let createdMain: FigmaNode | null = null;
    const innerCreate = mock.createComponentFromNode!.getMockImplementation()!;
    mock.createComponentFromNode = vi.fn((node: FigmaNode) => {
      createdMain = innerCreate(node);
      return createdMain!;
    });
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === cardA.id) return cardA;
      if (id === cardB.id) return cardB;
      if (createdMain && id === createdMain.id) return createdMain;
      return null;
    });

    const result = await applyGroupComponentize({
      question: { ruleId: RULE_ID, groupMembers: [cardA.id, cardB.id] },
      existingComponentNames: new Set(["Card"]),
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("componentized-and-swapped");
    expect(result.componentizeResult?.finalName).toBe("Card 2");
    expect(result.summary).toBe(`componentized "Card 2", swapped 1/1 siblings`);
  });
});

describe("applyGroupComponentize — componentize fails", () => {
  it("does not attempt swap when componentize is rejected by the free-form-parent guard", async () => {
    const parent = freeFormParent();
    const cardA = attachFrame(parent, "Card A");
    const cardB = attachFrame(parent, "Card B");
    setupCreateFromNode();
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === cardA.id) return cardA;
      if (id === cardB.id) return cardB;
      return null;
    });

    const result = await applyGroupComponentize({
      question: { ruleId: RULE_ID, groupMembers: [cardA.id, cardB.id] },
      existingComponentNames: new Set(),
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("componentize-failed");
    expect(result.componentizeResult?.outcome).toBe(
      "skipped-free-form-parent"
    );
    expect(result.replaceResults).toHaveLength(0);
    expect(mock.createComponentFromNode).not.toHaveBeenCalled();
    expect(cardB.remove).not.toHaveBeenCalled();
    // The componentize annotate-fallback already landed on cardA; the
    // summary just reports the high-level skip reason.
    expect(result.summary).toContain("group componentize skipped");
  });
});

describe("applyGroupComponentize — partial swap failures", () => {
  it("aggregates per-target outcomes including failed swaps", async () => {
    // Mixed scenario: cardA componentizes OK, cardB swaps OK, cardC's
    // parent is free-form so its swap is refused.
    const autoParent = autoLayoutParent();
    const cardA = attachFrame(autoParent, "Card A");
    const cardB = attachFrame(autoParent, "Card B");
    const freeParent = freeFormParent();
    const cardC = attachFrame(freeParent, "Card C");
    setupCreateFromNode();

    let createdMain: FigmaNode | null = null;
    const innerCreate = mock.createComponentFromNode!.getMockImplementation()!;
    mock.createComponentFromNode = vi.fn((node: FigmaNode) => {
      createdMain = innerCreate(node);
      return createdMain!;
    });
    mock.getNodeByIdAsync.mockImplementation(async (id: string) => {
      if (id === cardA.id) return cardA;
      if (id === cardB.id) return cardB;
      if (id === cardC.id) return cardC;
      if (createdMain && id === createdMain.id) return createdMain;
      return null;
    });

    const result = await applyGroupComponentize({
      question: {
        ruleId: RULE_ID,
        groupMembers: [cardA.id, cardB.id, cardC.id],
      },
      existingComponentNames: new Set(),
      categories: CATEGORIES,
    });

    expect(result.outcome).toBe("componentized-and-swapped");
    expect(result.replaceResults).toHaveLength(2);
    expect(result.replaceResults[0]?.outcome).toBe("replaced");
    expect(result.replaceResults[1]?.outcome).toBe("skipped-free-form-parent");
    expect(result.summary).toBe(
      `componentized "Card A", swapped 1/2 siblings (1 free-form parent)`
    );
  });
});

describe("applyGroupComponentize — missing first member", () => {
  it("returns missing-first-member without calling componentize", async () => {
    mock.getNodeByIdAsync.mockResolvedValue(null);
    const result = await applyGroupComponentize({
      question: { ruleId: RULE_ID, groupMembers: ["ghost-1", "ghost-2"] },
      existingComponentNames: new Set(),
      categories: CATEGORIES,
    });
    expect(result.outcome).toBe("missing-first-member");
    expect(result.componentizeResult).toBeUndefined();
    expect(result.replaceResults).toHaveLength(0);
    expect(result.summary).toContain("ghost-1 not found");
  });
});
