import type { RuleContext } from "../../contracts/rule.js";
import type {
  Acknowledgment,
} from "../../contracts/acknowledgment.js";
import type { AnalysisFile, AnalysisNode } from "../../contracts/figma-node.js";
import { unmappedComponent } from "./index.js";

function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return {
    id: "1:1",
    name: "Button",
    type: "COMPONENT",
    visible: true,
    ...overrides,
  };
}

function makeFile(overrides?: Partial<AnalysisFile>): AnalysisFile {
  return {
    fileKey: "test-file",
    name: "Test File",
    lastModified: "2026-01-01T00:00:00Z",
    version: "1",
    document: makeNode({ id: "0:1", name: "Document", type: "DOCUMENT" }),
    components: {},
    styles: {},
    ...overrides,
  };
}

let analysisState: Map<string, unknown>;

function makeContext(
  setupDetected: boolean,
  overrides?: Partial<RuleContext>,
  mappedNodeIds: string[] = [],
  acknowledgments: Acknowledgment[] = [],
): RuleContext {
  // Pre-seed the analysis state cache so the rule does not actually touch the
  // filesystem during the test. The cached value short-circuits the existsSync
  // check inside `codeConnectIsSetUp`.
  analysisState.set("unmapped-component:setup-detected", setupDetected);
  // v1.5 (#526 sub-task 1): pre-seed the mapping-parser cache too so the rule
  // sees the test's chosen mapped-node-id set without invoking the parser.
  analysisState.set("unmapped-component:mappings", {
    mappedNodeIds: new Set(mappedNodeIds),
    scannedFiles: [],
  });
  const ackByKey = new Map<string, Acknowledgment>(
    acknowledgments.map((a) => [`${a.nodeId.replace(/-/g, ":")}::${a.ruleId}`, a]),
  );
  return {
    file: makeFile(),
    depth: 1,
    componentDepth: 0,
    maxDepth: 10,
    path: ["Page", "Components"],
    ancestorTypes: [],
    analysisState,
    scope: "page",
    rootNodeType: "FRAME",
    findAcknowledgment: (nodeId, ruleId) =>
      ackByKey.get(`${nodeId.replace(/-/g, ":")}::${ruleId}`),
    ...overrides,
  };
}

beforeEach(() => {
  analysisState = new Map();
});

