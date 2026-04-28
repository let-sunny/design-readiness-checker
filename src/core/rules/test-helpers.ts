import type { RuleContext } from "../contracts/rule.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

export function makeNode(overrides?: Partial<AnalysisNode>): AnalysisNode {
  return { id: "1:1", name: "TestNode", type: "FRAME", visible: true, ...overrides };
}

export function makeFile(overrides?: Partial<AnalysisFile>): AnalysisFile {
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

export function makeContext(overrides?: Partial<RuleContext>): RuleContext {
  return {
    file: makeFile(),
    depth: 2,
    componentDepth: 0,
    maxDepth: 10,
    path: ["Page", "Section"],
    ancestorTypes: [],
    analysisState: new Map(),
    scope: "page",
    rootNodeType: "FRAME",
    findAcknowledgment: () => undefined,
    ...overrides,
  };
}
