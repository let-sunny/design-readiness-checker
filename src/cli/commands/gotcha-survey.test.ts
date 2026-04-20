import { runGotchaSurvey } from "./gotcha-survey.js";
import { GotchaSurveySchema } from "../../core/contracts/gotcha-survey.js";

const FIXTURE = "fixtures/done/desktop-about";

describe("runGotchaSurvey", () => {
  it("returns a valid GotchaSurvey for a fixture input", async () => {
    const survey = await runGotchaSurvey(FIXTURE, { json: true });

    // Same JSON shape as the MCP `gotcha-survey` tool response
    const parsed = GotchaSurveySchema.parse(survey);
    expect(parsed.designGrade).toMatch(/^(S|A\+|A|B\+|B|C\+|C|D|F)$/);
    expect(typeof parsed.isReadyForCodeGen).toBe("boolean");
    expect(Array.isArray(parsed.questions)).toBe(true);

    // Each question must have the required keys the skills consume
    for (const q of parsed.questions) {
      expect(q).toHaveProperty("nodeId");
      expect(q).toHaveProperty("ruleId");
      expect(q).toHaveProperty("severity");
      expect(q).toHaveProperty("question");
      expect(q).toHaveProperty("applyStrategy");
    }
  });

  it("respects --preset by picking up different configs", async () => {
    const strict = await runGotchaSurvey(FIXTURE, { preset: "strict", json: true });
    const relaxed = await runGotchaSurvey(FIXTURE, { preset: "relaxed", json: true });

    // Both channels produce valid surveys; preset should not crash the pipeline
    expect(GotchaSurveySchema.safeParse(strict).success).toBe(true);
    expect(GotchaSurveySchema.safeParse(relaxed).success).toBe(true);
  });

  it("accepts --scope override and still produces a valid survey (#404)", async () => {
    // Fixture root is COMPONENT → auto-detect would be `component`.
    // Passing `scope: "page"` exercises the same override path the
    // orchestrator uses for calibration runs and must not break the
    // downstream survey pipeline (no rule currently branches on scope,
    // so the question list should remain stable across both overrides).
    const asPage = await runGotchaSurvey(FIXTURE, { scope: "page", json: true });
    const asComponent = await runGotchaSurvey(FIXTURE, { scope: "component", json: true });

    expect(GotchaSurveySchema.safeParse(asPage).success).toBe(true);
    expect(GotchaSurveySchema.safeParse(asComponent).success).toBe(true);
    // Infrastructure-only wiring: both overrides must produce the same
    // set of question ruleIds until a rule in a follow-up PR (#403)
    // actually consumes `ctx.scope`.
    const ruleIds = (s: typeof asPage) => s.questions.map((q) => q.ruleId).sort();
    expect(ruleIds(asPage)).toEqual(ruleIds(asComponent));
  });
});
