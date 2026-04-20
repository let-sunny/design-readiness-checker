import { generateGotchaSurvey } from "./survey-generator.js";
import { GotchaSurveySchema } from "../contracts/gotcha-survey.js";
import type { AnalysisIssue, AnalysisResult } from "../engine/rule-engine.js";
import type { ScoreReport } from "../engine/scoring.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import type { Rule, RuleConfig, RuleViolation } from "../contracts/rule.js";
import type { Category } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";
import { CATEGORIES } from "../contracts/category.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: { id: string; category: Category }): Rule {
  return {
    definition: {
      id: overrides.id,
      name: overrides.id,
      category: overrides.category,
      why: "",
      impact: "",
      fix: "",
    },
    check: () => null,
  };
}

function makeConfig(severity: Severity, score = -5): RuleConfig {
  return { severity, score, enabled: true };
}

function makeViolation(
  ruleId: string,
  nodeId: string,
  nodePath: string,
  extra: Partial<RuleViolation> = {},
): RuleViolation {
  return { ruleId, nodeId, nodePath, message: "test", suggestion: "", ...extra };
}

function makeIssue(opts: {
  ruleId: string;
  category: Category;
  severity: Severity;
  nodeId?: string;
  nodePath?: string;
  score?: number;
  subType?: string;
  suggestedName?: string;
}): AnalysisIssue {
  const extra: Partial<RuleViolation> = {};
  if (opts.subType !== undefined) extra.subType = opts.subType;
  if (opts.suggestedName !== undefined) extra.suggestedName = opts.suggestedName;
  return {
    violation: makeViolation(
      opts.ruleId,
      opts.nodeId ?? "1:1",
      opts.nodePath ?? "Root > Node",
      extra,
    ),
    rule: makeRule({ id: opts.ruleId, category: opts.category }),
    config: makeConfig(opts.severity, opts.score ?? -5),
    depth: 0,
    maxDepth: 5,
    calculatedScore: opts.score ?? -5,
  };
}

function makeResult(
  issues: AnalysisIssue[],
  fileOverrides?: {
    document?: AnalysisNode;
    components?: AnalysisFile["components"];
  },
): AnalysisResult {
  const doc: AnalysisNode = fileOverrides?.document ?? {
    id: "0:1",
    name: "Document",
    type: "DOCUMENT",
    visible: true,
  };
  const file: AnalysisFile = {
    fileKey: "test",
    name: "Test",
    lastModified: "",
    version: "1",
    document: doc,
    components: fileOverrides?.components ?? {},
    styles: {},
  };
  return {
    file,
    issues,
    failedRules: [],
    maxDepth: 5,
    nodeCount: 100,
    analyzedAt: new Date().toISOString(),
  };
}

