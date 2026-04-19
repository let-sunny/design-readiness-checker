import type { GotchaSurveyQuestion } from "../contracts/gotcha-survey.js";
import {
  BATCHABLE_RULE_IDS,
  groupAndBatchSurveyQuestions,
} from "./group-and-batch-questions.js";

function makeQuestion(
  overrides: Partial<GotchaSurveyQuestion> & {
    nodeId: string;
    ruleId: string;
  },
): GotchaSurveyQuestion {
  return {
    nodeId: overrides.nodeId,
    nodeName: overrides.nodeName ?? `node-${overrides.nodeId}`,
    ruleId: overrides.ruleId,
    severity: overrides.severity ?? "blocking",
    question: overrides.question ?? "What size?",
    hint: overrides.hint ?? "",
    example: overrides.example ?? "",
    applyStrategy: overrides.applyStrategy ?? "annotation",
    isInstanceChild: overrides.isInstanceChild ?? false,
    ...(overrides.instanceContext !== undefined
      ? { instanceContext: overrides.instanceContext }
      : {}),
    ...(overrides.replicas !== undefined ? { replicas: overrides.replicas } : {}),
    ...(overrides.replicaNodeIds !== undefined
      ? { replicaNodeIds: overrides.replicaNodeIds }
      : {}),
    ...(overrides.targetProperty !== undefined
      ? { targetProperty: overrides.targetProperty }
      : {}),
    ...(overrides.sourceChildId !== undefined
      ? { sourceChildId: overrides.sourceChildId }
      : {}),
    ...(overrides.suggestedName !== undefined
      ? { suggestedName: overrides.suggestedName }
      : {}),
  };
}

describe("BATCHABLE_RULE_IDS", () => {
  it("contains the four rule ids whose answer is uniformly applicable across nodes", () => {
    expect(BATCHABLE_RULE_IDS).toEqual([
      "missing-size-constraint",
      "irregular-spacing",
      "no-auto-layout",
      "fixed-size-in-auto-layout",
    ]);
  });

  it("does not list identity-typed rules whose answer differs per node", () => {
    expect(BATCHABLE_RULE_IDS).not.toContain("non-semantic-name");
    expect(BATCHABLE_RULE_IDS).not.toContain("missing-component");
    expect(BATCHABLE_RULE_IDS).not.toContain("non-layout-container");
  });
});

