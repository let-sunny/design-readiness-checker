import { RuleEngine, analyzeFile } from "./rule-engine.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";
import { RULE_CONFIGS } from "../rules/rule-config.js";
import { ruleRegistry } from "../rules/rule-registry.js";

// Import rules to register
import "../rules/index.js";

function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "1:1",
    name: "TestNode",
    type: "FRAME",
    visible: true,
    ...overrides,
  };
}

function makeFile(overrides?: Partial<AnalysisFile>): AnalysisFile {
  return {
    fileKey: "test",
    name: "Test",
    lastModified: "",
    version: "1",
    document: makeNode({ id: "0:1", name: "Document", type: "DOCUMENT" }),
    components: {},
    styles: {},
    ...overrides,
  };
}

// ─── Per-analysis state isolation ─────────────────────────────────────────────

describe("RuleEngine.analyze — per-analysis state isolation", () => {
  it("produces identical results when called twice on the same instance", () => {
    // Two repeated frames with same name + matching component → missing-component Stage 1
    const frameA = makeNode({ id: "f:1", name: "Button" });
    const frameB = makeNode({ id: "f:2", name: "Button" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameA, frameB],
    });

    const file = makeFile({
      document: doc,
      components: {
        "comp:1": { key: "comp:1", name: "Button", description: "" },
      },
    });

    const engine = new RuleEngine();

    const result1 = engine.analyze(file);
    const result2 = engine.analyze(file);

    // Both runs should find the same missing-component issue
    const missingComp1 = result1.issues.filter(
      (i) => i.violation.ruleId === "missing-component"
    );
    const missingComp2 = result2.issues.filter(
      (i) => i.violation.ruleId === "missing-component"
    );

    expect(missingComp1.length).toBeGreaterThan(0);
    expect(missingComp2.length).toBe(missingComp1.length);
    expect(missingComp2[0]?.violation.message).toBe(
      missingComp1[0]?.violation.message
    );
  });
});

// ─── targetNodeId / findNodeById ──────────────────────────────────────────────

describe("RuleEngine.analyze — targetNodeId", () => {
  it("analyzes only the subtree of the target node", () => {
    const targetChild = makeNode({ id: "2:1", name: "TargetChild", type: "FRAME" });
    const targetNode = makeNode({
      id: "1:1",
      name: "Target",
      type: "FRAME",
      children: [targetChild],
    });
    const otherNode = makeNode({ id: "3:1", name: "Other", type: "FRAME" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [targetNode, otherNode],
    });

    const file = makeFile({ document: doc });
    const engine = new RuleEngine({ targetNodeId: "1:1" });
    const result = engine.analyze(file);

    // Should count only target subtree nodes (Target + TargetChild = 2)
    expect(result.nodeCount).toBe(2);
  });

  it("normalizes dash to colon in node IDs (URL format)", () => {
    const targetNode = makeNode({ id: "1:100", name: "Target", type: "FRAME" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [targetNode],
    });

    const file = makeFile({ document: doc });
    // URL format uses "-" instead of ":"
    const engine = new RuleEngine({ targetNodeId: "1-100" });
    const result = engine.analyze(file);

    expect(result.nodeCount).toBe(1);
  });

  it("throws when targetNodeId does not exist", () => {
    const file = makeFile();
    const engine = new RuleEngine({ targetNodeId: "999:999" });

    expect(() => engine.analyze(file)).toThrow("Node not found: 999:999");
  });
});

// ─── excludeNodeNames / excludeNodeTypes ──────────────────────────────────────

