import { afterEach, beforeEach } from "vitest";
import { probeDefinitionWritability } from "./probe-definition-writability.js";
import {
  createFigmaGlobal,
  installFigmaGlobal,
  uninstallFigmaGlobal,
  type FigmaGlobalMock,
} from "./test-utils.js";
import type { FigmaNode, RoundtripQuestion } from "./types.js";

function makeQuestion(
  overrides: Partial<RoundtripQuestion>,
): RoundtripQuestion {
  return {
    nodeId: "scene-1",
    ruleId: "missing-size-constraint",
    ...overrides,
  };
}

function makeDef(overrides: Partial<FigmaNode>): FigmaNode {
  return {
    id: "def-1",
    name: "DefNode",
    type: "FRAME",
    annotations: [],
    ...overrides,
  };
}

let mock: FigmaGlobalMock;

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("probeDefinitionWritability (#357)", () => {
  it("returns all-zero when no question carries a sourceChildId", async () => {
    mock = createFigmaGlobal();
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: undefined }),
      makeQuestion({ sourceChildId: undefined }),
    ]);
    expect(result).toEqual({
      totalCount: 0,
      unwritableCount: 0,
      unwritableSourceNames: [],
      allUnwritable: false,
      partiallyUnwritable: false,
    });
  });

  it("classifies a local source as writable", async () => {
    mock = createFigmaGlobal({
      nodes: { "def-1": makeDef({ id: "def-1", remote: false }) },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-1" }),
    ]);
    expect(result.totalCount).toBe(1);
    expect(result.unwritableCount).toBe(0);
    expect(result.allUnwritable).toBe(false);
    expect(result.partiallyUnwritable).toBe(false);
  });

  it("classifies a remote source (Experiment 10) as unwritable", async () => {
    mock = createFigmaGlobal({
      nodes: { "def-1": makeDef({ id: "def-1", name: "RemoteCard", remote: true }) },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-1" }),
    ]);
    expect(result.allUnwritable).toBe(true);
    expect(result.unwritableSourceNames).toEqual(["RemoteCard"]);
  });

  // #363 regression: real Plugin API responses point `sourceChildId` at the
  // child node INSIDE the source component (TEXT / FRAME / etc.) — not the
  // component itself. `.remote` is undefined on those types, so a direct
  // `node.remote === true` check would silently classify every candidate as
  // writable. The probe must walk `.parent` up to the containing
  // COMPONENT / COMPONENT_SET and read `.remote` from there.
  it("walks up to the containing COMPONENT to read remote (#363)", async () => {
    const remoteComp = makeDef({
      id: "comp-1",
      name: "RemoteCard",
      type: "COMPONENT",
      remote: true,
    });
    const child: FigmaNode = {
      id: "def-child",
      name: "Title",
      type: "TEXT",
      parent: remoteComp,
    };
    mock = createFigmaGlobal({ nodes: { "def-child": child } });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-child" }),
    ]);
    expect(result.allUnwritable).toBe(true);
    // Source name should reflect the containing component, not the child.
    expect(result.unwritableSourceNames).toEqual(["RemoteCard"]);
  });

  it("walks up through nested non-component frames before checking remote (#363)", async () => {
    const remoteSet = makeDef({
      id: "set-1",
      name: "RemoteSet",
      type: "COMPONENT_SET",
      remote: true,
    });
    const innerFrame: FigmaNode = {
      id: "inner",
      name: "Inner",
      type: "FRAME",
      parent: remoteSet,
    };
    const child: FigmaNode = {
      id: "def-child",
      name: "Caption",
      type: "TEXT",
      parent: innerFrame,
    };
    mock = createFigmaGlobal({ nodes: { "def-child": child } });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-child" }),
    ]);
    expect(result.allUnwritable).toBe(true);
    expect(result.unwritableSourceNames).toEqual(["RemoteSet"]);
  });

  it("classifies a child of a LOCAL component as writable (#363)", async () => {
    const localComp = makeDef({
      id: "comp-1",
      name: "LocalCard",
      type: "COMPONENT",
      remote: false,
    });
    const child: FigmaNode = {
      id: "def-child",
      name: "Title",
      type: "TEXT",
      parent: localComp,
    };
    mock = createFigmaGlobal({ nodes: { "def-child": child } });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-child" }),
    ]);
    expect(result.allUnwritable).toBe(false);
    expect(result.unwritableCount).toBe(0);
  });

  it("treats a node with no containing component as writable (best-effort default)", async () => {
    const child: FigmaNode = {
      id: "def-child",
      name: "Orphan",
      type: "TEXT",
      // No parent chain, no `remote` field — runtime fallback can still catch
      // any throw at write time.
    };
    mock = createFigmaGlobal({ nodes: { "def-child": child } });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-child" }),
    ]);
    expect(result.allUnwritable).toBe(false);
    expect(result.unwritableCount).toBe(0);
  });

  it("classifies an unresolved source (Experiment 11 — null) as unwritable", async () => {
    // Mock returns null for the lookup — same fallback path as
    // applyWithInstanceFallback's "definition === null" branch.
    mock = createFigmaGlobal();
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({
        sourceChildId: "def-missing",
        instanceContext: {
          parentInstanceNodeId: "p:1",
          sourceNodeId: "src:1",
          sourceComponentId: "C:1",
          sourceComponentName: "MissingMaster",
        },
      }),
    ]);
    expect(result.allUnwritable).toBe(true);
    // Falls back to instanceContext.sourceComponentName when the node lookup
    // returned null.
    expect(result.unwritableSourceNames).toEqual(["MissingMaster"]);
  });

  it("reports partially-unwritable when some sources are remote and some local", async () => {
    mock = createFigmaGlobal({
      nodes: {
        "def-local": makeDef({ id: "def-local", name: "Local", remote: false }),
        "def-remote": makeDef({ id: "def-remote", name: "Remote", remote: true }),
      },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-local", nodeId: "s:1" }),
      makeQuestion({ sourceChildId: "def-remote", nodeId: "s:2" }),
    ]);
    expect(result.totalCount).toBe(2);
    expect(result.unwritableCount).toBe(1);
    expect(result.allUnwritable).toBe(false);
    expect(result.partiallyUnwritable).toBe(true);
    expect(result.unwritableSourceNames).toEqual(["Remote"]);
  });

  it("dedupes by sourceChildId so N replicas of one source count once", async () => {
    mock = createFigmaGlobal({
      nodes: { "def-shared": makeDef({ id: "def-shared", remote: true }) },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-shared", nodeId: "s:1" }),
      makeQuestion({ sourceChildId: "def-shared", nodeId: "s:2" }),
      makeQuestion({ sourceChildId: "def-shared", nodeId: "s:3" }),
    ]);
    expect(result.totalCount).toBe(1);
    expect(result.unwritableCount).toBe(1);
    expect(mock.getNodeByIdAsync).toHaveBeenCalledTimes(1);
  });

  it("dedupes unwritable source names so the picker copy doesn't repeat", async () => {
    mock = createFigmaGlobal({
      nodes: {
        "def-1": makeDef({ id: "def-1", name: "SharedRemote", remote: true }),
        "def-2": makeDef({ id: "def-2", name: "SharedRemote", remote: true }),
      },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-1" }),
      makeQuestion({ sourceChildId: "def-2" }),
    ]);
    expect(result.unwritableSourceNames).toEqual(["SharedRemote"]);
  });

  it("ignores questions without sourceChildId in the count", async () => {
    mock = createFigmaGlobal({
      nodes: { "def-1": makeDef({ id: "def-1", remote: true }) },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: undefined, nodeId: "s:1" }),
      makeQuestion({ sourceChildId: "def-1", nodeId: "s:2" }),
      makeQuestion({ sourceChildId: undefined, nodeId: "s:3" }),
    ]);
    expect(result.totalCount).toBe(1);
    expect(result.allUnwritable).toBe(true);
  });

  it("preserves first-seen order in unwritableSourceNames", async () => {
    mock = createFigmaGlobal({
      nodes: {
        "def-a": makeDef({ id: "def-a", name: "Beta", remote: true }),
        "def-b": makeDef({ id: "def-b", name: "Alpha", remote: true }),
      },
    });
    installFigmaGlobal(mock);
    const result = await probeDefinitionWritability([
      makeQuestion({ sourceChildId: "def-a" }),
      makeQuestion({ sourceChildId: "def-b" }),
    ]);
    expect(result.unwritableSourceNames).toEqual(["Beta", "Alpha"]);
  });
});
