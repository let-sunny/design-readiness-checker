import type {
  GotchaSurveyQuestion,
  InstanceContext,
} from "../contracts/gotcha-survey.js";
import type { RuleId } from "../contracts/rule.js";

/**
 * Rules whose answer is uniformly applicable to every member of a batch
 * (e.g. "What min/max width should these layers share?"). When N consecutive
 * questions in the same source-component group share one of these `ruleId`s,
 * the SKILL prompts the user **once** with all node names listed instead of
 * asking the same question N times.
 *
 * Maintained as an exported constant so the SKILL.md prose doesn't have to
 * keep a parallel whitelist in sync — vitest covers each rule's batch
 * behavior here, not in the LLM's prose interpretation. Add a rule here only
 * after confirming its `gotcha-question` text is actually phrased to accept a
 * single shared answer (the FILL-sizing question is, the
 * `non-semantic-name` question is not).
 */
export const BATCHABLE_RULE_IDS = [
  "missing-size-constraint",
  "irregular-spacing",
  "no-auto-layout",
  "fixed-size-in-auto-layout",
] as const satisfies readonly RuleId[];

const BATCHABLE_SET: ReadonlySet<string> = new Set(BATCHABLE_RULE_IDS);

const NO_SOURCE_SENTINEL = "_no-source";

export interface SurveyQuestionBatch {
  ruleId: string;
  /**
   * `true` when every member's answer is uniformly applicable (rule is in
   * `BATCHABLE_RULE_IDS`). The SKILL still emits a single-question prompt
   * when `questions.length === 1`, but the flag stays useful: a batch of one
   * for a batchable rule keeps the prompt template aligned with subsequent
   * batches in the same group.
   */
  batchable: boolean;
  questions: GotchaSurveyQuestion[];
  /**
   * Sum of `max(question.replicas, 1)` across members. Counts the actual
   * Figma scene fan-out so the SKILL can render `N instances` accurately
   * even when one batch member already collapses multiple replicas via the
   * #356 source-component dedupe.
   */
  totalScenes: number;
}

export interface SurveyQuestionGroup {
  /**
   * The shared `instanceContext` for this group, or `null` for the trailing
   * group of non-instance questions. The SKILL emits the "Instance note"
   * header **once** per non-null group instead of once per question (#370).
   */
  instanceContext: InstanceContext | null;
  batches: SurveyQuestionBatch[];
}

export interface GroupedSurvey {
  groups: SurveyQuestionGroup[];
}

/**
 * Pre-process a survey's `questions` array into the shape the
 * `canicode-roundtrip` and `canicode-gotchas` SKILLs need to prompt the user
 * with two UX optimizations baked in:
 *
 * - **#370** — source-component grouping. Consecutive questions sharing the
 *   same `instanceContext.sourceComponentId` go in one group so the SKILL
 *   prints the verbose "Instance note" paragraph once per group instead of
 *   once per question.
 * - **#369** — batch-prompt for repeated identical answers. Within each
 *   group, consecutive questions sharing the same `ruleId` *and* a
 *   batchable answer-shape are collapsed into a single batch so the user
 *   answers `min-width: 320px, max-width: 1200px` once instead of seven
 *   times.
 *
 * Sort key is `(sourceComponentId ?? "_no-source", ruleId, nodeName)`. The
 * sentinel keeps non-instance questions contiguous at the end so they form
 * one trailing `instanceContext: null` group.
 *
 * `gotcha-survey` MCP/CLI returns the result on the `groupedQuestions`
 * field; the SKILL.md files iterate over `groups[].batches[]` directly with
 * no sort/partition logic in prose. See ADR-016.
 */
export function groupAndBatchSurveyQuestions(
  questions: readonly GotchaSurveyQuestion[],
): GroupedSurvey {
  if (questions.length === 0) {
    return { groups: [] };
  }

  const sorted = [...questions].sort(compareQuestions);

  const groups: SurveyQuestionGroup[] = [];
  let currentGroup: SurveyQuestionGroup | null = null;
  let lastGroupKey: string | null = null;

  for (const question of sorted) {
    const groupKey = sourceComponentKey(question);
    if (currentGroup === null || groupKey !== lastGroupKey) {
      currentGroup = {
        instanceContext: question.instanceContext ?? null,
        batches: [],
      };
      groups.push(currentGroup);
      lastGroupKey = groupKey;
    }
    pushIntoBatch(currentGroup, question);
  }

  return { groups };
}

function compareQuestions(
  a: GotchaSurveyQuestion,
  b: GotchaSurveyQuestion,
): number {
  const aKey = sourceComponentKey(a);
  const bKey = sourceComponentKey(b);
  if (aKey !== bKey) {
    if (aKey === NO_SOURCE_SENTINEL) return 1;
    if (bKey === NO_SOURCE_SENTINEL) return -1;
    return aKey.localeCompare(bKey);
  }
  if (a.ruleId !== b.ruleId) return a.ruleId.localeCompare(b.ruleId);
  if (a.nodeName !== b.nodeName) return a.nodeName.localeCompare(b.nodeName);
  return a.nodeId.localeCompare(b.nodeId);
}

function sourceComponentKey(question: GotchaSurveyQuestion): string {
  return question.instanceContext?.sourceComponentId ?? NO_SOURCE_SENTINEL;
}

function pushIntoBatch(
  group: SurveyQuestionGroup,
  question: GotchaSurveyQuestion,
): void {
  const sceneWeight = Math.max(question.replicas ?? 1, 1);
  const isBatchable = BATCHABLE_SET.has(question.ruleId);
  const last = group.batches.at(-1);

  if (
    last !== undefined &&
    last.ruleId === question.ruleId &&
    isBatchable &&
    last.batchable
  ) {
    last.questions.push(question);
    last.totalScenes += sceneWeight;
    return;
  }

  group.batches.push({
    ruleId: question.ruleId,
    batchable: isBatchable,
    questions: [question],
    totalScenes: sceneWeight,
  });
}