describe("RuleEngine.analyze — node exclusion", () => {
  it("skips nodes matching excludeNodeTypes", () => {
    const textNode = makeNode({ id: "t:1", name: "Label", type: "TEXT" });
    const frameNode = makeNode({
      id: "f:1",
      name: "Container",
      type: "FRAME",
      children: [textNode],
    });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [frameNode],
    });

    const file = makeFile({ document: doc });

    // Analyze without exclusion
    const resultAll = analyzeFile(file);
    // Analyze with TEXT excluded
    const resultExcluded = analyzeFile(file, { excludeNodeTypes: ["TEXT"] });

    // Issues from TEXT nodes should be absent
    const textIssuesAll = resultAll.issues.filter(
      (i) => i.violation.nodeId === "t:1"
    );
    const textIssuesExcluded = resultExcluded.issues.filter(
      (i) => i.violation.nodeId === "t:1"
    );

    // Baseline must have issues from TEXT node to validate the filter
    expect(textIssuesAll.length).toBeGreaterThan(0);
    expect(textIssuesExcluded.length).toBe(0);
  });

  it("skips nodes matching excludeNodeNames pattern", () => {
    // Use GROUP type to trigger non-layout-container rule (enabled)
    const ignoredNode = makeNode({ id: "i:1", name: "IgnoreMe", type: "GROUP", children: [makeNode({ id: "i:2", name: "Child", type: "FRAME" })] });
    const normalNode = makeNode({ id: "n:1", name: "Normal", type: "GROUP", children: [makeNode({ id: "n:2", name: "Child", type: "FRAME" })] });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [ignoredNode, normalNode],
    });

    const file = makeFile({ document: doc });

    // Baseline: verify ignored node produces issues without exclusion
    const baseline = analyzeFile(file);
    const ignoredIssuesBaseline = baseline.issues.filter(
      (i) => i.violation.nodeId === "i:1"
    );
    expect(ignoredIssuesBaseline.length).toBeGreaterThan(0);

    // With exclusion: issues from that node should be absent
    const result = analyzeFile(file, { excludeNodeNames: ["IgnoreMe"] });
    const ignoredIssues = result.issues.filter(
      (i) => i.violation.nodeId === "i:1"
    );
    expect(ignoredIssues.length).toBe(0);
  });
});

// ─── enabledRules / disabledRules filtering ───────────────────────────────────

describe("RuleEngine.analyze — rule filtering", () => {
  it("runs only enabledRules when specified", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({ id: "f:1", name: "Frame 1", type: "FRAME" }),
      ],
    });
    const file = makeFile({ document: doc });

    // Enable only default-name rule
    const result = analyzeFile(file, { enabledRules: ["non-semantic-name"] });

    // Must have at least one issue to avoid vacuous pass
    expect(result.issues.length).toBeGreaterThan(0);

    // All issues should be from default-name only
    for (const issue of result.issues) {
      expect(issue.violation.ruleId).toBe("non-semantic-name");
    }
  });

  it("excludes disabledRules", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({ id: "f:1", name: "Frame 1", type: "FRAME" }),
      ],
    });
    const file = makeFile({ document: doc });

    const resultAll = analyzeFile(file);
    const resultDisabled = analyzeFile(file, { disabledRules: ["non-semantic-name"] });

    const defaultNameAll = resultAll.issues.filter(
      (i) => i.violation.ruleId === "non-semantic-name"
    );
    const defaultNameDisabled = resultDisabled.issues.filter(
      (i) => i.violation.ruleId === "non-semantic-name"
    );

    // Baseline must have default-name issues to validate the filter
    expect(defaultNameAll.length).toBeGreaterThan(0);
    expect(defaultNameDisabled.length).toBe(0);
  });

  it("skips rules disabled in config (enabled: false)", () => {
    // Frame without auto-layout triggers no-auto-layout rule when enabled
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({ id: "f:1", name: "Frame", type: "FRAME", children: [makeNode({ id: "c:1" })] }),
      ],
    });
    const file = makeFile({ document: doc });

    // Positive control: no-auto-layout fires when enabled (default)
    const resultEnabled = analyzeFile(file);
    const enabledIssues = resultEnabled.issues.filter(
      (i) => i.violation.ruleId === "no-auto-layout"
    );
    expect(enabledIssues.length).toBeGreaterThan(0);

    // Disable the rule → no issues for that rule
    const disabledConfigs = { ...RULE_CONFIGS };
    const baseConfig = disabledConfigs["no-auto-layout"];
    expect(baseConfig).toBeDefined();
    disabledConfigs["no-auto-layout"] = { ...baseConfig!, enabled: false };
    const result = analyzeFile(file, { configs: disabledConfigs });
    const disabledIssues = result.issues.filter(
      (i) => i.violation.ruleId === "no-auto-layout"
    );
    expect(disabledIssues.length).toBe(0);
  });
});

