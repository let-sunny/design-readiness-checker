import { GotchaSurveyQuestionSchema } from "../contracts/gotcha-survey.js";

import {
  renderGotchaSection,
  RenderGotchaSectionInputSchema,
} from "./render-gotcha-section.js";

function baseQuestion(
  overrides: Partial<typeof minimumQuestion> = {},
): ReturnType<typeof GotchaSurveyQuestionSchema.parse> {
  return GotchaSurveyQuestionSchema.parse({
    ...minimumQuestion,
    ...overrides,
  });
}

const minimumQuestion = {
  nodeId: "42:99",
  nodeName: "Settings Frame",
  ruleId: "missing-size-constraint",
  detection: "rule-based" as const,
  outputChannel: "annotation" as const,
  persistenceIntent: "durable" as const,
  purpose: "violation" as const,
  severity: "blocking" as const,
  question: "What min/max width should this frame use?",
  hint: "Consider breakpoints.",
  example: "min 320px max 1200px",
  applyStrategy: "annotation" as const,
  isInstanceChild: false,
};

describe("renderGotchaSection", () => {
  const meta = {
    designName: "Settings",
    figmaUrl: "https://figma.com/design/abc/X?node-id=1-2",
    designKey: "abc#1:2",
    designGrade: "B",
    analyzedAt: "2026-04-22T12:00:00.000Z",
    today: "2026-04-22",
  };

  it("copies severity and question verbatim (no label remapping)", () => {
    const q = baseQuestion({
      severity: "missing-info",
      question: "Exact question text from survey JSON.",
    });
    const md = renderGotchaSection({
      questions: [q],
      answers: { "42:99": { answer: "12px" } },
      ...meta,
    });

    expect(md).toContain("- **Severity**: missing-info");
    expect(md).toContain("- **Question**: Exact question text from survey JSON.");
    expect(md).toContain("{{SECTION_NUMBER}}");
    expect(RenderGotchaSectionInputSchema.safeParse({
      questions: [q],
      answers: { "42:99": { answer: "12px" } },
      ...meta,
    }).success).toBe(true);
  });

  it("compacts skipped-only answers into rule counts (#425)", () => {
    const q = baseQuestion();
    const md = renderGotchaSection({
      questions: [q],
      answers: { "42:99": { skipped: true } },
      ...meta,
    });
    expect(md).toContain("#### Skipped (1)");
    expect(md).toContain("`missing-size-constraint` × 1");
    expect(md).not.toContain("- **Answer**: _(skipped)_");
  });

  it("compacts missing answer keys as skipped (#425)", () => {
    const q = baseQuestion();
    const md = renderGotchaSection({
      questions: [q],
      answers: {},
      ...meta,
    });
    expect(md).toContain("#### Skipped (1)");
    expect(md).toContain("`missing-size-constraint` × 1");
  });

  it("aggregates multiple skips by ruleId (#425)", () => {
    const q1 = baseQuestion({ nodeId: "1:1", nodeName: "A" });
    const q2 = baseQuestion({ nodeId: "2:2", nodeName: "B" });
    const q3 = baseQuestion({
      nodeId: "3:3",
      nodeName: "C",
      ruleId: "no-auto-layout",
    });
    const md = renderGotchaSection({
      questions: [q1, q2, q3],
      answers: {
        "1:1": { skipped: true },
        "2:2": { skipped: true },
        "3:3": { skipped: true },
      },
      ...meta,
    });
    expect(md).toContain("#### Skipped (3)");
    expect(md).toContain("`missing-size-constraint` × 2");
    expect(md).toContain("`no-auto-layout` × 1");
  });

  it("renders answered blocks before compact skipped section (#425)", () => {
    const q1 = baseQuestion({ nodeId: "1:1", nodeName: "A" });
    const q2 = baseQuestion({ nodeId: "2:2", nodeName: "B" });
    const md = renderGotchaSection({
      questions: [q1, q2],
      answers: {
        "1:1": { answer: "320px" },
        "2:2": { skipped: true },
      },
      ...meta,
    });
    expect(md).toContain("- **Answer**: 320px");
    expect(md).toContain("#### Skipped (1)");
    const idxAns = md.indexOf("320px");
    const idxSkip = md.indexOf("#### Skipped");
    expect(idxAns).toBeLessThan(idxSkip);
  });

  it("includes instance-context bullet only when question has instanceContext", () => {
    const without = baseQuestion({ nodeId: "1:1", ruleId: "no-auto-layout" });
    const withIc = baseQuestion({
      nodeId: "2:2",
      ruleId: "missing-size-constraint",
      instanceContext: {
        parentInstanceNodeId: "10:10",
        sourceNodeId: "20:20",
        sourceComponentName: "Button",
        sourceComponentId: "30:30",
      },
    });

    const md = renderGotchaSection({
      questions: [without, withIc],
      answers: {
        "1:1": { answer: "a" },
        "2:2": { answer: "b" },
      },
      ...meta,
    });

    const firstBlock = md.split("#### missing-size-constraint — Settings Frame")[0]!;
    expect(firstBlock).not.toContain("**Instance context**");

    expect(md).toContain(
      "- **Instance context**: parent instance `10:10`, source node `20:20`, component `Button` / `30:30`",
    );
  });

  it("preserves question order from the input array", () => {
    const q1 = baseQuestion({ nodeId: "1:1", ruleId: "rule-a", nodeName: "A" });
    const q2 = baseQuestion({ nodeId: "2:2", ruleId: "rule-b", nodeName: "B" });
    const md = renderGotchaSection({
      questions: [q1, q2],
      answers: {
        "1:1": { answer: "x" },
        "2:2": { answer: "y" },
      },
      ...meta,
    });

    const idxA = md.indexOf("#### rule-a — A");
    const idxB = md.indexOf("#### rule-b — B");
    expect(idxA).toBeLessThan(idxB);
  });

  it("keeps {{SECTION_NUMBER}} placeholder for renderUpsertedFile", () => {
    const md = renderGotchaSection({
      questions: [baseQuestion()],
      answers: { "42:99": { answer: "ok" } },
      ...meta,
    });
    expect(md.startsWith("## #{{SECTION_NUMBER}} —")).toBe(true);
  });
});
