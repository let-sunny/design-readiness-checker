import { afterEach, beforeEach, vi } from "vitest";
import {
  applyPropertyMod,
  resolveVariableByName,
} from "./apply-property-mod.js";
import {
  createFigmaGlobal,
  installFigmaGlobal,
  uninstallFigmaGlobal,
  type FigmaGlobalMock,
} from "./test-utils.js";
import type {
  AnnotationEntry,
  CanicodeCategories,
  FigmaNode,
  FigmaPaint,
  RoundtripQuestion,
} from "./types.js";

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

function makePaint(colorName: string): FigmaPaint {
  return {
    type: "SOLID",
    color: { r: 0, g: 0, b: 0, name: colorName },
  };
}

let mock: FigmaGlobalMock;

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("resolveVariableByName", () => {
  it("returns the variable on exact-name match", async () => {
    mock = createFigmaGlobal({
      variables: [
        { id: "v1", name: "mobile-width" },
        { id: "v2", name: "tablet-width" },
      ],
    });
    installFigmaGlobal(mock);
    const result = await resolveVariableByName("tablet-width");
    expect(result).toEqual({ id: "v2", name: "tablet-width" });
  });

  it("matches slash-path names literally", async () => {
    mock = createFigmaGlobal({
      variables: [{ id: "v1", name: "Brand/Primary" }],
    });
    installFigmaGlobal(mock);
    const result = await resolveVariableByName("Brand/Primary");
    expect(result?.id).toBe("v1");
  });

  it("returns null for variables not in the local scope", async () => {
    mock = createFigmaGlobal({ variables: [] });
    installFigmaGlobal(mock);
    const result = await resolveVariableByName("unimported-remote");
    expect(result).toBeNull();
  });
});