// ─── calcDepthWeight ──────────────────────────────────────────────────────────

describe("RuleEngine.analyze — depth weight calculation", () => {
  it("applies higher weight at root level (depthWeight interpolation)", () => {
    // no-auto-layout requires FRAME with children to trigger, so every level needs a child
    const leaf = makeNode({ id: "leaf:1", name: "Leaf", type: "TEXT" });
    const grandchild = makeNode({ id: "gc:1", name: "GC Frame", type: "FRAME", children: [leaf] });
    const child = makeNode({ id: "c:1", name: "Child Frame", type: "FRAME", children: [grandchild] });
    const root = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [child],
    });

    const file = makeFile({ document: root });
    // Use only no-auto-layout which has depthWeight: 1.5 and is in "pixel-critical" (supports depth weight)
    const result = analyzeFile(file, { enabledRules: ["no-auto-layout"] });

    // Find issues at different depths — assert they exist to avoid vacuous pass
    const issueAtChild = result.issues.find((i) => i.violation.nodeId === "c:1");
    const issueAtGC = result.issues.find((i) => i.violation.nodeId === "gc:1");

    expect(issueAtChild).toBeDefined();
    expect(issueAtGC).toBeDefined();

    // Issue closer to root should have higher absolute score (more negative)
    expect(Math.abs(issueAtChild!.calculatedScore)).toBeGreaterThanOrEqual(
      Math.abs(issueAtGC!.calculatedScore)
    );
  });
});

// ─── Tree traversal / node counting ───────────────────────────────────────────

describe("RuleEngine.analyze — tree traversal", () => {
  it("counts all nodes in the tree", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({
          id: "1:1",
          name: "Frame",
          type: "FRAME",
          children: [
            makeNode({ id: "2:1", name: "Text", type: "TEXT" }),
            makeNode({ id: "2:2", name: "Rect", type: "RECTANGLE" }),
          ],
        }),
      ],
    });

    const file = makeFile({ document: doc });
    const result = analyzeFile(file);

    // Document + Frame + Text + Rect = 4
    expect(result.nodeCount).toBe(4);
  });

  it("calculates maxDepth correctly", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({
          id: "1:1",
          name: "L1",
          type: "FRAME",
          children: [
            makeNode({
              id: "2:1",
              name: "L2",
              type: "FRAME",
              children: [
                makeNode({ id: "3:1", name: "L3", type: "FRAME" }),
              ],
            }),
          ],
        }),
      ],
    });

    const file = makeFile({ document: doc });
    const result = analyzeFile(file);

    // Depth: Document=0, L1=1, L2=2, L3=3 → maxDepth = 3
    expect(result.maxDepth).toBe(3);
  });

  it("handles empty document (leaf node)", () => {
    const file = makeFile();
    const result = analyzeFile(file);

    expect(result.nodeCount).toBe(1);
    expect(result.maxDepth).toBe(0);
    expect(result.issues).toBeDefined();
  });
});

// ─── Error handling ───────────────────────────────────────────────────────────

