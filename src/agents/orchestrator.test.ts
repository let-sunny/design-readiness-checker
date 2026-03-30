import type { AnalysisFile } from "../core/contracts/figma-node.js";
import { runCalibrationEvaluate, ENVIRONMENT_NOISE_PATTERNS } from "./orchestrator.js";

// Register rules so RULE_CONFIGS is populated
import "../core/rules/index.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    writeFile: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

const mockFile: AnalysisFile = {
  fileKey: "test-key",
  name: "Test File",
  lastModified: "",
  version: "",
  document: {
    id: "0:0",
    name: "Document",
    type: "DOCUMENT",
    visible: true,
    children: [
      {
        id: "1:1",
        name: "Main Frame",
        type: "FRAME",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 600 },
        children: [
          { id: "1:2", name: "Title", type: "TEXT", visible: true },
          { id: "1:3", name: "Body", type: "TEXT", visible: true },
          { id: "1:4", name: "Footer", type: "FRAME", visible: true },
        ],
      },
      {
        id: "2:1",
        name: "Card Component",
        type: "COMPONENT",
        visible: true,
        absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 250 },
        children: [
          { id: "2:2", name: "Label", type: "TEXT", visible: true },
          { id: "2:3", name: "Value", type: "TEXT", visible: true },
          { id: "2:4", name: "Divider", type: "RECTANGLE", visible: true },
        ],
      },
    ],
  },
  components: {},
  styles: {},
} as unknown as AnalysisFile;

describe("runCalibrationEvaluate", () => {
  it("returns evaluationOutput, tuningOutput, and a report string", () => {
    const analysisJson = {
      nodeIssueSummaries: [
        {
          nodeId: "1:1",
          nodePath: "Page > Frame > Node1",
          totalScore: -10,
          issueCount: 2,
          flaggedRuleIds: ["no-auto-layout", "deep-nesting"],
          severities: ["blocking", "risk"],
        },
        {
          nodeId: "2:1",
          nodePath: "Page > Frame > Node2",
          totalScore: -5,
          issueCount: 1,
          flaggedRuleIds: ["raw-value"],
          severities: ["risk"],
        },
      ],
      scoreReport: {
        overall: { score: 75, maxScore: 100, percentage: 75, grade: "B" as const },
        byCategory: {
          "pixel-critical": {
            category: "pixel-critical" as const,
            score: 70,
            maxScore: 100,
            percentage: 70,
            issueCount: 2,
            uniqueRuleCount: 2,
            weightedIssueCount: 4,
            densityScore: 70,
            diversityScore: 80,
            bySeverity: { blocking: 1, risk: 1, "missing-info": 0, suggestion: 0 },
          },
          "token-management": {
            category: "token-management" as const,
            score: 80,
            maxScore: 100,
            percentage: 80,
            issueCount: 1,
            uniqueRuleCount: 1,
            weightedIssueCount: 2,
            densityScore: 80,
            diversityScore: 85,
            bySeverity: { blocking: 0, risk: 1, "missing-info": 0, suggestion: 0 },
          },
          "code-quality": {
            category: "code-quality" as const,
            score: 100,
            maxScore: 100,
            percentage: 100,
            issueCount: 0,
            uniqueRuleCount: 0,
            weightedIssueCount: 0,
            densityScore: 100,
            diversityScore: 100,
            bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
          },
          semantic: {
            category: "semantic" as const,
            score: 100,
            maxScore: 100,
            percentage: 100,
            issueCount: 0,
            uniqueRuleCount: 0,
            weightedIssueCount: 0,
            densityScore: 100,
            diversityScore: 100,
            bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
          },
          "responsive-critical": {
            category: "responsive-critical" as const,
            score: 100,
            maxScore: 100,
            percentage: 100,
            issueCount: 0,
            uniqueRuleCount: 0,
            weightedIssueCount: 0,
            densityScore: 100,
            diversityScore: 100,
            bySeverity: { blocking: 0, risk: 0, "missing-info": 0, suggestion: 0 },
          },
        },
        summary: {
          totalIssues: 3,
          blocking: 1,
          risk: 2,
          missingInfo: 0,
          suggestion: 0,
          nodeCount: 10,
        },
      },
      fileKey: "test-key",
      fileName: "Test File",
      analyzedAt: "2026-01-01T00:00:00Z",
      nodeCount: 10,
      issueCount: 3,
    };

    const conversionJson = {
      records: [
        {
          nodeId: "1:1",
          nodePath: "Page > Frame > Node1",
          difficulty: "hard",
          ruleRelatedStruggles: [
            {
              ruleId: "no-auto-layout",
              description: "No auto layout caused serious conversion issues",
              actualImpact: "hard",
            },
          ],
          uncoveredStruggles: [
            {
              description: "Complex gradient pattern not covered by rules",
              suggestedCategory: "token-management",
              estimatedImpact: "moderate",
            },
          ],
        },
        {
          nodeId: "2:1",
          nodePath: "Page > Frame > Node2",
          difficulty: "easy",
          ruleRelatedStruggles: [
            {
              ruleId: "raw-value",
              description: "Raw value was trivial to handle",
              actualImpact: "easy",
            },
          ],
          uncoveredStruggles: [],
        },
      ],
      skippedNodeIds: [],
    };

    const ruleScores: Record<string, { score: number; severity: string }> = {
      "no-auto-layout": { score: -12, severity: "blocking" },
      "deep-nesting": { score: -4, severity: "risk" },
      "raw-value": { score: -5, severity: "risk" },
    };

    const result = runCalibrationEvaluate(analysisJson, conversionJson, ruleScores);

    // evaluationOutput should have mismatches and validatedRules
    expect(result.evaluationOutput).toBeDefined();
    expect(result.evaluationOutput.mismatches).toBeDefined();
    expect(Array.isArray(result.evaluationOutput.mismatches)).toBe(true);
    expect(result.evaluationOutput.mismatches.length).toBeGreaterThan(0);
    expect(result.evaluationOutput.validatedRules).toBeDefined();
    expect(Array.isArray(result.evaluationOutput.validatedRules)).toBe(true);

    // tuningOutput should have adjustments and newRuleProposals
    expect(result.tuningOutput).toBeDefined();
    expect(result.tuningOutput.adjustments).toBeDefined();
    expect(Array.isArray(result.tuningOutput.adjustments)).toBe(true);
    expect(result.tuningOutput.newRuleProposals).toBeDefined();
    expect(Array.isArray(result.tuningOutput.newRuleProposals)).toBe(true);

    // Should have at least one new rule proposal from the uncovered struggle
    expect(result.tuningOutput.newRuleProposals.length).toBeGreaterThan(0);

    // report should be a non-empty string containing expected sections
    expect(result.report).toBeDefined();
    expect(typeof result.report).toBe("string");
    expect(result.report.length).toBeGreaterThan(0);
    expect(result.report).toContain("# Calibration Report");
    expect(result.report).toContain("Test File");
    expect(result.report).toContain("test-key");
  });
});

