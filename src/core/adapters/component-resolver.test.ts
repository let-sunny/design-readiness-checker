import type { AnalysisNode } from "../contracts/figma-node.js";
import type { FigmaClient } from "./figma-client.js";
import type { GetFileNodesResponse } from "./figma-client.js";
import { collectComponentIds, resolveComponentDefinitions } from "./component-resolver.js";

function makeNode(overrides: Partial<AnalysisNode> & { id: string; name: string; type: AnalysisNode["type"] }): AnalysisNode {
  return { visible: true, ...overrides };
}

describe("collectComponentIds", () => {
  it("gathers unique componentIds from nested INSTANCE nodes", () => {
    const tree = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [
        makeNode({ id: "1", name: "Btn", type: "INSTANCE", componentId: "comp-a" }),
        makeNode({
          id: "2",
          name: "Group",
          type: "GROUP",
          children: [
            makeNode({ id: "3", name: "Btn", type: "INSTANCE", componentId: "comp-b" }),
            makeNode({ id: "4", name: "Btn", type: "INSTANCE", componentId: "comp-a" }),
          ],
        }),
      ],
    });

    const ids = collectComponentIds(tree);

    expect(ids).toEqual(new Set(["comp-a", "comp-b"]));
  });

  it("ignores non-INSTANCE nodes even if they have componentId", () => {
    const tree = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      componentId: "should-ignore",
      children: [
        makeNode({ id: "1", name: "Rect", type: "RECTANGLE" }),
      ],
    });

    const ids = collectComponentIds(tree);

    expect(ids.size).toBe(0);
  });

  it("handles nodes with no children", () => {
    const tree = makeNode({
      id: "root",
      name: "Single",
      type: "INSTANCE",
      componentId: "comp-x",
    });

    const ids = collectComponentIds(tree);

    expect(ids).toEqual(new Set(["comp-x"]));
  });

  it("handles empty children array", () => {
    const tree = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [],
    });

    const ids = collectComponentIds(tree);

    expect(ids.size).toBe(0);
  });

  it("skips INSTANCE nodes without componentId", () => {
    const tree = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [
        makeNode({ id: "1", name: "Broken", type: "INSTANCE" }),
      ],
    });

    const ids = collectComponentIds(tree);

    expect(ids.size).toBe(0);
  });
});

describe("resolveComponentDefinitions", () => {
  it("resolves component masters in two passes", async () => {
    // Document has INSTANCE referencing comp-a
    const document = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [
        makeNode({ id: "1", name: "Btn", type: "INSTANCE", componentId: "comp-a" }),
      ],
    });

    // comp-a's master contains another INSTANCE referencing comp-b
    const compANode: AnalysisNode = makeNode({
      id: "comp-a",
      name: "Button",
      type: "COMPONENT",
      children: [
        makeNode({ id: "inner", name: "Icon", type: "INSTANCE", componentId: "comp-b" }),
      ],
    });

    const compBNode: AnalysisNode = makeNode({
      id: "comp-b",
      name: "Icon",
      type: "COMPONENT",
    });

    const mockClient = {
      getFileNodes: vi.fn().mockImplementation((_fileKey: string, nodeIds: string[]) => {
        const nodes: GetFileNodesResponse["nodes"] = {};
        for (const id of nodeIds) {
          if (id === "comp-a") {
            nodes[id] = {
              document: compANode as unknown as import("@figma/rest-api-spec").Node,
              components: {},
              styles: {},
            };
          } else if (id === "comp-b") {
            nodes[id] = {
              document: compBNode as unknown as import("@figma/rest-api-spec").Node,
              components: {},
              styles: {},
            };
          }
        }
        return Promise.resolve({
          name: "Test",
          lastModified: "2024-01-01",
          version: "1",
          nodes,
        } satisfies GetFileNodesResponse);
      }),
    } as unknown as FigmaClient;

    const result = await resolveComponentDefinitions(mockClient, "file-key", document);

    expect(Object.keys(result)).toEqual(expect.arrayContaining(["comp-a", "comp-b"]));
    expect(result["comp-a"]?.name).toBe("Button");
    expect(result["comp-b"]?.name).toBe("Icon");
    // Pass 1 fetches comp-a, pass 2 fetches comp-b
    expect(mockClient.getFileNodes).toHaveBeenCalledTimes(2);
  });

  it("handles empty document with no instances", async () => {
    const document = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
    });

    const mockClient = {
      getFileNodes: vi.fn(),
    } as unknown as FigmaClient;

    const result = await resolveComponentDefinitions(mockClient, "file-key", document);

    expect(Object.keys(result)).toHaveLength(0);
    expect(mockClient.getFileNodes).not.toHaveBeenCalled();
  });

  it("skips IDs that fail to fetch", async () => {
    const document = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [
        makeNode({ id: "1", name: "Btn", type: "INSTANCE", componentId: "external-comp" }),
      ],
    });

    const mockClient = {
      getFileNodes: vi.fn().mockRejectedValue(new Error("Not found")),
    } as unknown as FigmaClient;

    const result = await resolveComponentDefinitions(mockClient, "file-key", document);

    expect(Object.keys(result)).toHaveLength(0);
  });

  it("respects maxPasses limit", async () => {
    // Deep nesting: doc → comp-a → comp-b → comp-c
    // With maxPasses=1, should only resolve comp-a
    const document = makeNode({
      id: "root",
      name: "Frame",
      type: "FRAME",
      children: [
        makeNode({ id: "1", name: "Btn", type: "INSTANCE", componentId: "comp-a" }),
      ],
    });

    const compANode: AnalysisNode = makeNode({
      id: "comp-a",
      name: "A",
      type: "COMPONENT",
      children: [
        makeNode({ id: "inner-a", name: "Nested", type: "INSTANCE", componentId: "comp-b" }),
      ],
    });

    const mockClient = {
      getFileNodes: vi.fn().mockImplementation((_fileKey: string, nodeIds: string[]) => {
        const nodes: GetFileNodesResponse["nodes"] = {};
        for (const id of nodeIds) {
          if (id === "comp-a") {
            nodes[id] = {
              document: compANode as unknown as import("@figma/rest-api-spec").Node,
              components: {},
              styles: {},
            };
          }
        }
        return Promise.resolve({
          name: "Test",
          lastModified: "2024-01-01",
          version: "1",
          nodes,
        } satisfies GetFileNodesResponse);
      }),
    } as unknown as FigmaClient;

    const result = await resolveComponentDefinitions(mockClient, "file-key", document, 1);

    // Only comp-a resolved, comp-b not fetched due to maxPasses=1
    expect(Object.keys(result)).toEqual(["comp-a"]);
    expect(mockClient.getFileNodes).toHaveBeenCalledTimes(1);
  });
});
