import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyUnmappedComponentOptOut } from "./apply-unmapped-component-opt-out.js";
import { parseCanicodeJsonPayloadFromMarkdown } from "./annotation-payload.js";
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
} from "./types.js";

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

let mock: FigmaGlobalMock;

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyUnmappedComponentOptOut (ADR-022)", () => {
  let scene: FigmaNode;

  beforeEach(() => {
    scene = {
      id: "10:1",
      name: "Button",
      type: "COMPONENT",
      annotations: [],
    };
    mock = createFigmaGlobal({ nodes: { "10:1": scene } });
    installFigmaGlobal(mock);
  });

  it("writes the opt-out annotation under categories.gotcha with a rule-opt-out fence", async () => {
    const result = await applyUnmappedComponentOptOut(
      { nodeId: "10:1", ruleId: "unmapped-component" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("📝");
    expect(result.label).toMatch(/opt-out annotation written/);

    const annotations = scene.annotations as readonly AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.categoryId).toBe(CATEGORIES.gotcha);

    const body = annotations[0]?.labelMarkdown ?? "";
    const payload = parseCanicodeJsonPayloadFromMarkdown(body);
    expect(payload?.ruleId).toBe("unmapped-component");
    expect(payload?.intent).toEqual({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
    });
    expect(body).toMatch(/— \*unmapped-component\*$/);
  });

  it("re-applies idempotently — repeat call replaces the existing entry in place", async () => {
    await applyUnmappedComponentOptOut(
      { nodeId: "10:1", ruleId: "unmapped-component" },
      { categories: CATEGORIES }
    );
    await applyUnmappedComponentOptOut(
      { nodeId: "10:1", ruleId: "unmapped-component" },
      { categories: CATEGORIES }
    );
    const annotations = scene.annotations as readonly AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    const payload = parseCanicodeJsonPayloadFromMarkdown(
      annotations[0]?.labelMarkdown ?? ""
    );
    expect(payload?.intent).toEqual({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
    });
  });

  it("returns a missing-node outcome without throwing when the scene node is gone", async () => {
    mock = createFigmaGlobal({ nodes: {} });
    installFigmaGlobal(mock);
    const result = await applyUnmappedComponentOptOut(
      { nodeId: "stale-id", ruleId: "unmapped-component" },
      { categories: CATEGORIES }
    );
    expect(result.icon).toBe("📝");
    expect(result.label).toMatch(/missing node/);
  });
});
