import { afterEach, beforeEach } from "vitest";
import {
  stripAnnotations,
  ensureCanicodeCategories,
  upsertCanicodeAnnotation,
} from "./annotations.js";
import {
  createFigmaGlobal,
  installFigmaGlobal,
  uninstallFigmaGlobal,
  type FigmaGlobalMock,
} from "./test-utils.js";
import type { AnnotationEntry, FigmaNode } from "./types.js";

function makeNode(overrides: Partial<FigmaNode> = {}): FigmaNode {
  return {
    id: "1:1",
    name: "Node",
    type: "FRAME",
    annotations: [],
    ...overrides,
  };
}

describe("stripAnnotations", () => {
  it("drops entries missing both label fields", () => {
    const result = stripAnnotations([
      { label: "" },
      { labelMarkdown: "" },
      {},
      { label: "keep" },
    ]);
    expect(result).toEqual([{ label: "keep" }]);
  });

  it("prefers labelMarkdown when both are present", () => {
    const result = stripAnnotations([
      { label: "plain", labelMarkdown: "**rich**" },
    ]);
    expect(result).toEqual([{ labelMarkdown: "**rich**" }]);
  });

  it("falls back to label when labelMarkdown is empty", () => {
    const result = stripAnnotations([{ label: "plain", labelMarkdown: "" }]);
    expect(result).toEqual([{ label: "plain" }]);
  });

  it("preserves categoryId and properties when present", () => {
    const result = stripAnnotations([
      {
        labelMarkdown: "x",
        categoryId: "c1",
        properties: [{ type: "width" }],
      },
    ]);
    expect(result).toEqual([
      {
        labelMarkdown: "x",
        categoryId: "c1",
        properties: [{ type: "width" }],
      },
    ]);
  });

  it("drops empty properties arrays", () => {
    const result = stripAnnotations([
      { labelMarkdown: "x", properties: [] },
    ]);
    expect(result).toEqual([{ labelMarkdown: "x" }]);
  });

  it("returns [] for null/undefined input", () => {
    expect(stripAnnotations(null)).toEqual([]);
    expect(stripAnnotations(undefined)).toEqual([]);
  });
});

describe("ensureCanicodeCategories", () => {
  let mock: FigmaGlobalMock;

  beforeEach(() => {
    mock = createFigmaGlobal();
    installFigmaGlobal(mock);
  });

  afterEach(() => {
    uninstallFigmaGlobal();
  });

  it("creates the three labels on first call", async () => {
    const result = await ensureCanicodeCategories();
    expect(Object.keys(result)).toEqual(["gotcha", "autoFix", "fallback"]);
    expect(mock.annotations.addAnnotationCategoryAsync).toHaveBeenCalledTimes(3);
    expect(mock.annotations.addAnnotationCategoryAsync.mock.calls.map((c) => c[0])).toEqual([
      { label: "canicode:gotcha", color: "blue" },
      { label: "canicode:auto-fix", color: "green" },
      { label: "canicode:fallback", color: "yellow" },
    ]);
  });

  it("reuses existing ids on second call (idempotent)", async () => {
    const first = await ensureCanicodeCategories();
    mock.annotations.addAnnotationCategoryAsync.mockClear();
    const second = await ensureCanicodeCategories();
    expect(second).toEqual(first);
    expect(mock.annotations.addAnnotationCategoryAsync).toHaveBeenCalledTimes(0);
  });

  it("reuses pre-existing categories seeded before the first call", async () => {
    const seeded = createFigmaGlobal({
      categories: [
        { id: "seed-gotcha", label: "canicode:gotcha" },
        { id: "seed-auto", label: "canicode:auto-fix" },
        { id: "seed-fall", label: "canicode:fallback" },
      ],
    });
    installFigmaGlobal(seeded);
    const result = await ensureCanicodeCategories();
    expect(result).toEqual({
      gotcha: "seed-gotcha",
      autoFix: "seed-auto",
      fallback: "seed-fall",
    });
    expect(seeded.annotations.addAnnotationCategoryAsync).toHaveBeenCalledTimes(0);
  });
});

