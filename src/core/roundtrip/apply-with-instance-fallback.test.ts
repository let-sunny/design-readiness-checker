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
  autoFix: "cat-auto",
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
  definition = makeNode({ id: "def-1", name: "Definition" });
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

  it("routes to definition and returns 🌐 when writeFn returns false (silent-ignore)", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(undefined);
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({
      icon: "🌐",
      label: "source definition (silent-ignore fallback)",
    });
    expect(writeFn).toHaveBeenCalledTimes(2);
    expect(writeFn.mock.calls[1]?.[0]).toBe(definition);
  });

  it("annotates and returns 📝 when silent-ignore AND definition throws read-only (bug #1 regression)", async () => {
    definition.remote = true;
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("Cannot write to internal and read-only node"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
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

  it("annotates and returns 📝 when silent-ignore AND definition throws a non-read-only error", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("network timeout"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
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

  it("routes to definition and returns 🌐 when scene throws an override error", async () => {
    const writeFn = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("This property cannot be overridden in an instance")
      )
      .mockResolvedValueOnce(undefined);
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {
      categories: CATEGORIES,
    });
    expect(result).toEqual({ icon: "🌐", label: "source definition" });
    expect(writeFn.mock.calls[1]?.[0]).toBe(definition);
  });

  it("annotates and returns 📝 when override-error and definition is read-only (external library)", async () => {
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
    });
    expect(result.icon).toBe("📝");
    expect(result.label).toBe("external library (read-only)");
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toContain("external library");
  });

  it("annotates scene when a non-override error is thrown (unknown failure)", async () => {
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

  it("does not annotate when categories are not provided (but still returns the expected icon)", async () => {
    const writeFn = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("read-only"));
    const result = await applyWithInstanceFallback(QUESTION, writeFn, {});
    expect(result.icon).toBe("📝");
    const annotations = scene.annotations as AnnotationEntry[];
    expect(annotations).toEqual([]);
  });
});