function makeScoreReport(grade: ScoreReport["overall"]["grade"]): ScoreReport {
  const byCategory = Object.fromEntries(
    CATEGORIES.map((c) => [
      c,
      {
        category: c,
        score: 50,
        maxScore: 100,
        percentage: 50,
        issueCount: 0,
        uniqueRuleCount: 0,
        weightedIssueCount: 0,
        densityScore: 100,
        diversityScore: 100,
        bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
      },
    ]),
  ) as ScoreReport["byCategory"];

  return {
    overall: { score: 50, maxScore: 100, percentage: 50, grade },
    byCategory,
    summary: {
      totalIssues: 0,
      blocking: 0,
      risk: 0,
      missingInfo: 0,
      suggestion: 0,
      nodeCount: 100,
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("generateGotchaSurvey", () => {
  it("returns empty questions for zero issues", () => {
    const survey = generateGotchaSurvey(makeResult([]), makeScoreReport("S"));

    expect(survey.questions).toEqual([]);
    expect(survey.designGrade).toBe("S");
    expect(survey.isReadyForCodeGen).toBe(true);
  });

  it("passes the caller-supplied designKey through to the response (#384)", () => {
    const survey = generateGotchaSurvey(
      makeResult([]),
      makeScoreReport("S"),
      { designKey: "abc123XYZ#42:100" },
    );

    expect(survey.designKey).toBe("abc123XYZ#42:100");
  });

  it("falls back to an empty designKey when no options are provided (test ergonomics)", () => {
    const survey = generateGotchaSurvey(makeResult([]), makeScoreReport("S"));
    expect(survey.designKey).toBe("");
  });

  it("includes only blocking and risk severity issues for violation rules", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "2:2",
        nodePath: "Root > Card",
      }),
      makeIssue({
        ruleId: "raw-value",
        category: "token-management",
        severity: "missing-info",
        nodeId: "3:3",
        nodePath: "Root > Label",
      }),
      makeIssue({
        ruleId: "non-semantic-name",
        category: "semantic",
        severity: "suggestion",
        nodeId: "4:4",
        nodePath: "Root > Frame 1",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("C"),
    );

    expect(survey.questions).toHaveLength(2);
    expect(survey.questions.map((q) => q.ruleId)).toEqual([
      "no-auto-layout",
      "fixed-size-in-auto-layout",
    ]);
  });

  it("includes missing-info severity issues from info-collection rules (#406)", () => {
    const issues = [
      makeIssue({
        ruleId: "missing-prototype",
        category: "interaction",
        severity: "missing-info",
        nodeId: "10:1",
        nodePath: "Root > Button",
      }),
      makeIssue({
        ruleId: "missing-interaction-state",
        category: "interaction",
        severity: "missing-info",
        nodeId: "10:2",
        nodePath: "Root > IconButton",
      }),
      makeIssue({
        ruleId: "raw-value",
        category: "token-management",
        severity: "missing-info",
        nodeId: "10:3",
        nodePath: "Root > Label",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("C"),
    );

    const ruleIds = survey.questions.map((q) => q.ruleId);
    expect(ruleIds).toContain("missing-prototype");
    expect(ruleIds).toContain("missing-interaction-state");
    // raw-value is a violation rule — missing-info severity still filtered out.
    expect(ruleIds).not.toContain("raw-value");
  });

  it("tags each question with its rule purpose (#406)", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "11:1",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "missing-prototype",
        category: "interaction",
        severity: "missing-info",
        nodeId: "11:2",
        nodePath: "Root > Hero > CTA",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    const byRule = Object.fromEntries(
      survey.questions.map((q) => [q.ruleId, q.purpose]),
    );
    expect(byRule["no-auto-layout"]).toBe("violation");
    expect(byRule["missing-prototype"]).toBe("info-collection");
  });

  it("places missing-info info-collection questions after risk questions (#406)", () => {
    const issues = [
      makeIssue({
        ruleId: "missing-prototype",
        category: "interaction",
        severity: "missing-info",
        nodeId: "12:1",
        nodePath: "Root > Button",
      }),
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "12:2",
        nodePath: "Root > Card",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions.map((q) => q.severity)).toEqual([
      "risk",
      "missing-info",
    ]);
  });

  it("orders blocking issues before risk issues", () => {
    const issues = [
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "1:1",
        nodePath: "Root > Card",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "2:2",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "missing-size-constraint",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "3:3",
        nodePath: "Root > Banner",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.severity).toBe("blocking");
    expect(survey.questions[1]!.severity).toBe("risk");
    expect(survey.questions[2]!.severity).toBe("risk");
  });

  it("deduplicates same ruleId on sibling nodes (same parent)", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child A",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:2",
        nodePath: "Root > Section > Child B",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:3",
        nodePath: "Root > Section > Child C",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    // 3 siblings with same rule → 1 question
    expect(survey.questions).toHaveLength(1);
    expect(survey.questions[0]!.nodeId).toBe("1:1");
  });

  it("keeps separate questions for same ruleId in different parents", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section A > Child",
      }),
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "2:1",
        nodePath: "Root > Section B > Child",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    expect(survey.questions).toHaveLength(2);
  });

  it("keeps separate questions for different ruleIds on same node", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child",
      }),
      makeIssue({
        ruleId: "non-layout-container",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Child",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("F"),
    );

    expect(survey.questions).toHaveLength(2);
    expect(survey.questions.map((q) => q.ruleId)).toEqual([
      "no-auto-layout",
      "non-layout-container",
    ]);
  });

  it("extracts nodeName from the last segment of nodePath", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Section > Hero Banner",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.nodeName).toBe("Hero Banner");
    expect(survey.questions[0]!.question).toContain("Hero Banner");
  });

  it("substitutes {nodeName} in question text", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > MyFrame",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.question).toBe(
      'Frame "MyFrame" has no Auto Layout. How should this area be laid out?',
    );
  });

  it("surfaces gotcha output-channel metadata on each question (#402)", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > MyFrame",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]).toMatchObject({
      detection: "rule-based",
      outputChannel: "annotation",
      persistenceIntent: "durable",
    });
  });

  it("output passes GotchaSurveySchema validation", () => {
    const issues = [
      makeIssue({
        ruleId: "no-auto-layout",
        category: "pixel-critical",
        severity: "blocking",
        nodeId: "1:1",
        nodePath: "Root > Hero",
      }),
      makeIssue({
        ruleId: "fixed-size-in-auto-layout",
        category: "responsive-critical",
        severity: "risk",
        nodeId: "2:2",
        nodePath: "Root > Card",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("C"),
    );

    const result = GotchaSurveySchema.safeParse(survey);
    expect(result.success).toBe(true);
  });

  describe("instanceContext", () => {
    it("omits instanceContext for non-instance node ids", () => {
      const issues = [
        makeIssue({
          ruleId: "no-auto-layout",
          category: "pixel-critical",
          severity: "blocking",
          nodeId: "1:1",
          nodePath: "Root > Hero",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.instanceContext).toBeUndefined();
    });

    it("resolves source component name when parent instance is in tree", () => {
      const issues = [
        makeIssue({
          ruleId: "no-auto-layout",
          category: "pixel-critical",
          severity: "blocking",
          nodeId: "I348:15903;2153:7840",
          nodePath: "Root > Card > Inner",
        }),
      ];

      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "348:15903",
            name: "Card Instance",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
        ],
      };
      const components = {
        "C:1": { key: "key1", name: "CardComponent", description: "" },
      };

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components }),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.instanceContext).toEqual({
        parentInstanceNodeId: "348:15903",
        sourceNodeId: "2153:7840",
        sourceComponentId: "C:1",
        sourceComponentName: "CardComponent",
      });
    });

    it("falls back to parent/source ids when parent instance not in tree", () => {
      const issues = [
        makeIssue({
          ruleId: "no-auto-layout",
          category: "pixel-critical",
          severity: "blocking",
          nodeId: "I348:15903;2153:7840",
          nodePath: "Root > Hero",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.instanceContext).toEqual({
        parentInstanceNodeId: "348:15903",
        sourceNodeId: "2153:7840",
      });
    });

    it("output with instanceContext passes GotchaSurveySchema validation", () => {
      const issues = [
        makeIssue({
          ruleId: "no-auto-layout",
          category: "pixel-critical",
          severity: "blocking",
          nodeId: "I348:15903;2153:7840",
          nodePath: "Root > Hero",
        }),
      ];

      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "348:15903",
            name: "Card Instance",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
        ],
      };
      const components = {
        "C:1": { key: "key1", name: "CardComponent", description: "" },
      };

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components }),
        makeScoreReport("D"),
      );

      const result = GotchaSurveySchema.safeParse(survey);
      expect(result.success).toBe(true);
    });
  });

  describe("applyStrategy and targetProperty", () => {
    it("property-mod rule carries strategy and target property", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > Banner",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.applyStrategy).toBe("property-mod");
      // #374: missing-size-constraint always returns both bounds so the
      // `{ minWidth, maxWidth }` answer shape lands fully.
      expect(survey.questions[0]!.targetProperty).toEqual([
        "minWidth",
        "maxWidth",
      ]);
    });

    it("structural-mod rule carries strategy without targetProperty for deep-nesting", () => {
      const issues = [
        makeIssue({
          ruleId: "deep-nesting",
          category: "code-quality",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > DeepWrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.applyStrategy).toBe("structural-mod");
      expect(survey.questions[0]!.targetProperty).toBeUndefined();
    });

    it("annotation rule carries annotation strategy", () => {
      const issues = [
        makeIssue({
          ruleId: "absolute-position-in-auto-layout",
          category: "pixel-critical",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > Float",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.applyStrategy).toBe("annotation");
      expect(survey.questions[0]!.targetProperty).toBeUndefined();
    });
  });

  describe("annotationProperties", () => {
    it("carries subType-aware hint for irregular-spacing gap → itemSpacing", () => {
      const issues = [
        makeIssue({
          ruleId: "irregular-spacing",
          category: "token-management",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > Row",
          subType: "gap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.annotationProperties).toEqual([
        { type: "itemSpacing" },
      ]);
    });

    it("carries default hint for missing-size-constraint with any subType", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > Banner",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.annotationProperties).toEqual([
        { type: "width" },
        { type: "height" },
      ]);
    });

    it("omits annotationProperties for rules with no mapping", () => {
      // deep-nesting has no annotation-properties entry.
      const issues = [
        makeIssue({
          ruleId: "deep-nesting",
          category: "code-quality",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > DeepWrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect("annotationProperties" in survey.questions[0]!).toBe(false);
    });
  });

  describe("isInstanceChild and sourceChildId", () => {
    it("flat instance-child id derives sourceChildId from last segment", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I175:8312;2299:23057",
          nodePath: "Root > Card > Inner",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.isInstanceChild).toBe(true);
      expect(survey.questions[0]!.sourceChildId).toBe("2299:23057");
    });

    it("plain scene id sets isInstanceChild=false and omits sourceChildId", () => {
      const issues = [
        makeIssue({
          ruleId: "no-auto-layout",
          category: "pixel-critical",
          severity: "blocking",
          nodeId: "1:1",
          nodePath: "Root > Hero",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      expect(survey.questions[0]!.isInstanceChild).toBe(false);
      expect(survey.questions[0]!.sourceChildId).toBeUndefined();
    });
  });

  it("passes suggestedName through to the survey question", () => {
    // Survey only covers blocking/risk rules — naming rules are semantic suggestion
    // so exercise the pass-through with a semantic rule elevated to risk severity.
    const issues = [
      makeIssue({
        ruleId: "non-semantic-name",
        category: "semantic",
        severity: "risk",
        nodeId: "1:1",
        nodePath: "Root > Frame 1",
        suggestedName: "HeroSection",
      }),
    ];

    const survey = generateGotchaSurvey(
      makeResult(issues),
      makeScoreReport("D"),
    );

    expect(survey.questions[0]!.suggestedName).toBe("HeroSection");
  });

  it("sets isReadyForCodeGen based on grade", () => {
    const empty = makeResult([]);

    const sGrade = generateGotchaSurvey(empty, makeScoreReport("S"));
    expect(sGrade.isReadyForCodeGen).toBe(true);

    const aGrade = generateGotchaSurvey(empty, makeScoreReport("A"));
    expect(aGrade.isReadyForCodeGen).toBe(true);

    const cGrade = generateGotchaSurvey(empty, makeScoreReport("C"));
    expect(cGrade.isReadyForCodeGen).toBe(false);

    const fGrade = generateGotchaSurvey(empty, makeScoreReport("F"));
    expect(fGrade.isReadyForCodeGen).toBe(false);
  });

  // ============================================
  // #356 source-component dedupe
  // ============================================

  describe("source-component dedupe (#356)", () => {
    // Two parent-instance ids of the same source component (`C:1` →
    // `Platform=Desktop`), each with the same definition node `2143:13799` as
    // an instance child. Pre-#356 this surfaced as 2 separate questions; the
    // new pass collapses them into 1 with `replicas: 2`.
    const PLATFORM_DESKTOP_DOC: AnalysisNode = {
      id: "0:1",
      name: "Document",
      type: "DOCUMENT",
      visible: true,
      children: [
        {
          id: "100:1",
          name: "Card Instance A",
          type: "INSTANCE",
          visible: true,
          componentId: "C:1",
        },
        {
          id: "100:2",
          name: "Card Instance B",
          type: "INSTANCE",
          visible: true,
          componentId: "C:1",
        },
      ],
    };
    const PLATFORM_DESKTOP_COMPONENTS = {
      "C:1": { key: "k1", name: "Platform=Desktop", description: "" },
    };

    it("collapses N instance-child questions sharing (sourceComponentId, sourceNodeId, ruleId) into one with replicas", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, {
          document: PLATFORM_DESKTOP_DOC,
          components: PLATFORM_DESKTOP_COMPONENTS,
        }),
        makeScoreReport("D"),
      );

      expect(survey.questions).toHaveLength(1);
      const q = survey.questions[0]!;
      expect(q.nodeId).toBe("I100:1;2143:13799");
      expect(q.replicas).toBe(2);
      expect(q.replicaNodeIds).toEqual(["I100:2;2143:13799"]);
      expect(q.nodeName).toBe("Platform=Desktop");
    });

    it("keeps separate questions for different sourceNodeIds even when sharing the same source component", () => {
      // Different children of the source component (Title vs Input) — same
      // sourceComponentId C:1 but different sourceNodeIds → dedupe key
      // differs, both kept. Use different parent paths (Card A vs Card B) so
      // the EXISTING Step 2 sibling dedupe doesn't collapse them first.
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:99999",
          nodePath: "Root > Card B > Input",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, {
          document: PLATFORM_DESKTOP_DOC,
          components: PLATFORM_DESKTOP_COMPONENTS,
        }),
        makeScoreReport("D"),
      );

      expect(survey.questions).toHaveLength(2);
      expect(survey.questions[0]!.replicas).toBeUndefined();
      expect(survey.questions[1]!.replicas).toBeUndefined();
    });

    it("keeps separate questions when source components differ (no cross-component dedupe)", () => {
      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "100:1",
            name: "Card A",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
          {
            id: "200:1",
            name: "Card B",
            type: "INSTANCE",
            visible: true,
            componentId: "C:2",
          },
        ],
      };
      const components = {
        "C:1": { key: "k1", name: "Platform=Desktop", description: "" },
        "C:2": { key: "k2", name: "Platform=Mobile", description: "" },
      };
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I200:1;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components }),
        makeScoreReport("D"),
      );

      // Different sourceComponentIds — must stay separate per #356 out-of-scope.
      expect(survey.questions).toHaveLength(2);
      expect(survey.questions[0]!.replicas).toBeUndefined();
      expect(survey.questions[1]!.replicas).toBeUndefined();
    });

    it("does not collapse non-instance-child questions (no instanceContext)", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "1:1",
          nodePath: "Root > A",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "1:2",
          nodePath: "Other > B",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues),
        makeScoreReport("D"),
      );

      // Non-instance-child issues with different parent-paths → both kept,
      // neither carries replicas (existing parent-path dedupe already handles
      // same-parent siblings — covered by the older test above).
      expect(survey.questions).toHaveLength(2);
      expect(survey.questions[0]!.replicas).toBeUndefined();
      expect(survey.questions[1]!.replicas).toBeUndefined();
    });

    it("preserves the kept question's first nodeId so apply step targets a real node", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, {
          document: PLATFORM_DESKTOP_DOC,
          components: PLATFORM_DESKTOP_COMPONENTS,
        }),
        makeScoreReport("D"),
      );

      const q = survey.questions[0]!;
      // Apply iteration set: `[nodeId, ...replicaNodeIds]` should cover both.
      const allTargets = [q.nodeId, ...(q.replicaNodeIds ?? [])];
      expect(allTargets).toEqual(["I100:1;2143:13799", "I100:2;2143:13799"]);
    });

    it("rebuilds question text with the source component name when {nodeName} placeholder is used", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, {
          document: PLATFORM_DESKTOP_DOC,
          components: PLATFORM_DESKTOP_COMPONENTS,
        }),
        makeScoreReport("D"),
      );

      // The question template carries `{nodeName}` so the user-facing text
      // must read the source component name, not the first instance's name.
      const q = survey.questions[0]!;
      expect(q.question).toContain("Platform=Desktop");
      expect(q.question).not.toContain("Title");
    });

    it("falls back to first-instance nodeName when source component name is unresolved", () => {
      // Same dedup key (parent instances both reference C:1) but no entry
      // in `file.components` for C:1 → sourceComponentName is undefined.
      // Replicas still merge but the kept nodeName/question pass through.
      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "100:1",
            name: "A",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
          {
            id: "100:2",
            name: "B",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
        ],
      };
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components: {} }),
        makeScoreReport("D"),
      );

      expect(survey.questions).toHaveLength(1);
      const q = survey.questions[0]!;
      expect(q.replicas).toBe(2);
      expect(q.nodeName).toBe("Title");
    });

    // #373 regression: pre-fix the parent-path sibling dedupe ran BEFORE
    // source-component dedupe and dropped instance-child siblings (e.g.
    // `Title` + `Subtitle` on the same `Card` instance — different
    // sourceNodeIds but the same parent path) without preserving them on
    // `replicaNodeIds`. The dropped scenes received neither a write nor an
    // annotation. The fix routes instance-child issues straight to the
    // source-component dedupe; siblings with different sourceNodeIds now
    // remain separate questions and siblings sharing the same sourceNodeId
    // (the cross-instance dedupe target) collapse with replicaNodeIds.
    it("does NOT collapse instance-child siblings with different sourceNodeIds (#373)", () => {
      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "100:1",
            name: "Card",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
        ],
      };
      const components = {
        "C:1": { key: "k1", name: "Card", description: "" },
      };
      const issues = [
        // Two siblings on the SAME parent instance (same parent path "Root >
        // Card") but different definition node ids → must stay separate per
        // #373.
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:99999",
          nodePath: "Root > Card > Subtitle",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components }),
        makeScoreReport("D"),
      );

      expect(survey.questions).toHaveLength(2);
      expect(survey.questions[0]!.replicas).toBeUndefined();
      expect(survey.questions[1]!.replicas).toBeUndefined();
    });

    it("collapses instance-child issues across instances even when on different scene parents (#373)", () => {
      // Pre-fix the sibling dedupe could have dropped same-source siblings
      // before source-dedupe saw them. Now source-dedupe owns it: same
      // sourceComponentId + sourceNodeId + ruleId → one question with the
      // others on `replicaNodeIds`.
      const document: AnalysisNode = {
        id: "0:1",
        name: "Document",
        type: "DOCUMENT",
        visible: true,
        children: [
          {
            id: "100:1",
            name: "Card A",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
          {
            id: "100:2",
            name: "Card B",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
          {
            id: "100:3",
            name: "Card C",
            type: "INSTANCE",
            visible: true,
            componentId: "C:1",
          },
        ],
      };
      const components = {
        "C:1": { key: "k1", name: "Platform=Desktop", description: "" },
      };
      // Three instances of the same source component each render two source
      // children that fail the same rule (Title at 2143:13799 and Subtitle
      // at 2143:99999). Pre-#373 sibling dedupe dropped one of each pair;
      // now source-dedupe collapses the three Title issues and the three
      // Subtitle issues into two questions each carrying replicaNodeIds.
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:99999",
          nodePath: "Root > Card A > Subtitle",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:99999",
          nodePath: "Root > Card B > Subtitle",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:3;2143:13799",
          nodePath: "Root > Card C > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:3;2143:99999",
          nodePath: "Root > Card C > Subtitle",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, { document, components }),
        makeScoreReport("D"),
      );

      expect(survey.questions).toHaveLength(2);
      const titleQ = survey.questions.find(
        (q) => q.nodeId === "I100:1;2143:13799",
      )!;
      const subtitleQ = survey.questions.find(
        (q) => q.nodeId === "I100:1;2143:99999",
      )!;
      expect(titleQ.replicas).toBe(3);
      expect(titleQ.replicaNodeIds).toEqual([
        "I100:2;2143:13799",
        "I100:3;2143:13799",
      ]);
      expect(subtitleQ.replicas).toBe(3);
      expect(subtitleQ.replicaNodeIds).toEqual([
        "I100:2;2143:99999",
        "I100:3;2143:99999",
      ]);
    });

    it("output with replicas + replicaNodeIds passes GotchaSurveySchema validation", () => {
      const issues = [
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:1;2143:13799",
          nodePath: "Root > Card A > Title",
          subType: "wrap",
        }),
        makeIssue({
          ruleId: "missing-size-constraint",
          category: "responsive-critical",
          severity: "risk",
          nodeId: "I100:2;2143:13799",
          nodePath: "Root > Card B > Title",
          subType: "wrap",
        }),
      ];

      const survey = generateGotchaSurvey(
        makeResult(issues, {
          document: PLATFORM_DESKTOP_DOC,
          components: PLATFORM_DESKTOP_COMPONENTS,
        }),
        makeScoreReport("D"),
      );

      const result = GotchaSurveySchema.safeParse(survey);
      expect(result.success).toBe(true);
    });
  });
});
