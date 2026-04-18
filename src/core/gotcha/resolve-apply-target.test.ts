import { resolveGotchaApplyTarget } from "./resolve-apply-target.js";

describe("resolveGotchaApplyTarget", () => {
  it("returns plain scene target without definition for normal node ids", () => {
    const r = resolveGotchaApplyTarget("348:15903", undefined);
    expect(r).toEqual({
      sceneNodeId: "348:15903",
      definitionNodeId: undefined,
      strategy: "scene-only",
      optIn: { preferDefinitionForLayoutProps: false },
      guidance: "",
    });
  });

  it("prefers definition path when instanceContext is present", () => {
    const r = resolveGotchaApplyTarget("I348:15903;2153:7840", {
      parentInstanceNodeId: "348:15903",
      sourceNodeId: "2153:7840",
      sourceComponentId: "C:1",
      sourceComponentName: "Card",
    });
    expect(r.sceneNodeId).toBe("I348:15903;2153:7840");
    expect(r.definitionNodeId).toBe("2153:7840");
    expect(r.strategy).toBe("prefer-definition");
    expect(r.optIn).toEqual({ preferDefinitionForLayoutProps: true });
    expect(r.guidance).toContain("2153:7840");
    expect(r.guidance).toContain("inside component Card");
    expect(r.guidance).toContain("348:15903");
  });

  it("uses generic component label when sourceComponentName is missing", () => {
    const r = resolveGotchaApplyTarget("I1:1;2:2", {
      parentInstanceNodeId: "1:1",
      sourceNodeId: "2:2",
    });
    expect(r.definitionNodeId).toBe("2:2");
    expect(r.strategy).toBe("prefer-definition");
    expect(r.guidance).toContain("inside the source component");
  });

  it("detects instance-child ids even without instanceContext", () => {
    const r = resolveGotchaApplyTarget("I348:15903;2153:7840", undefined);
    expect(r.definitionNodeId).toBeUndefined();
    expect(r.strategy).toBe("definition-unknown");
    expect(r.optIn).toEqual({ preferDefinitionForLayoutProps: true });
    expect(r.guidance).toContain("instanceContext");
  });
});
