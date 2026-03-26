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
    const ignoredNode = makeNode({ id: "i:1", name: "IgnoreMe", type: "FRAME" });
    const normalNode = makeNode({ id: "n:1", name: "Normal", type: "FRAME" });
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
    const result = analyzeFile(file, { enabledRules: ["default-name"] });

    // Must have at least one issue to avoid vacuous pass
    expect(result.issues.length).toBeGreaterThan(0);

    // All issues should be from default-name only
    for (const issue of result.issues) {
      expect(issue.violation.ruleId).toBe("default-name");
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
    const resultDisabled = analyzeFile(file, { disabledRules: ["default-name"] });

    const defaultNameAll = resultAll.issues.filter(
      (i) => i.violation.ruleId === "default-name"
    );
    const defaultNameDisabled = resultDisabled.issues.filter(
      (i) => i.violation.ruleId === "default-name"
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
    // Use only no-auto-layout which has depthWeight: 1.5 and is in "structure" (supports depth weight)
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
    const defaultNameRule = ruleRegistry.get("default-name");
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

      const failure = result.failedRules.find((f) => f.ruleId === "default-name");
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