describe("RuleEngine.analyze — error resilience", () => {
  it("continues analysis and tracks failures when a rule throws", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [
        makeNode({ id: "f:1", name: "Frame 1", type: "FRAME" }),
      ],
    });
    const file = makeFile({ document: doc });

    // Make an existing rule's check throw to verify error resilience
    const defaultNameRule = ruleRegistry.get("non-semantic-name");
    expect(defaultNameRule).toBeDefined();

    const originalCheck = defaultNameRule!.check;
    defaultNameRule!.check = () => { throw new Error("boom"); };

    try {
      // Analysis should still complete despite the throwing rule
      const result = analyzeFile(file);
      expect(result.issues).toBeDefined();
      expect(result.nodeCount).toBe(2);

      // failedRules should contain the failure details
      expect(result.failedRules.length).toBeGreaterThan(0);

      const failure = result.failedRules.find((f) => f.ruleId === "non-semantic-name");
      expect(failure).toBeDefined();
      expect(failure!.error).toBe("boom");
      expect(failure!.nodeName).toBeDefined();
      expect(failure!.nodeId).toBeDefined();
    } finally {
      // Restore the original check function
      defaultNameRule!.check = originalCheck;
    }
  });

  it("returns empty failedRules when no rules throw", () => {
    const file = makeFile();
    const result = analyzeFile(file);

    expect(result.failedRules).toEqual([]);
  });
});

// ─── analyzeFile convenience function ─────────────────────────────────────────

describe("analyzeFile", () => {
  it("returns a valid AnalysisResult", () => {
    const file = makeFile();
    const result = analyzeFile(file);

    expect(result.file).toBe(file);
    expect(result.analyzedAt).toBeDefined();
    expect(result.issues).toBeInstanceOf(Array);
    expect(typeof result.nodeCount).toBe("number");
    expect(typeof result.maxDepth).toBe("number");
  });

  it("accepts custom configs", () => {
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [makeNode({ id: "f:1", name: "Frame 1", type: "FRAME" })],
    });
    const file = makeFile({ document: doc });

    // Disable all rules via custom configs
    const allDisabled: Record<RuleId, RuleConfig> = {} as Record<RuleId, RuleConfig>;
    for (const [id, config] of Object.entries(RULE_CONFIGS)) {
      allDisabled[id as RuleId] = { ...config, enabled: false };
    }

    const result = analyzeFile(file, { configs: allDisabled });
    expect(result.issues.length).toBe(0);
  });
});

// ─── Acknowledgments (#371) ──────────────────────────────────────────────────

describe("RuleEngine.analyze — acknowledgments", () => {
  // Build a document where two leaf frames produce non-semantic-name violations.
  // We then mark one of them as acknowledged and assert only that one carries
  // the flag — the other stays unacknowledged.
  function buildMultiViolationFile(): { file: AnalysisFile; targetNodeIds: string[] } {
    const child1 = makeNode({ id: "10:1", name: "Frame 1", type: "FRAME" });
    const child2 = makeNode({ id: "10:2", name: "Frame 2", type: "FRAME" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [child1, child2],
    });
    return { file: makeFile({ document: doc }), targetNodeIds: [child1.id, child2.id] };
  }

  it("flags issues whose (nodeId, ruleId) match an acknowledgment", () => {
    const { file, targetNodeIds } = buildMultiViolationFile();
    const result = analyzeFile(file, {
      acknowledgments: [{ nodeId: targetNodeIds[0]!, ruleId: "non-semantic-name" }],
    });

    const naming = result.issues.filter(
      (i) => i.violation.ruleId === "non-semantic-name"
    );
    expect(naming.length).toBeGreaterThanOrEqual(2);
    const acked = naming.find((i) => i.violation.nodeId === targetNodeIds[0]);
    const unacked = naming.find((i) => i.violation.nodeId === targetNodeIds[1]);
    expect(acked?.acknowledged).toBe(true);
    expect(unacked?.acknowledged).toBeUndefined();
  });

  it("normalizes acknowledgment nodeIds (URL form `-` matches Plugin form `:`)", () => {
    const { file, targetNodeIds } = buildMultiViolationFile();
    const urlForm = targetNodeIds[0]!.replace(/:/g, "-");
    const result = analyzeFile(file, {
      acknowledgments: [{ nodeId: urlForm, ruleId: "non-semantic-name" }],
    });

    const acked = result.issues.find(
      (i) => i.violation.nodeId === targetNodeIds[0] && i.violation.ruleId === "non-semantic-name"
    );
    expect(acked?.acknowledged).toBe(true);
  });

  it("ignores acknowledgments that do not match any issue", () => {
    const { file } = buildMultiViolationFile();
    const result = analyzeFile(file, {
      acknowledgments: [{ nodeId: "999:999", ruleId: "non-semantic-name" }],
    });

    const anyAcked = result.issues.some((i) => i.acknowledged === true);
    expect(anyAcked).toBe(false);
  });

  it("leaves issues unflagged when no acknowledgments are passed", () => {
    const { file } = buildMultiViolationFile();
    const result = analyzeFile(file);

    const anyAcked = result.issues.some((i) => i.acknowledged === true);
    expect(anyAcked).toBe(false);
  });
});