describe("ENVIRONMENT_NOISE_PATTERNS", () => {
  const isNoise = (text: string) =>
    ENVIRONMENT_NOISE_PATTERNS.some(p => p.test(text));

  it("filters font CDN / availability issues", () => {
    expect(isNoise("Google Fonts CDN blocked, causing system font fallback")).toBe(true);
    expect(isNoise("font availability issue in rendering environment")).toBe(true);
    expect(isNoise("font fallback to system sans-serif")).toBe(true);
    expect(isNoise("font loading failed in CI")).toBe(true);
  });

  it("filters retina / DPI / screenshot scaling issues", () => {
    expect(isNoise("Figma screenshot is at 2x retina resolution")).toBe(true);
    expect(isNoise("deviceScaleFactor mismatch between expected and actual")).toBe(true);
    expect(isNoise("screenshot resolution does not match viewport")).toBe(true);
    expect(isNoise("rendering at 72 DPI instead of 144")).toBe(true);
  });

  it("filters network and CI environment issues", () => {
    expect(isNoise("network timeout when fetching external assets")).toBe(true);
    expect(isNoise("CDN blocked in sandbox environment")).toBe(true);
    expect(isNoise("CDN unavailable due to firewall")).toBe(true);
    expect(isNoise("CDN failure during asset fetch")).toBe(true);
    expect(isNoise("CI environment has no display server")).toBe(true);
    expect(isNoise("CI limitation prevents GPU rendering")).toBe(true);
  });

  it("does NOT filter legitimate design issues", () => {
    expect(isNoise("Complex gradient pattern not covered by rules")).toBe(false);
    expect(isNoise("Shadow rendering differs from Figma")).toBe(false);
    expect(isNoise("Border radius inconsistent across components")).toBe(false);
    expect(isNoise("Missing spacing tokens for 12px gap")).toBe(false);
    expect(isNoise("Auto-layout direction ambiguous")).toBe(false);
  });
});
