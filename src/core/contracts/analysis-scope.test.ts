import { describe, it, expect } from "vitest";
import type { AnalysisNode } from "./figma-node.js";
import {
  AnalysisScopeSchema,
  detectAnalysisScope,
} from "./analysis-scope.js";

function makeRoot(type: string, overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "0:1",
    name: `root-${type}`,
    type: type as AnalysisNode["type"],
    visible: true,
    ...overrides,
  };
}

describe("AnalysisScopeSchema", () => {
  it("accepts `page` and `component`", () => {
    expect(AnalysisScopeSchema.parse("page")).toBe("page");
    expect(AnalysisScopeSchema.parse("component")).toBe("component");
  });

  it("rejects other values — keeps surface area explicit per #404", () => {
    expect(AnalysisScopeSchema.safeParse("section").success).toBe(false);
    expect(AnalysisScopeSchema.safeParse("auto").success).toBe(false);
    expect(AnalysisScopeSchema.safeParse("").success).toBe(false);
  });
});

describe("detectAnalysisScope", () => {
  it.each([
    ["COMPONENT", "component"],
    ["COMPONENT_SET", "component"],
    ["INSTANCE", "component"],
  ] as const)("%s root → %s scope", (type, expected) => {
    expect(detectAnalysisScope(makeRoot(type))).toBe(expected);
  });

  it.each([
    ["FRAME", "page"],
    ["SECTION", "page"],
    ["CANVAS", "page"],
    ["DOCUMENT", "page"],
    ["GROUP", "page"],
    ["TEXT", "page"],
    ["VECTOR", "page"],
    ["RECTANGLE", "page"],
  ] as const)("%s root → %s scope (default)", (type, expected) => {
    expect(detectAnalysisScope(makeRoot(type))).toBe(expected);
  });

  it("ignores children when deciding scope — only the root node type matters", () => {
    const componentChild = makeRoot("COMPONENT", { id: "0:2", name: "Child" });
    const frameRoot: AnalysisNode = {
      ...makeRoot("FRAME"),
      children: [componentChild],
    };
    // A page that happens to contain a component is still page scope —
    // the component-scope branch is reserved for runs where the user
    // explicitly targets a component via node-id.
    expect(detectAnalysisScope(frameRoot)).toBe("page");
  });
});
