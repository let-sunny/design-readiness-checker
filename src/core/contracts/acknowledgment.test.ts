import {
  AcknowledgmentIntentSchema,
  AcknowledgmentSchema,
  isPropertyIntent,
  isRuleOptOutIntent,
} from "./acknowledgment.js";

describe("AcknowledgmentIntentSchema (ADR-019 + ADR-022)", () => {
  it("parses legacy property intents without an explicit `kind` and defaults to kind=property", () => {
    const parsed = AcknowledgmentIntentSchema.parse({
      field: "layoutSizingHorizontal",
      value: "FILL",
      scope: "instance",
    });
    expect(parsed).toEqual({
      kind: "property",
      field: "layoutSizingHorizontal",
      value: "FILL",
      scope: "instance",
    });
    expect(isPropertyIntent(parsed)).toBe(true);
    expect(isRuleOptOutIntent(parsed)).toBe(false);
  });

  it("parses an explicit kind=property intent unchanged", () => {
    const parsed = AcknowledgmentIntentSchema.parse({
      kind: "property",
      field: "x",
      value: 1,
      scope: "definition",
    });
    expect(parsed.kind).toBe("property");
    if (parsed.kind === "property") {
      expect(parsed.field).toBe("x");
      expect(parsed.value).toBe(1);
      expect(parsed.scope).toBe("definition");
    }
  });

  it("parses a rule-opt-out intent and discriminates on `kind`", () => {
    const parsed = AcknowledgmentIntentSchema.parse({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
    });
    expect(parsed).toEqual({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
    });
    expect(isRuleOptOutIntent(parsed)).toBe(true);
    expect(isPropertyIntent(parsed)).toBe(false);
  });

  it("rejects a malformed mix (rule-opt-out with stray property fields)", () => {
    // The rule-opt-out branch is `.strict()` so stray `field`/`value`/`scope`
    // keys cause `safeParse` to fail even when `ruleId` is present.
    const result = AcknowledgmentIntentSchema.safeParse({
      kind: "rule-opt-out",
      ruleId: "unmapped-component",
      field: "x",
      value: 1,
      scope: "instance",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    const result = AcknowledgmentIntentSchema.safeParse({
      kind: "wat",
      ruleId: "x",
    });
    expect(result.success).toBe(false);
  });

  it("AcknowledgmentSchema accepts a full rule-opt-out ack payload", () => {
    const parsed = AcknowledgmentSchema.parse({
      nodeId: "10:1",
      ruleId: "unmapped-component",
      intent: { kind: "rule-opt-out", ruleId: "unmapped-component" },
    });
    expect(parsed.intent?.kind).toBe("rule-opt-out");
  });

  it("AcknowledgmentSchema accepts a legacy property ack with no `kind` and defaults it", () => {
    const parsed = AcknowledgmentSchema.parse({
      nodeId: "10:1",
      ruleId: "fixed-size-in-auto-layout",
      intent: { field: "layoutSizingHorizontal", value: "FILL", scope: "instance" },
    });
    expect(parsed.intent?.kind).toBe("property");
  });
});
