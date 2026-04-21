import { analyzeFile } from "../../engine/rule-engine.js";
import type { AnalysisFile, AnalysisNode } from "../../contracts/figma-node.js";

// Import rules to register
import "../index.js";

function makeNode(
  overrides: Partial<AnalysisNode> & { name: string; type: string },
): AnalysisNode {
  return {
    id: overrides.id ?? overrides.name,
    visible: true,
    ...overrides,
  } as AnalysisNode;
}

function makeFile(document: AnalysisNode): AnalysisFile {
  return {
    fileKey: "test",
    name: "Test",
    lastModified: "",
    version: "1",
    document,
    components: {},
    styles: {},
  };
}

describe("fixed-size-in-auto-layout", () => {
  it("flags container with both axes FIXED inside auto-layout parent", () => {
    const file = makeFile(
      makeNode({
        name: "Root",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            name: "Card",
            type: "FRAME",
            layoutSizingHorizontal: "FIXED",
            layoutSizingVertical: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "fixed-size-in-auto-layout",
    );
    expect(issues.length).toBeGreaterThanOrEqual(1);
    expect(issues.at(0)?.violation.message).toContain("Card");
  });

  it("does not flag when one axis is FILL", () => {
    const file = makeFile(
      makeNode({
        name: "Root",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            name: "Card",
            type: "FRAME",
            layoutSizingHorizontal: "FILL",
            layoutSizingVertical: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "fixed-size-in-auto-layout",
    );
    expect(issues).toHaveLength(0);
  });

  it("does not flag small elements (icons)", () => {
    const file = makeFile(
      makeNode({
        name: "Root",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            name: "Icon",
            type: "FRAME",
            layoutSizingHorizontal: "FIXED",
            layoutSizingVertical: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "fixed-size-in-auto-layout",
    );
    expect(issues).toHaveLength(0);
  });
});

// ============================================
// missing-size-constraint (#403 redesign matrix)
// ============================================
//
// Matrix coverage — every firing case must have at least one test; every
// pass-through edge also has a test so the rule does not silently expand
// scope in a refactor.
//
//   page scope
//     container FRAME/SECTION FILL + no chain bound  → fires page-container-unbound
//     container FRAME/SECTION FILL + chain bound at root → pass
//     container FRAME/SECTION FILL + chain bound at intermediate → pass
//     container FRAME FIXED (self)                  → pass (no FILL)
//     INSTANCE FILL                                  → pass
//     INSTANCE FIXED inside Auto Layout              → fires page-instance-fixed
//     INSTANCE FIXED outside Auto Layout             → pass (no-auto-layout owns)
//     FRAME FIXED inside an INSTANCE (internal node) → pass (actionability filter)
//     GROUP / leaf                                   → pass
//   component scope
//     COMPONENT root FILL                            → pass (reusable contract)
//     COMPONENT root FIXED                           → fires component-fixed-by-design
//     INSTANCE root FIXED                            → fires component-fixed-by-override
//     INSTANCE root FILL                             → pass
//     internal node FIXED                            → pass (root-only)
//     COMPONENT_SET root FIXED + variants            → fires once on SET, variants pass
//   memoization
//     Many FILL children under a bounded ancestor    → all pass (cache shared)
//
// All tests feed `analyzeFile(file)` so scope is resolved end-to-end
// from `detectAnalysisScope(root)`; this double-checks that the engine
// threads `scope` + `rootNodeType` correctly into the rule's context.

describe("missing-size-constraint (#403)", () => {
  // ── page scope: container FILL cases ─────────────────────────────────

  it("fires page-container-unbound when FRAME FILL has no ancestor with a width bound", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        // Intentionally no width bound — neither FIXED sizing nor min/max.
        layoutMode: "VERTICAL",
        children: [
          makeNode({
            name: "UnboundedSection",
            type: "FRAME",
            layoutSizingHorizontal: "FILL",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 400 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    expect(result.scope).toBe("page");
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    const unbounded = issues.filter((i) => i.violation.nodeId === "UnboundedSection");
    expect(unbounded).toHaveLength(1);
    expect(unbounded[0]!.violation.subType).toBe("page-container-unbound");
    expect(unbounded[0]!.violation.message).toContain("UnboundedSection");
    expect(unbounded[0]!.violation.message).toContain("1280px");
  });

  it("does not fire when the root ancestor establishes a width bound via maxWidth", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        maxWidth: 1440,
        children: [
          makeNode({
            name: "Section",
            type: "FRAME",
            layoutSizingHorizontal: "FILL",
            absoluteBoundingBox: { x: 0, y: 0, width: 1280, height: 400 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire when an intermediate ancestor establishes a width bound via FIXED sizing", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [
          makeNode({
            name: "Canvas",
            type: "FRAME",
            layoutMode: "VERTICAL",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 800 },
            children: [
              makeNode({
                name: "Section",
                type: "FRAME",
                layoutSizingHorizontal: "FILL",
                absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 400 },
              }),
            ],
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        i.violation.nodeId === "Section",
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire on FRAMEs that are not FILL (nothing to bound)", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "HORIZONTAL",
        children: [
          makeNode({
            name: "FixedSidebar",
            type: "FRAME",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 240, height: 400 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        i.violation.nodeId === "FixedSidebar",
    );
    expect(issues).toHaveLength(0);
  });

  // ── page scope: INSTANCE cases ───────────────────────────────────────

  it("does not fire on INSTANCE FILL (component contract governs sizing)", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        maxWidth: 1440,
        children: [
          makeNode({
            name: "Button",
            type: "INSTANCE",
            layoutSizingHorizontal: "FILL",
            absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 40 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });

  it("fires page-instance-fixed when INSTANCE has FIXED width inside an Auto Layout parent", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        maxWidth: 1440,
        children: [
          makeNode({
            name: "PromoCard",
            type: "INSTANCE",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 120 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        i.violation.nodeId === "PromoCard",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.violation.subType).toBe("page-instance-fixed");
    expect(issues[0]!.violation.message).toContain("360px");
  });

  it("does not fire on INSTANCE FIXED whose parent is not Auto Layout (no-auto-layout owns)", () => {
    // Scope-out per PR body: when the parent is not Auto Layout, the
    // `no-auto-layout` rule already fires on that parent and owns the
    // score channel for the structural concern. Adding a sizing gotcha
    // on top would double-penalize.
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        maxWidth: 1440,
        children: [
          makeNode({
            name: "FloatingCard",
            type: "INSTANCE",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 360, height: 120 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        i.violation.nodeId === "FloatingCard",
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire on FIXED FRAMEs inside an INSTANCE (Plugin API cannot set min/max there)", () => {
    // Actionability filter (#403 D6): writes to instance internal
    // nodes are silently ignored by the Figma Plugin API, so a gotcha
    // on them would be un-actionable.
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        maxWidth: 1440,
        layoutMode: "VERTICAL",
        children: [
          makeNode({
            name: "Card",
            type: "INSTANCE",
            layoutSizingHorizontal: "FILL",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 200 },
            children: [
              makeNode({
                name: "CardBody",
                type: "FRAME",
                layoutSizingHorizontal: "FIXED",
                absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 160 },
                children: [
                  makeNode({
                    name: "InnerText",
                    type: "FRAME",
                    layoutSizingHorizontal: "FILL",
                    absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 40 },
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        (i.violation.nodeId === "CardBody" || i.violation.nodeId === "InnerText"),
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire on GROUP containers (other rules own structural GROUP concerns)", () => {
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [
          makeNode({
            name: "Group",
            type: "GROUP",
            absoluteBoundingBox: { x: 0, y: 0, width: 600, height: 400 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint" &&
        i.violation.nodeId === "Group",
    );
    expect(issues).toHaveLength(0);
  });

  // ── component scope: root cases ──────────────────────────────────────

  it("does not fire on COMPONENT root with FILL (reusable contract)", () => {
    const file = makeFile(
      makeNode({
        name: "Button",
        type: "COMPONENT",
        layoutSizingHorizontal: "FILL",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
      }),
    );
    const result = analyzeFile(file);
    expect(result.scope).toBe("component");
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });

  it("fires component-fixed-by-design on COMPONENT root with FIXED width", () => {
    const file = makeFile(
      makeNode({
        name: "Badge",
        type: "COMPONENT",
        layoutSizingHorizontal: "FIXED",
        absoluteBoundingBox: { x: 0, y: 0, width: 72, height: 24 },
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.violation.subType).toBe("component-fixed-by-design");
    expect(issues[0]!.violation.nodeId).toBe("Badge");
    expect(issues[0]!.violation.message).toContain("72px");
  });

  it("fires component-fixed-by-override on INSTANCE root with FIXED width", () => {
    const file = makeFile(
      makeNode({
        name: "BadgeInstance",
        type: "INSTANCE",
        layoutSizingHorizontal: "FIXED",
        absoluteBoundingBox: { x: 0, y: 0, width: 72, height: 24 },
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.violation.subType).toBe("component-fixed-by-override");
    expect(issues[0]!.violation.nodeId).toBe("BadgeInstance");
  });

  it("does not fire on INSTANCE root with FILL width", () => {
    const file = makeFile(
      makeNode({
        name: "BadgeInstance",
        type: "INSTANCE",
        layoutSizingHorizontal: "FILL",
        absoluteBoundingBox: { x: 0, y: 0, width: 72, height: 24 },
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });

  it("does not fire on FIXED nodes inside a COMPONENT root — only the root is audited", () => {
    const file = makeFile(
      makeNode({
        name: "Card",
        type: "COMPONENT",
        layoutSizingHorizontal: "FILL",
        layoutMode: "VERTICAL",
        absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 200 },
        children: [
          makeNode({
            name: "Header",
            type: "FRAME",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 40 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });

  it("fires on COMPONENT_SET root with FIXED width but skips its variants", () => {
    // The SET itself is the audit target; internal variants are
    // treated as internal nodes (depth > 0) and pass. This keeps the
    // gotcha to one-per-audit instead of one-per-variant.
    const file = makeFile(
      makeNode({
        name: "ButtonSet",
        type: "COMPONENT_SET",
        layoutSizingHorizontal: "FIXED",
        absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        children: [
          makeNode({
            name: "Button=Primary",
            type: "COMPONENT",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
          }),
          makeNode({
            name: "Button=Secondary",
            type: "COMPONENT",
            layoutSizingHorizontal: "FIXED",
            absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
          }),
        ],
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.violation.nodeId).toBe("ButtonSet");
    expect(issues[0]!.violation.subType).toBe("component-fixed-by-design");
  });

  // ── memoization sanity ──────────────────────────────────────────────

  it("shares the chain-bound cache across siblings — many FILL children under a bounded ancestor all pass", () => {
    // If the cache were missing, each sibling's walk would still
    // terminate at the same bounded ancestor and pass — but the shape
    // of the assertion (no fires, no exceptions) also catches regressions
    // that would cause the walker to re-descend or to not find the
    // ancestor's cached entry. More importantly, this is the hot-path
    // case on real pages with many grid children, so a behavior
    // regression here would spike fire counts in calibration.
    const FILL_CHILD_COUNT = 8;
    const children = Array.from({ length: FILL_CHILD_COUNT }, (_, i) =>
      makeNode({
        name: `Card${i}`,
        type: "FRAME",
        layoutSizingHorizontal: "FILL",
        absoluteBoundingBox: { x: 0, y: i * 100, width: 1200, height: 100 },
      }),
    );
    const file = makeFile(
      makeNode({
        name: "Page",
        type: "FRAME",
        layoutMode: "VERTICAL",
        maxWidth: 1440,
        children,
      }),
    );
    const result = analyzeFile(file);
    const issues = result.issues.filter(
      (i) => i.rule.definition.id === "missing-size-constraint",
    );
    expect(issues).toHaveLength(0);
  });
});
