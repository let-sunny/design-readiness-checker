import {
  buildIntentionallyUnmappedAnnotationBody,
  parseCanicodeJsonPayloadFromMarkdown,
} from "./annotation-payload.js";

describe("buildIntentionallyUnmappedAnnotationBody (ADR-022)", () => {
  it("produces a body with the rule-opt-out intent in the canicode-json fence", () => {
    const body = buildIntentionallyUnmappedAnnotationBody({
      sceneNodeId: "10:1",
      ruleId: "unmapped-component",
    });
    const payload = parseCanicodeJsonPayloadFromMarkdown(body);
    expect(payload).toBeDefined();
    expect(payload?.ruleId).toBe("unmapped-component");
    expect(payload?.intent).toEqual({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
    });
    expect(payload?.nodeId).toBe("10:1");
  });

  it("does not include a codegenDirective (opt-out is a don't-emit signal, not a value override)", () => {
    const body = buildIntentionallyUnmappedAnnotationBody({
      sceneNodeId: "10:1",
      ruleId: "unmapped-component",
    });
    const payload = parseCanicodeJsonPayloadFromMarkdown(body);
    expect(payload?.codegenDirective).toBeUndefined();
  });

  it("ends with the canicode footer so extractAcknowledgmentsFromNode recognises the rule id", () => {
    const body = buildIntentionallyUnmappedAnnotationBody({
      sceneNodeId: "10:1",
      ruleId: "unmapped-component",
    });
    expect(body.trimEnd()).toMatch(/— \*unmapped-component\*$/);
  });

  it("includes a sceneWriteOutcome marker so the JSON block remains schema-valid", () => {
    const body = buildIntentionallyUnmappedAnnotationBody({
      sceneNodeId: "10:1",
      ruleId: "unmapped-component",
    });
    const payload = parseCanicodeJsonPayloadFromMarkdown(body);
    expect(payload?.sceneWriteOutcome.result).toBe("succeeded");
  });
});