describe("unmapped-component", () => {
  it("fires for a COMPONENT when Code Connect is set up", () => {
    const node = makeNode({ id: "10:1", name: "Button", type: "COMPONENT" });
    const result = unmappedComponent.check(node, makeContext(true));
    expect(result).not.toBeNull();
    expect(result?.ruleId).toBe("unmapped-component");
    expect(result?.nodeId).toBe("10:1");
    expect(result?.message).toContain("Button");
    expect(result?.suggestion).toMatch(/canicode-roundtrip/);
  });

  it("fires for a COMPONENT_SET when Code Connect is set up", () => {
    const node = makeNode({ id: "10:2", name: "ButtonVariants", type: "COMPONENT_SET" });
    const result = unmappedComponent.check(node, makeContext(true));
    expect(result).not.toBeNull();
    expect(result?.message).toContain("ButtonVariants");
  });

  it("does NOT fire when Code Connect is not set up (no figma.config.json)", () => {
    const node = makeNode({ id: "10:3", type: "COMPONENT" });
    const result = unmappedComponent.check(node, makeContext(false));
    expect(result).toBeNull();
  });

  it("does NOT fire on FRAME / INSTANCE / other node types", () => {
    for (const type of ["FRAME", "INSTANCE", "RECTANGLE", "TEXT"] as const) {
      const node = makeNode({ id: `20:${type}`, type });
      const result = unmappedComponent.check(node, makeContext(true));
      expect(result, `expected null for type ${type}`).toBeNull();
    }
  });

  it("does NOT fire for a COMPONENT nested inside an INSTANCE", () => {
    const node = makeNode({ id: "30:1", type: "COMPONENT" });
    const ctx = makeContext(true, { ancestorTypes: ["FRAME", "INSTANCE"] });
    const result = unmappedComponent.check(node, ctx);
    expect(result).toBeNull();
  });

  it("does NOT fire for a COMPONENT whose nodeId is in the parsed mapping set (#526 sub-task 1)", () => {
    const node = makeNode({ id: "100:1", name: "Button", type: "COMPONENT" });
    const result = unmappedComponent.check(
      node,
      makeContext(true, undefined, ["100:1"]),
    );
    expect(result).toBeNull();
  });

  it("still fires for a COMPONENT whose nodeId is NOT in the parsed mapping set (#526)", () => {
    const node = makeNode({ id: "100:2", name: "Card", type: "COMPONENT" });
    const result = unmappedComponent.check(
      node,
      makeContext(true, undefined, ["100:1"]),
    );
    expect(result).not.toBeNull();
    expect(result?.nodeId).toBe("100:2");
  });

  it("falls back to v1 behaviour when the parser returns an empty mapping set (degraded mode)", () => {
    const node = makeNode({ id: "100:3", name: "EmptyParse", type: "COMPONENT" });
    const result = unmappedComponent.check(node, makeContext(true, undefined, []));
    expect(result).not.toBeNull();
    expect(result?.nodeId).toBe("100:3");
  });

  it("does NOT fire when an ack with rule-opt-out intent matches the node (#526 sub-task 2 / ADR-022)", () => {
    const node = makeNode({ id: "200:1", name: "Brand Hero", type: "COMPONENT" });
    const result = unmappedComponent.check(
      node,
      makeContext(true, undefined, [], [
        {
          nodeId: "200:1",
          ruleId: "unmapped-component",
          intent: { kind: "rule-opt-out", ruleId: "unmapped-component" },
        },
      ]),
    );
    expect(result).toBeNull();
  });

  it("DOES fire when the ack uses property-style intent (only marks acknowledged elsewhere — not a suppressor)", () => {
    const node = makeNode({ id: "200:2", name: "Brand Hero", type: "COMPONENT" });
    const result = unmappedComponent.check(
      node,
      makeContext(true, undefined, [], [
        {
          nodeId: "200:2",
          ruleId: "unmapped-component",
          intent: { kind: "property", field: "x", value: 1, scope: "instance" },
        },
      ]),
    );
    expect(result).not.toBeNull();
    expect(result?.nodeId).toBe("200:2");
  });

  it("DOES fire when the ack carries rule-opt-out intent for a DIFFERENT ruleId", () => {
    const node = makeNode({ id: "200:3", name: "Brand Hero", type: "COMPONENT" });
    const result = unmappedComponent.check(
      node,
      makeContext(true, undefined, [], [
        {
          nodeId: "200:3",
          // Wrong ruleId on the ack itself — engine still indexes it under
          // its declared ruleId, so findAcknowledgment("…", "unmapped-component")
          // returns undefined and the rule still fires.
          ruleId: "raw-value",
          intent: { kind: "rule-opt-out", ruleId: "unmapped-component" },
        },
      ]),
    );
    expect(result).not.toBeNull();
  });

  it("parser mapping and ack opt-out are independent — either alone suffices", () => {
    // Parser mapping suffices on its own (no ack provided).
    const node = makeNode({ id: "200:4", type: "COMPONENT" });
    const viaParser = unmappedComponent.check(
      node,
      makeContext(true, undefined, ["200:4"]),
    );
    expect(viaParser).toBeNull();

    // Ack opt-out suffices on its own (parser mapping set is empty).
    const node2 = makeNode({ id: "200:5", type: "COMPONENT" });
    const viaAck = unmappedComponent.check(
      node2,
      makeContext(true, undefined, [], [
        {
          nodeId: "200:5",
          ruleId: "unmapped-component",
          intent: { kind: "rule-opt-out", ruleId: "unmapped-component" },
        },
      ]),
    );
    expect(viaAck).toBeNull();
  });

  it("caches the setup detection across calls within one analysis", () => {
    // First call seeds the cache (true). Second call should reuse the cached
    // value even if we mutate the underlying world — proves the per-analysis
    // cache key is honoured rather than re-statting on every node.
    const node = makeNode({ id: "40:1", type: "COMPONENT" });
    const ctx = makeContext(true);
    const first = unmappedComponent.check(node, ctx);
    expect(first).not.toBeNull();

    // Flip the cached value to false; the rule must now skip — proving it
    // reads from `analysisState`, not from a fresh filesystem check.
    ctx.analysisState.set("unmapped-component:setup-detected", false);
    const second = unmappedComponent.check(node, ctx);
    expect(second).toBeNull();
  });
});