// ─── #404 analysis scope ──────────────────────────────────────────────────────

describe("RuleEngine.analyze — scope detection and injection (#404)", () => {
  it("auto-detects `page` scope for a FRAME root analyzed directly", () => {
    const frame = makeNode({ id: "10:1", name: "Screen", type: "FRAME" });
    const file = makeFile({ document: frame });

    const result = analyzeFile(file);
    expect(result.scope).toBe("page");
  });

  it("auto-detects `component` scope when targetNodeId resolves to a COMPONENT", () => {
    const comp = makeNode({ id: "20:1", name: "Button", type: "COMPONENT" });
    const doc = makeNode({
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      children: [comp],
    });
    const file = makeFile({ document: doc });

    const result = analyzeFile(file, { targetNodeId: "20:1" });
    // Scope is derived from the resolved root after targetNodeId — not the
    // file's document — so analyzing a component via node-id yields
    // component scope even when the file is a full page.
    expect(result.scope).toBe("component");
  });

  it("auto-detects `component` scope for COMPONENT_SET and INSTANCE roots", () => {
    const compSetFile = makeFile({
      document: makeNode({ id: "30:1", name: "Icon-set", type: "COMPONENT_SET" }),
    });
    const instanceFile = makeFile({
      document: makeNode({ id: "31:1", name: "Button/Primary", type: "INSTANCE" }),
    });

    expect(analyzeFile(compSetFile).scope).toBe("component");
    expect(analyzeFile(instanceFile).scope).toBe("component");
  });

  it("explicit scope option overrides auto-detection in both directions", () => {
    const frame = makeNode({ id: "10:1", name: "Screen", type: "FRAME" });
    const comp = makeNode({ id: "20:1", name: "Button", type: "COMPONENT" });

    // FRAME root normally detects as page → force component
    expect(
      analyzeFile(makeFile({ document: frame }), { scope: "component" }).scope
    ).toBe("component");
    // COMPONENT root normally detects as component → force page
    // (rare, but supported — e.g. a "design-system demo page" packaged as a
    // top-level COMPONENT that the user wants audited like a screen).
    expect(
      analyzeFile(makeFile({ document: comp }), { scope: "page" }).scope
    ).toBe("page");
  });

  it("threads scope into every RuleContext a rule receives", () => {
    const captured: string[] = [];

    ruleRegistry.register({
      definition: {
        id: "capture-scope-test" as RuleId,
        category: "code-quality",
        label: "Capture scope for test",
        description: "",
      },
      check: (_node, ctx) => {
        captured.push(ctx.scope);
        return null;
      },
    });

    const cfg: Record<string, RuleConfig> = {
      ...RULE_CONFIGS,
      "capture-scope-test": { severity: "suggestion", score: 0, enabled: true },
    };

    try {
      const comp = makeNode({ id: "40:1", name: "Card", type: "COMPONENT" });
      const file = makeFile({
        document: makeNode({
          id: "0:1",
          name: "Document",
          type: "DOCUMENT",
          children: [
            comp,
            makeNode({ id: "40:2", name: "Inner", type: "FRAME" }),
          ],
        }),
      });

      analyzeFile(file, {
        targetNodeId: "40:1",
        configs: cfg as Record<RuleId, RuleConfig>,
        enabledRules: ["capture-scope-test" as RuleId],
      });

      expect(captured.length).toBeGreaterThan(0);
      // Scope is constant per analysis — every visited node must see the
      // same value (derived from the analysis root, not the current node).
      expect(new Set(captured)).toEqual(new Set(["component"]));
    } finally {
      ruleRegistry.unregister("capture-scope-test" as RuleId);
    }
  });
});