describe("groupAndBatchSurveyQuestions", () => {
  it("returns an empty result for an empty input", () => {
    expect(groupAndBatchSurveyQuestions([])).toEqual({ groups: [] });
  });

  it("groups consecutive questions sharing the same source component (#370)", () => {
    const ctxA = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
      sourceComponentName: "Card",
    };
    const ctxB = {
      parentInstanceNodeId: "p:B",
      sourceNodeId: "src:B",
      sourceComponentId: "comp:B",
      sourceComponentName: "Banner",
    };

    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "1",
        ruleId: "non-semantic-name",
        instanceContext: ctxA,
      }),
      makeQuestion({
        nodeId: "2",
        ruleId: "missing-size-constraint",
        instanceContext: ctxB,
      }),
      makeQuestion({
        nodeId: "3",
        ruleId: "missing-size-constraint",
        instanceContext: ctxA,
      }),
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.instanceContext?.sourceComponentId).toBe("comp:A");
    expect(result.groups[1]?.instanceContext?.sourceComponentId).toBe("comp:B");
    const groupA = result.groups[0]!;
    expect(groupA.batches.flatMap((b) => b.questions.map((q) => q.nodeId))).toEqual([
      "3",
      "1",
    ]);
  });

  it("places non-instance questions in a single trailing group with null instanceContext", () => {
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({ nodeId: "no-1", ruleId: "non-semantic-name" }),
      makeQuestion({
        nodeId: "in-1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
      makeQuestion({ nodeId: "no-2", ruleId: "non-semantic-name" }),
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]?.instanceContext?.sourceComponentId).toBe("comp:A");
    expect(result.groups[1]?.instanceContext).toBeNull();
    expect(
      result.groups[1]?.batches.flatMap((b) => b.questions.map((q) => q.nodeId)),
    ).toEqual(["no-1", "no-2"]);
  });

  it("partitions a group into batches by consecutive ruleId for batchable rules (#369)", () => {
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "1",
        nodeName: "row-1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "2",
        nodeName: "row-2",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "3",
        nodeName: "row-3",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
    ]);

    const group = result.groups[0]!;
    expect(group.batches).toHaveLength(1);
    expect(group.batches[0]?.batchable).toBe(true);
    expect(group.batches[0]?.questions.map((q) => q.nodeId)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(group.batches[0]?.totalScenes).toBe(3);
  });

  it("renders non-batchable rules as batches of one even when ruleId repeats", () => {
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "1",
        ruleId: "non-semantic-name",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "2",
        ruleId: "non-semantic-name",
        instanceContext: ctx,
      }),
    ]);

    const group = result.groups[0]!;
    expect(group.batches).toHaveLength(2);
    expect(group.batches.every((b) => b.batchable === false)).toBe(true);
    expect(group.batches.every((b) => b.questions.length === 1)).toBe(true);
  });

  it("collapses batchable rules together via the (sourceComponentId, ruleId, nodeName) sort even when input order interleaves them", () => {
    // The sort-by-ruleId step is what guarantees batching kicks in — the
    // SKILL doesn't have to send questions in any particular order. Same
    // group + same batchable ruleId always ends up in one batch regardless
    // of how the surveyor laid them out.
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "1",
        nodeName: "row-1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "2",
        ruleId: "non-semantic-name",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "3",
        nodeName: "row-3",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
    ]);

    const group = result.groups[0]!;
    expect(group.batches.map((b) => [b.ruleId, b.questions.length])).toEqual([
      ["missing-size-constraint", 2],
      ["non-semantic-name", 1],
    ]);
    const batchableBatch = group.batches[0]!;
    expect(batchableBatch.questions.map((q) => q.nodeId)).toEqual(["1", "3"]);
  });

  it("sums totalScenes across replicas for #356 cross-instance dedupe", () => {
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
        replicas: 3,
        replicaNodeIds: ["1a", "1b"],
      }),
      makeQuestion({
        nodeId: "2",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
        replicas: 2,
        replicaNodeIds: ["2a"],
      }),
      makeQuestion({
        nodeId: "3",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
    ]);

    const batch = result.groups[0]!.batches[0]!;
    expect(batch.questions).toHaveLength(3);
    expect(batch.totalScenes).toBe(3 + 2 + 1);
  });

  it("sorts inside a group by (ruleId, nodeName, nodeId) so output is stable across runs", () => {
    const ctx = {
      parentInstanceNodeId: "p:A",
      sourceNodeId: "src:A",
      sourceComponentId: "comp:A",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({
        nodeId: "z",
        nodeName: "row-2",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
      makeQuestion({
        nodeId: "a",
        nodeName: "row-1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
    ]);

    const batch = result.groups[0]!.batches[0]!;
    expect(batch.questions.map((q) => q.nodeId)).toEqual(["a", "z"]);
  });

  it("places the no-source group last regardless of ruleId ordering", () => {
    const ctx = {
      parentInstanceNodeId: "p:Z",
      sourceNodeId: "src:Z",
      sourceComponentId: "comp:Z",
    };
    const result = groupAndBatchSurveyQuestions([
      makeQuestion({ nodeId: "no-1", ruleId: "non-semantic-name" }),
      makeQuestion({
        nodeId: "in-1",
        ruleId: "missing-size-constraint",
        instanceContext: ctx,
      }),
    ]);

    expect(result.groups[0]?.instanceContext?.sourceComponentId).toBe("comp:Z");
    expect(result.groups.at(-1)?.instanceContext).toBeNull();
  });
});
