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

  it("creates the three labels on first call (uses canicode:flag, not canicode:auto-fix)", async () => {
    const result = await ensureCanicodeCategories();
    expect(Object.keys(result)).toEqual(["gotcha", "flag", "fallback"]);
    expect(mock.annotations.addAnnotationCategoryAsync).toHaveBeenCalledTimes(3);
    expect(mock.annotations.addAnnotationCategoryAsync.mock.calls.map((c) => c[0])).toEqual([
      { label: "canicode:gotcha", color: "blue" },
      { label: "canicode:flag", color: "green" },
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

  it("reuses pre-existing canicode:flag category seeded before the first call", async () => {
    const seeded = createFigmaGlobal({
      categories: [
        { id: "seed-gotcha", label: "canicode:gotcha" },
        { id: "seed-flag", label: "canicode:flag" },
        { id: "seed-fall", label: "canicode:fallback" },
      ],
    });
    installFigmaGlobal(seeded);
    const result = await ensureCanicodeCategories();
    expect(result).toEqual({
      gotcha: "seed-gotcha",
      flag: "seed-flag",
      fallback: "seed-fall",
    });
    expect(seeded.annotations.addAnnotationCategoryAsync).toHaveBeenCalledTimes(0);
  });

  it("exposes legacy canicode:auto-fix id (if present) so Step 5 cleanup can sweep old annotations", async () => {
    const seeded = createFigmaGlobal({
      categories: [{ id: "legacy-auto", label: "canicode:auto-fix" }],
    });
    installFigmaGlobal(seeded);
    const result = await ensureCanicodeCategories();
    expect(result.legacyAutoFix).toBe("legacy-auto");
    // The new code path still creates canicode:flag separately — legacy
    // category is read-only on the canicode side and never written to.
    expect(result.flag).not.toBe("legacy-auto");
    const createdLabels = seeded.annotations.addAnnotationCategoryAsync.mock.calls.map(
      (c) => c[0].label
    );
    expect(createdLabels).toContain("canicode:flag");
    expect(createdLabels).not.toContain("canicode:auto-fix");
  });

  it("omits legacyAutoFix on a fresh file with no pre-rename history", async () => {
    const result = await ensureCanicodeCategories();
    expect("legacyAutoFix" in result).toBe(false);
  });
});

describe("upsertCanicodeAnnotation", () => {
  it("appends a new annotation with trailing ruleId footer (no [canicode] prefix)", () => {
    const node = makeNode({ annotations: [{ labelMarkdown: "other" }] });
    const result = upsertCanicodeAnnotation(node, {
      ruleId: "no-auto-layout",
      markdown: "use VERTICAL",
    });
    expect(result).toBe(true);
    expect(node.annotations).toEqual([
      { labelMarkdown: "other" },
      { labelMarkdown: "use VERTICAL\n\n— *no-auto-layout*" },
    ]);
  });

  it("replaces existing entry for the same ruleId (footer-match on new format)", () => {
    const node = makeNode({
      annotations: [
        { labelMarkdown: "old body\n\n— *no-auto-layout*" },
        { labelMarkdown: "sibling" },
      ],
    });
    upsertCanicodeAnnotation(node, {
      ruleId: "no-auto-layout",
      markdown: "new body",
    });
    expect(node.annotations).toEqual([
      { labelMarkdown: "new body\n\n— *no-auto-layout*" },
      { labelMarkdown: "sibling" },
    ]);
  });

  it("replaces legacy [canicode] prefix entry on rerun (forward-compat for pre-#353 files)", () => {
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
      { labelMarkdown: "new body\n\n— *no-auto-layout*" },
      { labelMarkdown: "sibling" },
    ]);
  });

  it("replaces legacy `label`-only entries (pre-D1) with the new format", () => {
    const node = makeNode({
      annotations: [{ label: "**[canicode] raw-value**\n\nold" }],
    });
    upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "new",
    });
    expect(node.annotations).toEqual([
      { labelMarkdown: "new\n\n— *raw-value*" },
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
        labelMarkdown: "body\n\n— *absolute-position-in-auto-layout*",
        categoryId: "cat-gotcha",
        properties: [{ type: "layoutMode" }],
      },
    ]);
  });

  it("does not re-append the footer if the markdown body already ends with it", () => {
    const node = makeNode();
    upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "embedded\n\n— *raw-value*",
    });
    const written = (node.annotations as AnnotationEntry[])[0]?.labelMarkdown;
    expect(written).toBe("embedded\n\n— *raw-value*");
  });

  it("strips a re-passed legacy [canicode] prefix instead of double-encoding the rule id", () => {
    const node = makeNode();
    upsertCanicodeAnnotation(node, {
      ruleId: "raw-value",
      markdown: "**[canicode] raw-value**\n\nembedded",
    });
    const written = (node.annotations as AnnotationEntry[])[0]?.labelMarkdown;
    expect(written).toBe("embedded\n\n— *raw-value*");
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
    expect(written[0]?.labelMarkdown).toBe("body\n\n— *raw-value*");
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