// ─── #403 root node type axis ─────────────────────────────────────────────────

describe("RuleEngine.analyze — rootNodeType injection (#403)", () => {
  // `rootNodeType` is intentionally a different axis from `scope`. A
  // `scope === "component"` analysis can have either a COMPONENT root
  // (the component being audited) or an INSTANCE root (a placement of a
  // component, possibly with overrides) — rules like the
  // `missing-size-constraint` redesign branch on that distinction.

  it("captures the root's Figma node type and threads it into every RuleContext", () => {
    const captured: string[] = [];

    ruleRegistry.register({
      definition: {
        id: "capture-root-type-test" as RuleId,
        category: "code-quality",
        label: "Capture rootNodeType for test",
        description: "",
      } as never,
      check: (_node, ctx) => {
        captured.push(ctx.rootNodeType);
        return null;
      },
    });

    const cfg: Record<string, RuleConfig> = {
      ...RULE_CONFIGS,
      "capture-root-type-test": { severity: "suggestion", score: 0, enabled: true },
    };

    try {
      const instance = makeNode({
        id: "50:1",
        name: "Card/Default",
        type: "INSTANCE",
        children: [
          makeNode({ id: "50:2", name: "Inner", type: "FRAME" }),
          makeNode({ id: "50:3", name: "Label", type: "TEXT" }),
        ],
      });
      const file = makeFile({
        document: makeNode({
          id: "0:1",
          name: "Document",
          type: "DOCUMENT",
          children: [instance],
        }),
      });

      analyzeFile(file, {
        targetNodeId: "50:1",
        configs: cfg as Record<RuleId, RuleConfig>,
        enabledRules: ["capture-root-type-test" as RuleId],
      });

      expect(captured.length).toBeGreaterThan(0);
      // rootNodeType is constant per analysis — INSTANCE root, even
      // though the current node may be the inner FRAME or TEXT child.
      expect(new Set(captured)).toEqual(new Set(["INSTANCE"]));
    } finally {
      ruleRegistry.unregister("capture-root-type-test" as RuleId);
    }
  });

  it("captures rootNodeType for FRAME, COMPONENT, and COMPONENT_SET roots", () => {
    const captured: Record<string, string[]> = {};

    ruleRegistry.register({
      definition: {
        id: "capture-root-type-multi-test" as RuleId,
        category: "code-quality",
        label: "Capture rootNodeType across roots",
        description: "",
      } as never,
      check: (_node, ctx) => {
        const bucket = captured[ctx.rootNodeType] ?? [];
        bucket.push(ctx.rootNodeType);
        captured[ctx.rootNodeType] = bucket;
        return null;
      },
    });

    const cfg: Record<string, RuleConfig> = {
      ...RULE_CONFIGS,
      "capture-root-type-multi-test": { severity: "suggestion", score: 0, enabled: true },
    };

    try {
      for (const type of ["FRAME", "COMPONENT", "COMPONENT_SET"] as const) {
        analyzeFile(
          makeFile({
            document: makeNode({ id: `${type}:1`, name: type, type }),
          }),
          {
            configs: cfg as Record<RuleId, RuleConfig>,
            enabledRules: ["capture-root-type-multi-test" as RuleId],
          },
        );
      }
      expect(Object.keys(captured).sort()).toEqual(["COMPONENT", "COMPONENT_SET", "FRAME"]);
    } finally {
      ruleRegistry.unregister("capture-root-type-multi-test" as RuleId);
    }
  });
});
