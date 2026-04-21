import { describe, expect, it } from "vitest";
import {
  extractAcknowledgmentsFromNode,
  readCanicodeAcknowledgments,
} from "./read-acknowledgments.js";
import type {
  AnnotationEntry,
  CanicodeCategories,
  FigmaNode,
} from "./types.js";

function makeNode(
  id: string,
  annotations: AnnotationEntry[],
  children?: FigmaNode[]
): FigmaNode {
  const node: FigmaNode = {
    id,
    name: id,
    type: "FRAME",
    annotations,
  };
  if (children) (node as { children?: FigmaNode[] }).children = children;
  return node;
}

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

describe("extractAcknowledgmentsFromNode", () => {
  it("returns empty for null / undefined / non-annotated nodes", () => {
    expect(extractAcknowledgmentsFromNode(null)).toEqual([]);
    expect(extractAcknowledgmentsFromNode(undefined)).toEqual([]);
    const noAnnotations = { id: "1:1", name: "x", type: "FRAME" } as FigmaNode;
    expect(extractAcknowledgmentsFromNode(noAnnotations)).toEqual([]);
  });

  it("matches the post-#353 footer `— *<ruleId>*`", () => {
    const node = makeNode("1:1", [
      {
        labelMarkdown: "**Q:** something\n**A:** answer\n\n— *missing-size-constraint*",
        categoryId: "cat-gotcha",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(node, new Set([CATEGORIES.gotcha]))
    ).toEqual([{ nodeId: "1:1", ruleId: "missing-size-constraint" }]);
  });

  it("matches the legacy `**[canicode] <ruleId>**` prefix", () => {
    const node = makeNode("2:2", [
      {
        labelMarkdown: "**[canicode] raw-value** body without footer",
        categoryId: "cat-flag",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(node, new Set([CATEGORIES.flag]))
    ).toEqual([{ nodeId: "2:2", ruleId: "raw-value" }]);
  });

  it("requires the categoryId to be a canicode one when categoryIds are provided (false-positive guard)", () => {
    const node = makeNode("3:3", [
      // Looks like our footer, but the user wrote it themselves on a
      // non-canicode category — must NOT be treated as an acknowledgment.
      {
        labelMarkdown: "Some user note ending — *missing-size-constraint*",
        categoryId: "user-category",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(
        node,
        new Set([CATEGORIES.gotcha, CATEGORIES.flag, CATEGORIES.fallback])
      )
    ).toEqual([]);
  });

  it("matches by footer alone when categoryIds are omitted (test-mode fallback)", () => {
    const node = makeNode("4:4", [
      {
        labelMarkdown: "Note — *raw-value*",
      },
    ]);
    expect(extractAcknowledgmentsFromNode(node)).toEqual([
      { nodeId: "4:4", ruleId: "raw-value" },
    ]);
  });

  it("returns one acknowledgment per recognised entry on the same node", () => {
    const node = makeNode("5:5", [
      {
        labelMarkdown: "First — *missing-size-constraint*",
        categoryId: "cat-gotcha",
      },
      {
        labelMarkdown: "Second — *non-semantic-name*",
        categoryId: "cat-flag",
      },
      {
        labelMarkdown: "Unrelated user note",
        categoryId: "cat-gotcha",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(
        node,
        new Set([CATEGORIES.gotcha, CATEGORIES.flag])
      )
    ).toEqual([
      { nodeId: "5:5", ruleId: "missing-size-constraint" },
      { nodeId: "5:5", ruleId: "non-semantic-name" },
    ]);
  });

  it("ignores mid-body asterisk pairs — only end-anchored footers count", () => {
    const node = makeNode("6:6", [
      {
        labelMarkdown:
          "Body mentions *not-a-rule* in the middle and ends — *raw-value*",
        categoryId: "cat-flag",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(node, new Set([CATEGORIES.flag]))
    ).toEqual([{ nodeId: "6:6", ruleId: "raw-value" }]);
  });

  it("falls back to `label` when `labelMarkdown` is empty", () => {
    const node = makeNode("7:7", [
      {
        label: "Plain note — *irregular-spacing*",
        categoryId: "cat-gotcha",
      },
    ]);
    expect(
      extractAcknowledgmentsFromNode(node, new Set([CATEGORIES.gotcha]))
    ).toEqual([{ nodeId: "7:7", ruleId: "irregular-spacing" }]);
  });
});

describe("readCanicodeAcknowledgments", () => {
  it("walks the subtree via figma.getNodeByIdAsync and accumulates per-node matches", async () => {
    const grandchild = makeNode("3:3", [
      { labelMarkdown: "deep — *non-semantic-name*", categoryId: "cat-flag" },
    ]);
    const child1 = makeNode(
      "2:1",
      [
        {
          labelMarkdown: "**Q:** … **A:** …\n\n— *missing-size-constraint*",
          categoryId: "cat-gotcha",
        },
      ],
      [grandchild]
    );
    const child2 = makeNode("2:2", [
      // Non-canicode annotation — must not register.
      { labelMarkdown: "user note ending — *raw-value*", categoryId: "user-category" },
    ]);
    const root = makeNode("1:1", [], [child1, child2]);

    const figma = {
      getNodeByIdAsync: async (id: string) => (id === "1:1" ? root : null),
    };
    (globalThis as { figma?: unknown }).figma = figma;

    const acks = await readCanicodeAcknowledgments("1:1", CATEGORIES);

    expect(acks).toEqual([
      { nodeId: "2:1", ruleId: "missing-size-constraint" },
      { nodeId: "3:3", ruleId: "non-semantic-name" },
    ]);
  });

  it("returns an empty array when the root node cannot be resolved", async () => {
    const figma = {
      getNodeByIdAsync: async () => null,
    };
    (globalThis as { figma?: unknown }).figma = figma;

    expect(await readCanicodeAcknowledgments("missing:1", CATEGORIES)).toEqual(
      []
    );
  });

  it("skips children of nodes whose `children` getter throws (TEXT/VECTOR leaves, #421)", async () => {
    const throwingChild = makeNode("4:4", []);
    Object.defineProperty(throwingChild, "children", {
      get: () => {
        throw new Error("cannot access children of TEXT node");
      },
    });
    const goodSibling = makeNode("5:5", [
      { labelMarkdown: "ok — *raw-value*", categoryId: "cat-gotcha" },
    ]);
    const root = makeNode("1:1", [], [throwingChild, goodSibling]);

    const figma = {
      getNodeByIdAsync: async () => root,
    };
    (globalThis as { figma?: unknown }).figma = figma;

    const acks = await readCanicodeAcknowledgments("1:1", CATEGORIES);
    expect(acks).toEqual([{ nodeId: "5:5", ruleId: "raw-value" }]);
  });

  it("swallows per-node read errors so the rest of the sweep proceeds", async () => {
    const noisyChild = makeNode("4:4", []);
    Object.defineProperty(noisyChild, "annotations", {
      get: () => {
        throw new Error("locked node");
      },
    });
    const goodChild = makeNode("5:5", [
      { labelMarkdown: "ok — *raw-value*", categoryId: "cat-gotcha" },
    ]);
    const root = makeNode("1:1", [], [noisyChild, goodChild]);

    const figma = {
      getNodeByIdAsync: async () => root,
    };
    (globalThis as { figma?: unknown }).figma = figma;

    const acks = await readCanicodeAcknowledgments("1:1", CATEGORIES);
    expect(acks).toEqual([{ nodeId: "5:5", ruleId: "raw-value" }]);
  });
});
