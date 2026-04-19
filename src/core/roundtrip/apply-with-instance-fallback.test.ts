import { afterEach, beforeEach, vi } from "vitest";
import { applyWithInstanceFallback } from "./apply-with-instance-fallback.js";
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
  RoundtripQuestion,
} from "./types.js";

function makeNode(overrides: Partial<FigmaNode>): FigmaNode {
  return {
    id: "scene-1",
    name: "Scene",
    type: "FRAME",
    annotations: [],
    ...overrides,
  };
}

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

const QUESTION: RoundtripQuestion = {
  nodeId: "scene-1",
  ruleId: "missing-size-constraint",
  sourceChildId: "def-1",
};

let mock: FigmaGlobalMock;
let scene: FigmaNode;
let definition: FigmaNode;

beforeEach(() => {
  scene = makeNode({ id: "scene-1", name: "SceneChild" });
  definition = makeNode({ id: "def-1", name: "Card" });
  mock = createFigmaGlobal({ nodes: { "scene-1": scene, "def-1": definition } });
  installFigmaGlobal(mock);
});

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyWithInstanceFallback", () => {
  it("returns ✅ when the scene write succeeds", async () => {
    const writeFn = vi.fn().mockResolvedValue(undefined);
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({ icon: "✅", label: "instance/scene" });
    expect(writeFn).toHaveBeenCalledTimes(1);
    expect(writeFn).toHaveBeenCalledWith(scene);
  });

  it("routes to definition and returns 🌐 when writeFn returns false (silent-ignore) AND allowDefinitionWrite: true", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined);
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
      allowDefinitionWrite: true,
    });
    expect(result).toEqual({
      icon: "🌐",
      label: "source definition (silent-ignore fallback)",
    });
    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(writeFn.mock.calls[1]?.[0]).toBe(definition);
  });

  it("annotates and returns 📝 when silent-ignore AND definition throws read-only (bug #1 regression) AND allowDefinitionWrite: true", async () => {
    definition.remote = true;
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("Cannot write to internal and read-only node"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
      allowDefinitionWrite: true,
    });
    expect(result).toEqual({
      icon: "📝",
      label: "external library (read-only)",
    });
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.labelMarkdown).toContain("external library");
    expect(annotations[0]?.categoryId).toBe("cat-fallback");
  });

  it("annotates and returns 📝 when silent-ignore AND definition throws a non-read-only error AND allowDefinitionWrite: true", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("network timeout"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
      allowDefinitionWrite: true,
    });
    expect(result.icon).toBe("📝");
    expect(result.label).toContain("definition error");
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toContain(
      "could not apply at source definition"
    );
  });

  it("annotates scene when silent-ignore AND no definition is available", async () => {
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "x",
    };
    const writeFn = vi.fn().mockResolvedValueOnce(false);
    const result = await applyWithInstanceFallback(question, writeFn, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({
      icon: "📝",
      label: "silent-ignore, annotated",
    });
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toContain("no definition available");
  });

  it("routes to definition and returns 🌐 when scene throws an override error AND allowDefinitionWrite: true", async () => {
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("This property cannot be overridden in an instance")
      )
      .mockResolvedValueOnce(undefined);
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
      allowDefinitionWrite: true,
    });
    expect(result).toEqual({ icon: "🌐", label: "source definition" });
    expect(writeFn.mock.calls[1]?.[0]).toBe(definition);
  });

  it("annotates and returns 📝 when override-error and definition is read-only (external library) AND allowDefinitionWrite: true", async () => {
    definition.remote = true;
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("This property cannot be overridden in an instance")
      )
      .mockRejectedValueOnce(
        new Error("Cannot write to internal and read-only node")
      );
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
      allowDefinitionWrite: true,
    });
    expect(result.icon).toBe("📝");
    expect(result.label).toBe("external library (read-only)");
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toContain("external library");
  });

  it("annotates scene when a non-override error is thrown (unknown failure) — not gated by allowDefinitionWrite", async () => {
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("something weird went wrong"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
    });
    expect(result.icon).toBe("📝");
    expect(result.label).toContain("something weird went wrong");
    // Definition write should NOT have happened — only the scene attempt was made.
    expect(writeFn).toHaveBeenCalledTimes(1);
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toContain(
      "could not apply automatically"
    );
  });

  // #309 / ADR-011 Experiment 11: the `mainComponent === null` live case
  // (external library whose source has been unshared at the library end) was
  // NOT reproduced by Experiment 10 — that probe resolved external instances
  // with `mainComponent.remote === true` instead. The helper-level proxy is:
  // when the server-side resolver has no source to name, `question.sourceChildId`
  // is absent → `definition` is null inside the helper, and the override-error
  // branch must route through the null-definition annotation path.
  it("#309: override-error + no sourceChildId (definition === null) annotates with 'could not apply automatically' — not the 'source component' markdown", async () => {
    const question: RoundtripQuestion = {
      nodeId: "scene-1",
      ruleId: "missing-size-constraint",
    };
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("This property cannot be overridden in an instance")
      );
    const result = await applyWithInstanceFallback(question, writeFn, {
      categories: CATEGORIES,
    });
    // Null definition skips the ADR-012 opt-in guard and lands in the
    // annotation-only branch with `error: <msg>` labeling.
    expect(result.icon).toBe("📝");
    expect(result.label).toMatch(/^error: /);
    expect(writeFn).toHaveBeenCalledTimes(1);
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.labelMarkdown).toContain(
      "could not apply automatically"
    );
    // NOT the ADR-012 Q3 markdown — there is no source component to name.
    expect(annotations[0]?.labelMarkdown).not.toContain(
      "Apply this fix on the source component"
    );
  });

  it("returns 📝 missing node when the scene id doesn't resolve", async () => {
    const question: RoundtripQuestion = {
      nodeId: "does-not-exist",
      ruleId: "x",
    };
    const writeFn = vi.fn();
    const result = await applyWithInstanceFallback(question, writeFn, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({ icon: "📝", label: "missing node" });
    expect(writeFn).not.toHaveBeenCalled();
  });

  it("does not annotate when categories are not provided (but still returns the expected icon) AND allowDefinitionWrite: true", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("read-only"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      allowDefinitionWrite: true,
    });
    expect(result.icon).toBe("📝");
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations).toEqual([]);
  });

  // ADR-012: default-off allowDefinitionWrite behavior.
  describe("ADR-012 allowDefinitionWrite: false (default) — skips definition writes", () => {
    it("override-error + flag false → annotates with Q3 phrasing naming the source component", async () => {
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      const result = await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
      });
      expect(result).toEqual({
        icon: "📝",
        label: "definition write skipped (opt-in disabled)",
      });
      // Definition write must NOT have been attempted.
      expect(writeFn).toHaveBeenCalledTimes(1);
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations).toHaveLength(1);
      expect(annotations[0]?.labelMarkdown).toContain("**Card**");
      expect(annotations[0]?.labelMarkdown).toContain(
        "share across all instances"
      );
      expect(annotations[0]?.labelMarkdown).toContain("allowDefinitionWrite");
      expect(annotations[0]?.categoryId).toBe("cat-fallback");
    });

    it("silent-ignore + flag false → annotates without attempting the definition write", async () => {
      const writeFn = vi.fn().mockResolvedValueOnce(false);
      const result = await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
      });
      expect(result).toEqual({
        icon: "📝",
        label: "definition write skipped (opt-in disabled)",
      });
      expect(writeFn).toHaveBeenCalledTimes(1);
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations[0]?.labelMarkdown).toContain("**Card**");
    });

    it("external read-only + flag false → annotates with Q3 phrasing (short-circuits before the read-only branch)", async () => {
      // With the flag off, the helper never calls writeFn on the definition,
      // so the read-only throw never fires — the annotation is Q3 phrasing
      // (source component name), not the read-only-library phrasing.
      definition.remote = true;
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      const result = await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
      });
      expect(result.label).toBe("definition write skipped (opt-in disabled)");
      expect(writeFn).toHaveBeenCalledTimes(1);
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations[0]?.labelMarkdown).toContain("**Card**");
      expect(annotations[0]?.labelMarkdown).not.toContain("external library");
    });

    it("flag false but no categories provided → returns 📝 without annotating", async () => {
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      const result = await applyWithInstanceFallback(QUESTION, writeFn, {});
      expect(result.icon).toBe("📝");
      expect(result.label).toBe("definition write skipped (opt-in disabled)");
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations).toEqual([]);
    });

    it("falls back to question.instanceContext.sourceComponentName when definition.name is empty", async () => {
      definition.name = "";
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      const question: RoundtripQuestion = {
        ...QUESTION,
        instanceContext: { sourceComponentName: "HeroCard" },
      };
      await applyWithInstanceFallback(question, writeFn, {
        categories: CATEGORIES,
      });
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations[0]?.labelMarkdown).toContain("**HeroCard**");
    });

    it("falls back to generic phrasing when no definition.name and no instanceContext", async () => {
      definition.name = "";
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
      });
      const annotations = scene.annotations as AnnotationEntry[];
      expect(annotations[0]?.labelMarkdown).toContain("**the source component**");
    });
  });

  // #310 / ADR-011 Experiment 12: regression-locks two routing invariants
  // that the "definition write propagates to every non-overridden instance"
  // behavior (live-verified in Experiment 10, ADR.md:79) relies on at the
  // helper level — (a) under `allowDefinitionWrite: true`, Tier 2 writes
  // resolve to the SAME shared definition node identity across every
  // instance call (proxy for fan-out), and (b) under the ADR-012 default,
  // an override-bearing scene annotates its own scene independently
  // without touching the definition, so other plain instances in the same
  // batch still proceed cleanly. The mocked `figma.getNodeByIdAsync` does
  // not simulate Plugin API propagation — real fan-out is Experiment 10's
  // live evidence. These tests catch the class of refactor that would
  // silently decouple instance calls (e.g. cloning the definition node
  // per lookup, routing Tier 2 through getNodeByNameAsync).
  describe("#310: Tier 2 propagation + override-precedence routing", () => {
    it("override-error path: Tier 2 routes BOTH instances to the same definition node (proxy for propagation)", async () => {
      const sceneA = makeNode({ id: "scene-a", name: "SceneA" });
      const sceneB = makeNode({ id: "scene-b", name: "SceneB" });
      const sharedDef = makeNode({ id: "def-1", name: "Card" });
      mock = createFigmaGlobal({
        nodes: {
          "scene-a": sceneA,
          "scene-b": sceneB,
          "def-1": sharedDef,
        },
      });
      installFigmaGlobal(mock);

      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        )
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        )
        .mockResolvedValueOnce(undefined);

      for (const nodeId of ["scene-a", "scene-b"]) {
        const result = await applyWithInstanceFallback(
          {
            nodeId,
            ruleId: "missing-size-constraint",
            sourceChildId: "def-1",
          },
          writeFn,
          { categories: CATEGORIES, allowDefinitionWrite: true }
        );
        expect(result).toEqual({ icon: "🌐", label: "source definition" });
      }

      // calls[1] and calls[3] are the definition-tier writes for scene-a
      // and scene-b respectively. Identity equality is the invariant — a
      // cloning-refactor of createFigmaGlobal or a lookup change would
      // fail this assertion clearly.
      expect(writeFn.mock.calls[1]?.[0]).toBe(sharedDef);
      expect(writeFn.mock.calls[3]?.[0]).toBe(sharedDef);
      expect(writeFn.mock.calls[1]?.[0]).toBe(writeFn.mock.calls[3]?.[0]);
      expect(writeFn.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ id: "def-1" })
      );
    });

    it("override-bearing instance annotates its own scene without affecting a plain instance in the same multi-instance batch (flag false)", async () => {
      const sceneOverride = makeNode({
        id: "scene-override",
        name: "OverrideBearing",
      });
      const scenePlain = makeNode({ id: "scene-plain", name: "Plain" });
      const sharedDef = makeNode({ id: "def-1", name: "Card" });
      mock = createFigmaGlobal({
        nodes: {
          "scene-override": sceneOverride,
          "scene-plain": scenePlain,
          "def-1": sharedDef,
        },
      });
      installFigmaGlobal(mock);

      // scene-override's write rejects with the override error (models an
      // instance whose property write is refused by the Plugin API); the
      // subsequent plain-scene write succeeds. If the override-bearing
      // scene ever routed through the definition, the shared def would
      // pick up state that a later Tier 1 on scene-plain could read back —
      // so the isolation is what protects a multi-instance batch.
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        )
        .mockResolvedValueOnce(undefined);

      const resultOverride = await applyWithInstanceFallback(
        {
          nodeId: "scene-override",
          ruleId: "missing-size-constraint",
          sourceChildId: "def-1",
        },
        writeFn,
        { categories: CATEGORIES }
      );
      const resultPlain = await applyWithInstanceFallback(
        {
          nodeId: "scene-plain",
          ruleId: "missing-size-constraint",
          sourceChildId: "def-1",
        },
        writeFn,
        { categories: CATEGORIES }
      );

      expect(resultOverride).toEqual({
        icon: "📝",
        label: "definition write skipped (opt-in disabled)",
      });
      const overrideAnnotations =
        sceneOverride.annotations as AnnotationEntry[];
      expect(overrideAnnotations).toHaveLength(1);
      expect(overrideAnnotations[0]?.labelMarkdown).toContain("**Card**");
      expect(overrideAnnotations[0]?.categoryId).toBe("cat-fallback");

      // Plain scene proceeds normally — no annotation, ✅ result.
      expect(resultPlain).toEqual({ icon: "✅", label: "instance/scene" });
      expect(scenePlain.annotations).toEqual([]);

      // writeFn fired exactly twice (one per scene) — the shared
      // definition was never touched, so no unintended fan-out happened.
      expect(writeFn).toHaveBeenCalledTimes(2);
      expect(sharedDef.annotations).toEqual([]);
    });

    it("silent-ignore opt-in path: definition write fires once per call, resolving to the same definition", async () => {
      const sceneA = makeNode({ id: "scene-a", name: "SceneA" });
      const sceneB = makeNode({ id: "scene-b", name: "SceneB" });
      const sharedDef = makeNode({ id: "def-1", name: "Card" });
      mock = createFigmaGlobal({
        nodes: {
          "scene-a": sceneA,
          "scene-b": sceneB,
          "def-1": sharedDef,
        },
      });
      installFigmaGlobal(mock);

      const writeFn = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(undefined);

      for (const nodeId of ["scene-a", "scene-b"]) {
        const result = await applyWithInstanceFallback(
          {
            nodeId,
            ruleId: "missing-size-constraint",
            sourceChildId: "def-1",
          },
          writeFn,
          { categories: CATEGORIES, allowDefinitionWrite: true }
        );
        expect(result).toEqual({
          icon: "🌐",
          label: "source definition (silent-ignore fallback)",
        });
      }

      // Same identity invariant as the override-error path above, but
      // via the silent-ignore entry (writeFn returning false). Both paths
      // route through routeToDefinitionOrAnnotate — regression-locking
      // both ensures a future refactor of either branch cannot silently
      // fork the definition-resolution lookup.
      expect(writeFn.mock.calls[1]?.[0]).toBe(sharedDef);
      expect(writeFn.mock.calls[3]?.[0]).toBe(sharedDef);
      expect(writeFn.mock.calls[1]?.[0]).toBe(writeFn.mock.calls[3]?.[0]);
      expect(writeFn.mock.calls[1]?.[0]).toEqual(
        expect.objectContaining({ id: "def-1" })
      );
    });
  });

  describe("telemetry callback", () => {
    it("fires with { ruleId, reason: 'override-error' } when override-error skips the definition write", async () => {
      const telemetry = vi.fn();
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(
          new Error("This property cannot be overridden in an instance")
        );
      await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
        telemetry,
      });
      expect(telemetry).toHaveBeenCalledTimes(1);
      expect(telemetry).toHaveBeenCalledWith(
        "cic_roundtrip_definition_write_skipped",
        { ruleId: "missing-size-constraint", reason: "override-error" }
      );
    });

    it("fires with { ruleId, reason: 'silent-ignore' } when silent-ignore skips the definition write", async () => {
      const telemetry = vi.fn();
      const writeFn = vi.fn().mockResolvedValueOnce(false);
      await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
        telemetry,
      });
      expect(telemetry).toHaveBeenCalledWith(
        "cic_roundtrip_definition_write_skipped",
        { ruleId: "missing-size-constraint", reason: "silent-ignore" }
      );
    });

    it("does NOT fire when allowDefinitionWrite: true (definition write is attempted, not skipped)", async () => {
      const telemetry = vi.fn();
      const writeFn = vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(undefined);
      await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
        allowDefinitionWrite: true,
        telemetry,
      });
      expect(telemetry).not.toHaveBeenCalled();
    });

    it("does NOT fire on non-override errors (flag does not gate that branch)", async () => {
      const telemetry = vi.fn();
      const writeFn = vi
        .fn()
        .mockRejectedValueOnce(new Error("network timeout"));
      await applyWithInstanceFallback(QUESTION, writeFn, {
        categories: CATEGORIES,
        telemetry,
      });
      expect(telemetry).not.toHaveBeenCalled();
    });
  });
});
