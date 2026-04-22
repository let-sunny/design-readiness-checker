/**
 * Deterministic rendering of the per-design gotcha section markdown for
 * `.claude/skills/canicode-gotchas/SKILL.md` — see Output Template in that
 * SKILL and ADR-016 / issue #439.
 *
 * Severity, ruleId, nodeId, nodeName, question text, and instanceContext
 * fields are copied verbatim from the survey JSON; only layout bullets are
 * synthesized. `{{SECTION_NUMBER}}` stays literal for `renderUpsertedFile`.
 */
import { z } from "zod";

import {
  GotchaSurveyQuestionSchema,
  type GotchaSurveyQuestion,
} from "../contracts/gotcha-survey.js";

const AnswersMapSchema = z.record(
  z.string(),
  z.union([
    z.object({ answer: z.string() }),
    z.object({ skipped: z.literal(true) }),
  ]),
);

export const RenderGotchaSectionInputSchema = z.object({
  questions: z.array(GotchaSurveyQuestionSchema),
  answers: AnswersMapSchema,
  designName: z.string(),
  figmaUrl: z.string(),
  designKey: z.string(),
  designGrade: z.string(),
  analyzedAt: z.string(),
  /** Local date for the section header (`YYYY-MM-DD`). */
  today: z.string(),
});

export type RenderGotchaSectionInput = z.infer<
  typeof RenderGotchaSectionInputSchema
>;

function isSkippedAnswer(
  nodeId: string,
  answers: RenderGotchaSectionInput["answers"],
): boolean {
  const v = answers[nodeId];
  if (v === undefined) return true;
  if ("skipped" in v && v.skipped === true) return true;
  if ("answer" in v) return false;
  return true;
}

/** Count skips per ruleId — used for compact persisted section (#425). */
function skippedCountsByRule(
  skippedQs: GotchaSurveyQuestion[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const q of skippedQs) {
    m.set(q.ruleId, (m.get(q.ruleId) ?? 0) + 1);
  }
  return m;
}

function renderSkippedCompact(skippedQs: GotchaSurveyQuestion[]): string {
  const n = skippedQs.length;
  const counts = skippedCountsByRule(skippedQs);
  const lines = [`#### Skipped (${n})`, ""];
  const sortedRules = [...counts.keys()].sort((a, b) => a.localeCompare(b));
  for (const ruleId of sortedRules) {
    const c = counts.get(ruleId) ?? 0;
    lines.push(`- \`${ruleId}\` × ${c}`);
  }
  lines.push("");
  return lines.join("\n");
}

function renderInstanceContextBullet(q: GotchaSurveyQuestion): string | null {
  const ic = q.instanceContext;
  if (!ic) return null;

  let componentPart = "";
  if (ic.sourceComponentName !== undefined && ic.sourceComponentId !== undefined) {
    componentPart = `, component \`${ic.sourceComponentName}\` / \`${ic.sourceComponentId}\``;
  } else if (ic.sourceComponentName !== undefined) {
    componentPart = `, component \`${ic.sourceComponentName}\``;
  } else if (ic.sourceComponentId !== undefined) {
    componentPart = `, component \`${ic.sourceComponentId}\``;
  }

  return `- **Instance context**: parent instance \`${ic.parentInstanceNodeId}\`, source node \`${ic.sourceNodeId}\`${componentPart} — roundtrip apply uses this to write on the source definition when instance overrides fail.`;
}

/**
 * Produce Output-Template-shaped markdown with `{{SECTION_NUMBER}}` in the
 * first heading line.
 */
export function renderGotchaSection(raw: RenderGotchaSectionInput): string {
  const input = RenderGotchaSectionInputSchema.parse(raw);

  const header = [
    `## #{{SECTION_NUMBER}} — ${input.designName} — ${input.today}`,
    "",
    `- **Figma URL**: ${input.figmaUrl}`,
    `- **Design key**: ${input.designKey}`,
    `- **Grade**: ${input.designGrade}`,
    `- **Analyzed at**: ${input.analyzedAt}`,
    "",
    "### Gotchas",
    "",
  ].join("\n");

  const answered: GotchaSurveyQuestion[] = [];
  const skippedList: GotchaSurveyQuestion[] = [];
  for (const q of input.questions) {
    if (isSkippedAnswer(q.nodeId, input.answers)) skippedList.push(q);
    else answered.push(q);
  }

  const blocks: string[] = [];
  for (const q of answered) {
    const v = input.answers[q.nodeId];
    if (v === undefined || !("answer" in v)) {
      throw new Error(
        `renderGotchaSection: expected answer for nodeId ${q.nodeId} (answered set)`,
      );
    }
    const answerLine = v.answer;

    const lines: string[] = [
      `#### ${q.ruleId} — ${q.nodeName}`,
      "",
      `- **Severity**: ${q.severity}`,
      `- **Node ID**: ${q.nodeId}`,
    ];

    const icBullet = renderInstanceContextBullet(q);
    if (icBullet !== null) {
      lines.push(icBullet);
    }

    lines.push(
      `- **Question**: ${q.question}`,
      `- **Answer**: ${answerLine}`,
      "",
    );
    blocks.push(lines.join("\n"));
  }

  if (skippedList.length > 0) {
    blocks.push(renderSkippedCompact(skippedList));
  }

  return `${header}${blocks.join("")}`.replace(/\s+$/, "") + "\n";
}