describe("applyPropertyMod", () => {
  let scene: FigmaNode;

  function setupScene(overrides: Partial<FigmaNode> = {}) {
    scene = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
      ...overrides,
    };
    return scene;
  }

  beforeEach(() => {
    setupScene({ itemSpacing: 8 });
    mock = createFigmaGlobal({
      nodes: { "scene-1": scene },
      variables: [{ id: "v-gap", name: "space-m" }],
    });
    installFigmaGlobal(mock);
  });

  it("applies a scalar answer to the target property and returns ✅", async () => {
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "irregular-spacing",
      targetProperty: "itemSpacing",
    };
    const result = await applyPropertyMod(question, 16, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({ icon: "✅", label: "instance/scene" });
    expect((scene as Record<string, unknown>).itemSpacing).toBe(16);
  });

  it("detects silent-ignore when target[prop] doesn't change and routes to definition (allowDefinitionWrite: true)", async () => {
    const definition: FigmaNode = {
      id: "def-1",
      name: "Def",
      type: "FRAME",
      layoutMode: "NONE",
      itemSpacing: 0,
      annotations: [],
    };
    const sceneWithFrozenProp: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
    };
    Object.defineProperty(sceneWithFrozenProp, "layoutMode", {
      get: () => "NONE",
      set: () => {
        // Silent-ignore — read-back returns the original value.
      },
    });
    mock = createFigmaGlobal({
      nodes: { "scene-1": sceneWithFrozenProp, "def-1": definition },
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "no-auto-layout",
      targetProperty: ["layoutMode", "itemSpacing"],
      sourceChildId: "def-1",
    };
    const result = await applyPropertyMod(
      question,
      { layoutMode: "VERTICAL", itemSpacing: 16 },
      { categories: CATEGORIES, allowDefinitionWrite: true }
    );
    expect(result).toEqual({
      icon: "🌐",
      label: "source definition (silent-ignore fallback)",
    });
    expect((definition as Record<string, unknown>).layoutMode).toBe("VERTICAL");
    expect((definition as Record<string, unknown>).itemSpacing).toBe(16);
  });

  it("ADR-012: silent-ignore + allowDefinitionWrite: false → annotates scene without writing definition", async () => {
    const definition: FigmaNode = {
      id: "def-1",
      name: "Card",
      type: "FRAME",
      layoutMode: "NONE",
      itemSpacing: 0,
      annotations: [],
    };
    const sceneWithFrozenProp: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
    };
    Object.defineProperty(sceneWithFrozenProp, "layoutMode", {
      get: () => "NONE",
      set: () => {
        // Silent-ignore.
      },
    });
    mock = createFigmaGlobal({
      nodes: { "scene-1": sceneWithFrozenProp, "def-1": definition },
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "no-auto-layout",
      targetProperty: ["layoutMode", "itemSpacing"],
      sourceChildId: "def-1",
    };
    const result = await applyPropertyMod(
      question,
      { layoutMode: "VERTICAL", itemSpacing: 16 },
      { categories: CATEGORIES }
    );
    expect(result).toEqual({
      icon: "📝",
      label: "definition write skipped (opt-in disabled)",
    });
    // Definition must NOT have been mutated — the skip short-circuits before
    // routing to the definition tier.
    expect((definition as Record<string, unknown>).layoutMode).toBe("NONE");
    expect((definition as Record<string, unknown>).itemSpacing).toBe(0);
    const annotations = (sceneWithFrozenProp.annotations ??
      []) as AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.labelMarkdown).toContain("**Card**");
  });

  it("ADR-012: allowDefinitionWrite flows from applyPropertyMod through to the inner helper (telemetry fires)", async () => {
    const definition: FigmaNode = {
      id: "def-1",
      name: "Card",
      type: "FRAME",
      layoutMode: "NONE",
      itemSpacing: 0,
      annotations: [],
    };
    const sceneWithFrozenProp: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
    };
    Object.defineProperty(sceneWithFrozenProp, "layoutMode", {
      get: () => "NONE",
      set: () => {
        // Silent-ignore.
      },
    });
    mock = createFigmaGlobal({
      nodes: { "scene-1": sceneWithFrozenProp, "def-1": definition },
    });
    installFigmaGlobal(mock);
    const telemetry = vi.fn();
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "no-auto-layout",
      targetProperty: ["layoutMode", "itemSpacing"],
      sourceChildId: "def-1",
    };
    await applyPropertyMod(
      question,
      { layoutMode: "VERTICAL", itemSpacing: 16 },
      { categories: CATEGORIES, telemetry }
    );
    expect(telemetry).toHaveBeenCalledWith(
      "cic_roundtrip_definition_write_skipped",
      { ruleId: "no-auto-layout", reason: "silent-ignore" }
    );
  });

  // #309 / ADR-011 Experiment 08: variable binding is the first-choice write
  // path — it bypasses the instance-child override gate that raw-value writes
  // hit. The live Plugin-API message sample comes from Experiment 08/10; the
  // mock below uses a synthetic throw with the matching phrase, so the
  // regression lock is on the helper's internal routing, not on real-world
  // message text.
  it("#309: variable-binding path runs before raw write — binds successfully even when the raw setter would throw the override error", async () => {
    const setBoundVariable = vi.fn();
    const rawSetter = vi.fn(() => {
      throw new Error("This property cannot be overridden in an instance");
    });
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
    };
    Object.defineProperty(target, "minWidth", {
      get: () => 0,
      set: rawSetter,
      configurable: true,
      enumerable: true,
    });
    (target as unknown as { setBoundVariable: typeof setBoundVariable }).setBoundVariable =
      setBoundVariable;
    mock = createFigmaGlobal({
      nodes: { "scene-1": target },
      variables: [{ id: "v-mobile", name: "mobile-width" }],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "missing-size-constraint",
      targetProperty: "minWidth",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "mobile-width" },
      { categories: CATEGORIES }
    );
    expect(result).toEqual({ icon: "✅", label: "instance/scene" });
    expect(setBoundVariable).toHaveBeenCalledWith("minWidth", {
      id: "v-mobile",
      name: "mobile-width",
    });
    // Lock the ordering invariant: the raw setter must never run when the
    // answer names a variable that resolves — otherwise a future refactor
    // could silently swallow the throw and still yield ✅.
    expect(rawSetter).not.toHaveBeenCalled();
  });

  it("binds a variable via target.setBoundVariable for non-paint props", async () => {
    const setBoundVariable = vi.fn();
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      itemSpacing: 0,
      annotations: [],
    };
    (target as unknown as { setBoundVariable: typeof setBoundVariable }).setBoundVariable =
      setBoundVariable;
    mock = createFigmaGlobal({
      nodes: { "scene-1": target },
      variables: [{ id: "v-gap", name: "space-m" }],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "irregular-spacing",
      targetProperty: "itemSpacing",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "space-m" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect(setBoundVariable).toHaveBeenCalledWith("itemSpacing", {
      id: "v-gap",
      name: "space-m",
    });
    expect(mock.variables.setBoundVariableForPaint).not.toHaveBeenCalled();
  });

  it("bug #2 regression: binds fills via figma.variables.setBoundVariableForPaint AND reassigns target.fills", async () => {
    const initialFills: FigmaPaint[] = [makePaint("base"), makePaint("stroke")];
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "RECTANGLE",
      fills: initialFills,
      annotations: [],
    };
    // Guard: target.setBoundVariable must NOT be called for fills — the bug
    // was calling it directly instead of the Paint-specific API.
    const setBoundVariable = vi.fn();
    (target as unknown as { setBoundVariable: typeof setBoundVariable }).setBoundVariable =
      setBoundVariable;
    mock = createFigmaGlobal({
      nodes: { "scene-1": target },
      variables: [{ id: "v-brand", name: "Brand/Primary" }],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "raw-value",
      targetProperty: "fills",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "Brand/Primary" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect(setBoundVariable).not.toHaveBeenCalled();
    expect(mock.variables.setBoundVariableForPaint).toHaveBeenCalledTimes(
      initialFills.length
    );
    // Reassignment — target.fills is a NEW array (not the same reference).
    const newFills = (target as Record<string, unknown>).fills as FigmaPaint[];
    expect(newFills).not.toBe(initialFills);
    expect(newFills).toHaveLength(2);
    expect(newFills[0]?.boundVariables).toEqual({
      color: { type: "VARIABLE_ALIAS", id: "v-brand" },
    });
  });

  it("skips cleanly when fills is the mixed symbol (no crash, no setBoundVariableForPaint call)", async () => {
    const mixed = Symbol("figma.mixed");
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      fills: mixed,
      annotations: [],
    };
    mock = createFigmaGlobal({
      mixed,
      nodes: { "scene-1": target },
      variables: [{ id: "v-brand", name: "Brand/Primary" }],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "raw-value",
      targetProperty: "fills",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "Brand/Primary" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect(mock.variables.setBoundVariableForPaint).not.toHaveBeenCalled();
    // The mixed fills get overwritten with nothing — no throw, no side effect.
  });

  it("variable-not-found with a fallback scalar falls through to raw write", async () => {
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      itemSpacing: 0,
      annotations: [],
    };
    mock = createFigmaGlobal({
      nodes: { "scene-1": target },
      variables: [],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "irregular-spacing",
      targetProperty: "itemSpacing",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "missing", fallback: 24 },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect((target as Record<string, unknown>).itemSpacing).toBe(24);
  });

  it("variable-not-found without a fallback records no change (no crash, no binding)", async () => {
    const setBoundVariable = vi.fn();
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      itemSpacing: 0,
      annotations: [],
    };
    (target as unknown as { setBoundVariable: typeof setBoundVariable }).setBoundVariable =
      setBoundVariable;
    mock = createFigmaGlobal({
      nodes: { "scene-1": target },
      variables: [],
    });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "irregular-spacing",
      targetProperty: "itemSpacing",
    };
    const result = await applyPropertyMod(
      question,
      { variable: "missing" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect(setBoundVariable).not.toHaveBeenCalled();
    expect((target as Record<string, unknown>).itemSpacing).toBe(0);
  });

  it("multi-prop answer object dispatches per-key across multiple targetProperty entries", async () => {
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      layoutMode: "NONE",
      itemSpacing: 0,
      annotations: [],
    };
    mock = createFigmaGlobal({ nodes: { "scene-1": target } });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "no-auto-layout",
      targetProperty: ["layoutMode", "itemSpacing"],
    };
    const result = await applyPropertyMod(
      question,
      { layoutMode: "VERTICAL", itemSpacing: 16 },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("✅");
    expect((target as Record<string, unknown>).layoutMode).toBe("VERTICAL");
    expect((target as Record<string, unknown>).itemSpacing).toBe(16);
  });

  it("annotates and routes to fallback when all properties are missing on the target", async () => {
    const target: FigmaNode = {
      id: "scene-1",
      name: "Scene",
      type: "FRAME",
      annotations: [],
    };
    mock = createFigmaGlobal({ nodes: { "scene-1": target } });
    installFigmaGlobal(mock);
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "missing-size-constraint",
      targetProperty: "minWidth",
    };
    const result = await applyPropertyMod(question, 320, {
      categories: CATEGORIES,
    });
    // writeFn returned undefined (no props matched) — treated as success.
    expect(result.icon).toBe("✅");
    const annotations = target.annotations as AnnotationEntry[];
    expect(annotations).toEqual([]);
  });
});