describe("upsertCanicodeAnnotation", () => {
  it("appends a new annotation when no matching ruleId exists", () => {
    const node = makeNode({ annotations: [{ labelMarkdown: "other" }] });
    const result = upsertCanicodeAnnotation(node, {
      ruleId: "no-auto-layout",
      markdown: "use VERTICAL",
    });
    expect(result).toBe(true);
    expect(node.annotations).toEqual([
      { labelMarkdown: "other" },
      { labelMarkdown: "**[canicode] no-auto-layout**\n\nuse VERTICAL" },
    ]);
  });

  it("replaces existing canicode entry for the same ruleId (labelMarkdown match)", () => {
    const node = makeNode({
      annotations: [
        { labelMarkdown: "**[canicode] no-auto-layout**\n\nold body" },
        { labelMarkdown: "sibling" },
      ],
    });
    upsertCanicodeAnnotation(node, {
      ruleId: "no-auto-layout",
      markdown: "new body",
    });
    expect(node.annotations).toEqual([
      { labelMarkdown: "**[canicode] no-auto-layout**\n\nnew body" },
      { labelMarkdown: "sibling" },
    ]);
  });

  it("replaces legacy `label`-only entries (pre-D1) with the canicode prefix", () => {
    const node = makeNode({
      annotations: [{ label: "**[canicode] raw-value**\n\nold" }],
    });
    upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "new",
    });
    expect(node.annotations).toEqual([
      { labelMarkdown: "**[canicode] raw-value**\n\nnew" },
    ]);
  });

  it("includes categoryId and properties when provided", () => {
    const node = makeNode();
    upsertCanicodeAnnotation(node, {
      ruleId: "absolute-position-in-auto-layout",
      markdown: "body",
      categoryId: "cat-gotcha",
      properties: [{ type: "layoutMode" }],
    });
    expect(node.annotations).toEqual([
      {
        labelMarkdown:
          "**[canicode] absolute-position-in-auto-layout**\n\nbody",
        categoryId: "cat-gotcha",
        properties: [{ type: "layoutMode" }],
      },
    ]);
  });

  it("does not re-prefix a markdown body that already starts with the canicode prefix", () => {
    const node = makeNode();
    upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "**[canicode] raw-value**\n\nembedded",
    });
    const written = (node.annotations as AnnotationEntry[])[0]?.labelMarkdown;
    expect(written).toBe("**[canicode] raw-value**\n\nembedded");
  });

  it("retries without properties on Experiment 09 node-type rejection", () => {
    let firstWrite = true;
    const node = {
      id: "2:2",
      name: "Text",
      type: "TEXT",
      annotations: [] as readonly AnnotationEntry[],
    } as FigmaNode;
    Object.defineProperty(node, "annotations", {
      get: () => (node as { _annotations?: AnnotationEntry[] })._annotations ?? [],
      set(next: AnnotationEntry[]) {
        if (firstWrite && next.some((a) => a.properties)) {
          firstWrite = false;
          throw new Error("Invalid property fills for a TEXT node");
        }
        (node as { _annotations?: AnnotationEntry[] })._annotations = next;
      },
    });
    const result = upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "body",
      properties: [{ type: "fills" }],
    });
    expect(result).toBe(true);
    const written = (node as { _annotations: AnnotationEntry[] })._annotations;
    expect(written[0]?.properties).toBeUndefined();
    expect(written[0]?.labelMarkdown).toBe("**[canicode] raw-value**\n\nbody");
  });

  it("re-throws unrelated errors (permission, read-only) rather than swallowing", () => {
    const node = {
      id: "3:3",
      name: "Locked",
      type: "FRAME",
    } as FigmaNode;
    Object.defineProperty(node, "annotations", {
      get: () => [],
      set() {
        throw new Error("Cannot write to internal and read-only node");
      },
    });
    expect(() =>
      upsertCanicodeAnnotation(node, {
        ruleId: "x",
        markdown: "y",
        properties: [{ type: "width" }],
      })
    ).toThrow(/read-only/);
  });

  it("returns false for nodes without an annotations capability", () => {
    const node = { id: "4:4", name: "Line", type: "LINE" } as FigmaNode;
    const result = upsertCanicodeAnnotation(node, {
      ruleId: "x",
      markdown: "y",
    });
    expect(result).toBe(false);
  });

  it("returns false for null/undefined node", () => {
    expect(
      upsertCanicodeAnnotation(null, { ruleId: "x", markdown: "y" })
    ).toBe(false);
    expect(
      upsertCanicodeAnnotation(undefined, { ruleId: "x", markdown: "y" })
    ).toBe(false);
  });
});
