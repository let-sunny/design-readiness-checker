import { computeApplyContext } from "./apply-context.js";
import type { RuleId, RuleViolation } from "../contracts/rule.js";

function makeViolation(
  ruleId: RuleId,
  opts: { nodeId?: string; subType?: string } = {},
): Pick<RuleViolation, "ruleId" | "subType" | "nodeId"> {
  return {
    ruleId,
    nodeId: opts.nodeId ?? "1:1",
    ...(opts.subType !== undefined ? { subType: opts.subType } : {}),
  };
}

describe("computeApplyContext", () => {
  describe("applyStrategy table", () => {
    const propertyMod: RuleId[] = [
      "no-auto-layout",
      "fixed-size-in-auto-layout",
      "missing-size-constraint",
      "irregular-spacing",
      "non-semantic-name",
    ];
    const structuralMod: RuleId[] = [
      "non-layout-container",
      "deep-nesting",
      "missing-component",
      "detached-instance",
    ];
    const annotation: RuleId[] = [
      "absolute-position-in-auto-layout",
      "variant-structure-mismatch",
    ];
    const autoFix: RuleId[] = [
      "non-standard-naming",
      "inconsistent-naming-convention",
      "raw-value",
      "missing-interaction-state",
      "missing-prototype",
    ];

    it.each(propertyMod)("%s → property-mod", (ruleId) => {
      expect(computeApplyContext(makeViolation(ruleId)).applyStrategy).toBe(
        "property-mod",
      );
    });

    it.each(structuralMod)("%s → structural-mod", (ruleId) => {
      expect(computeApplyContext(makeViolation(ruleId)).applyStrategy).toBe(
        "structural-mod",
      );
    });

    it.each(annotation)("%s → annotation", (ruleId) => {
      expect(computeApplyContext(makeViolation(ruleId)).applyStrategy).toBe(
        "annotation",
      );
    });

    it.each(autoFix)("%s → auto-fix", (ruleId) => {
      expect(computeApplyContext(makeViolation(ruleId)).applyStrategy).toBe(
        "auto-fix",
      );
    });
  });

  describe("targetProperty by subType", () => {
    it("no-auto-layout → layoutMode + itemSpacing", () => {
      expect(
        computeApplyContext(makeViolation("no-auto-layout", { subType: "basic" }))
          .targetProperty,
      ).toEqual(["layoutMode", "itemSpacing"]);
    });

    it("fixed-size-in-auto-layout horizontal → layoutSizingHorizontal", () => {
      expect(
        computeApplyContext(
          makeViolation("fixed-size-in-auto-layout", { subType: "horizontal" }),
        ).targetProperty,
      ).toBe("layoutSizingHorizontal");
    });

    it("fixed-size-in-auto-layout both-axes → layoutSizingHorizontal + layoutSizingVertical", () => {
      expect(
        computeApplyContext(
          makeViolation("fixed-size-in-auto-layout", { subType: "both-axes" }),
        ).targetProperty,
      ).toEqual(["layoutSizingHorizontal", "layoutSizingVertical"]);
    });

    it("missing-size-constraint wrap → minWidth", () => {
      expect(
        computeApplyContext(
          makeViolation("missing-size-constraint", { subType: "wrap" }),
        ).targetProperty,
      ).toBe("minWidth");
    });

    it("missing-size-constraint max-width → maxWidth", () => {
      expect(
        computeApplyContext(
          makeViolation("missing-size-constraint", { subType: "max-width" }),
        ).targetProperty,
      ).toBe("maxWidth");
    });

    it("missing-size-constraint grid → minWidth + maxWidth", () => {
      expect(
        computeApplyContext(
          makeViolation("missing-size-constraint", { subType: "grid" }),
        ).targetProperty,
      ).toEqual(["minWidth", "maxWidth"]);
    });

    it("irregular-spacing gap → itemSpacing", () => {
      expect(
        computeApplyContext(
          makeViolation("irregular-spacing", { subType: "gap" }),
        ).targetProperty,
      ).toBe("itemSpacing");
    });

    it("irregular-spacing padding → all four padding fields", () => {
      expect(
        computeApplyContext(
          makeViolation("irregular-spacing", { subType: "padding" }),
        ).targetProperty,
      ).toEqual([
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
      ]);
    });

    it("non-semantic-name → name", () => {
      expect(
        computeApplyContext(makeViolation("non-semantic-name")).targetProperty,
      ).toBe("name");
    });

    it("non-layout-container → layoutMode", () => {
      expect(
        computeApplyContext(makeViolation("non-layout-container", { subType: "group" }))
          .targetProperty,
      ).toBe("layoutMode");
    });

    it("naming auto-fixes → name", () => {
      expect(
        computeApplyContext(makeViolation("non-standard-naming")).targetProperty,
      ).toBe("name");
      expect(
        computeApplyContext(makeViolation("inconsistent-naming-convention"))
          .targetProperty,
      ).toBe("name");
    });

    it.each<RuleId>([
      "deep-nesting",
      "missing-component",
      "detached-instance",
      "absolute-position-in-auto-layout",
      "variant-structure-mismatch",
      "raw-value",
      "missing-interaction-state",
      "missing-prototype",
    ])("%s → undefined targetProperty", (ruleId) => {
      expect(
        computeApplyContext(makeViolation(ruleId)).targetProperty,
      ).toBeUndefined();
    });
  });

  describe("annotationProperties", () => {
    it("irregular-spacing gap → itemSpacing hint (subType match)", () => {
      const ctx = computeApplyContext(
        makeViolation("irregular-spacing", { subType: "gap" }),
      );
      expect(ctx.annotationProperties).toEqual([{ type: "itemSpacing" }]);
    });

    it("missing-size-constraint wrap → default hint (subType falls back)", () => {
      const ctx = computeApplyContext(
        makeViolation("missing-size-constraint", { subType: "wrap" }),
      );
      expect(ctx.annotationProperties).toEqual([
        { type: "width" },
        { type: "height" },
      ]);
    });

    it("absolute-position-in-auto-layout → layoutMode hint", () => {
      const ctx = computeApplyContext(
        makeViolation("absolute-position-in-auto-layout"),
      );
      expect(ctx.annotationProperties).toEqual([{ type: "layoutMode" }]);
    });

    it("rule without mapping omits annotationProperties entirely", () => {
      const ctx = computeApplyContext(makeViolation("deep-nesting"));
      expect("annotationProperties" in ctx).toBe(false);
    });

    it("rule with subType-only mapping and unknown subType omits field", () => {
      const ctx = computeApplyContext(
        makeViolation("irregular-spacing", { subType: "unknown-subtype" }),
      );
      expect("annotationProperties" in ctx).toBe(false);
    });
  });

  describe("isInstanceChild / sourceChildId", () => {
    it("plain scene node id → not an instance child", () => {
      const ctx = computeApplyContext(
        makeViolation("no-auto-layout", { nodeId: "348:15903" }),
      );
      expect(ctx.isInstanceChild).toBe(false);
      expect(ctx.sourceChildId).toBeUndefined();
    });

    it("flat instance-child id → parses sourceChildId from last segment", () => {
      const ctx = computeApplyContext(
        makeViolation("no-auto-layout", { nodeId: "I348:15903;2153:7840" }),
      );
      expect(ctx.isInstanceChild).toBe(true);
      expect(ctx.sourceChildId).toBe("2153:7840");
    });

    it("nested instance-child id → uses last segment as sourceChildId", () => {
      const ctx = computeApplyContext(
        makeViolation("no-auto-layout", { nodeId: "I1;I2:3;4:5" }),
      );
      expect(ctx.isInstanceChild).toBe(true);
      expect(ctx.sourceChildId).toBe("4:5");
    });

    it("explicit instanceContext.sourceNodeId takes precedence", () => {
      const ctx = computeApplyContext(
        makeViolation("no-auto-layout", { nodeId: "I348:15903;2153:7840" }),
        {
          parentInstanceNodeId: "348:15903",
          sourceNodeId: "OVERRIDE:1",
        },
      );
      expect(ctx.isInstanceChild).toBe(true);
      expect(ctx.sourceChildId).toBe("OVERRIDE:1");
    });

    it("docs example: I175:8312;2299:23057 → sourceChildId 2299:23057", () => {
      const ctx = computeApplyContext(
        makeViolation("missing-size-constraint", {
          nodeId: "I175:8312;2299:23057",
          subType: "wrap",
        }),
      );
      expect(ctx.isInstanceChild).toBe(true);
      expect(ctx.sourceChildId).toBe("2299:23057");
    });
  });
});
