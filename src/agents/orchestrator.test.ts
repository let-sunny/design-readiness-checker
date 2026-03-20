import type { AnalysisFile } from "@/contracts/figma-node.js";
import type { AnalysisResult, AnalysisIssue } from "@/core/rule-engine.js";
import type { ConversionExecutor, ConversionExecutorResult } from "./contracts/conversion-agent.js";
import { runCalibration, runCalibrationEvaluate } from "./orchestrator.js";

// Register rules so RULE_CONFIGS is populated
import "@/rules/index.js";

import * as figmaFileLoader from "@/adapters/figma-file-loader.js";
import * as ruleEngine from "@/core/rule-engine.js";

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

function createMockIssue(overrides: {
  nodeId: string;
  ruleId: string;
  severity?: string;
  category?: string;
  calculatedScore?: number;
  nodePath?: string;
  configScore?: number;
}): AnalysisIssue {
  return {
    violation: {
      ruleId: overrides.ruleId,
      nodeId: overrides.nodeId,
      nodePath: overrides.nodePath ?? `Page > Frame > ${overrides.nodeId}`,
      message: `Issue from ${overrides.ruleId}`,
    },
    rule: {
      definition: {
        id: overrides.ruleId,
        name: `Rule ${overrides.ruleId}`,
        category: overrides.category ?? "layout",
        why: "test reason",
        impact: "test impact",
        fix: "test fix",
      },
      check: () => null,
    },
    config: {
      severity: overrides.severity ?? "risk",
      score: overrides.configScore ?? -5,
      enabled: true,
    },
    depth: 2,
    maxDepth: 5,
    calculatedScore: overrides.calculatedScore ?? -3,
  } as unknown as AnalysisIssue;
}

function createMockAnalysisResult(issues: AnalysisIssue[]): AnalysisResult {
  return {
    file: mockFile,
    issues,
    maxDepth: 5,
    nodeCount: 10,
    analyzedAt: "2026-01-01T00:00:00Z",
  };
}

function makeExecutorResult(
  overrides: Partial<ConversionExecutorResult> = {}
): ConversionExecutorResult {
  return {
    generatedCode: "<div>converted</div>",
    difficulty: "moderate",
    notes: "some notes",
    ruleRelatedStruggles: [],
    uncoveredStruggles: [],
    ...overrides,
  };
}

describe("runCalibration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("completes the full pipeline and returns all populated outputs", async () => {
    const mockIssues = [
      createMockIssue({
        nodeId: "1:1",
        ruleId: "no-auto-layout",
        severity: "blocking",
        category: "layout",
        calculatedScore: -12,
        configScore: -12,
      }),
      createMockIssue({
        nodeId: "1:1",
        ruleId: "deep-nesting",
        severity: "risk",
        category: "layout",
        calculatedScore: -4,
        configScore: -4,
      }),
      createMockIssue({
        nodeId: "2:1",
        ruleId: "raw-color",
        severity: "risk",
        category: "token",
        calculatedScore: -5,
        configScore: -5,
        nodePath: "Page > Frame > 2:1",
      }),
    ];

    const mockAnalysisResult = createMockAnalysisResult(mockIssues);

    vi.spyOn(figmaFileLoader, "loadFigmaFileFromJson").mockResolvedValue(mockFile);
    vi.spyOn(ruleEngine, "analyzeFile").mockReturnValue(mockAnalysisResult);

    const executor: ConversionExecutor = vi
      .fn<ConversionExecutor>()
      .mockImplementation(async (nodeId) => {
        if (nodeId === "1:1") {
          return makeExecutorResult({
            difficulty: "hard",
            ruleRelatedStruggles: [
              {
                ruleId: "no-auto-layout",
                description: "No auto layout made conversion very hard",
                actualImpact: "hard",
              },
            ],
            uncoveredStruggles: [],
          });
        }
        return makeExecutorResult({
          difficulty: "easy",
          ruleRelatedStruggles: [
            {
              ruleId: "raw-color",
              description: "Raw color was easy to handle",
              actualImpact: "easy",
            },
          ],
          uncoveredStruggles: [],
        });
      });

    const result = await runCalibration(
      {
        input: "test-fixture.json",
        maxConversionNodes: 10,
        samplingStrategy: "top-issues",
        outputPath: "test-report.md",
      },
      executor
    );

    expect(result.status).toBe("completed");
    expect(result.scoreReport).toBeDefined();
    expect(result.scoreReport.overall).toBeDefined();
    expect(result.scoreReport.overall.percentage).toBeGreaterThanOrEqual(0);
    expect(result.nodeIssueSummaries.length).toBeGreaterThan(0);
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.reportPath).toContain("test-report.md");
    expect(result.error).toBeUndefined();

    // Verify that the pipeline exercised all steps
    expect(figmaFileLoader.loadFigmaFileFromJson).toHaveBeenCalledTimes(1);
    expect(ruleEngine.analyzeFile).toHaveBeenCalledTimes(1);
    expect(executor).toHaveBeenCalled();
  });

  it("returns failed status when input is invalid", async () => {
    const executor: ConversionExecutor = vi.fn<ConversionExecutor>();

    const result = await runCalibration(
      {
        input: "not-a-json-or-url",
        maxConversionNodes: 10,
        samplingStrategy: "all",
        outputPath: "output.md",
      },
      executor
    );

    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid input");
    expect(result.scoreReport.overall.score).toBe(0);
    expect(result.nodeIssueSummaries).toEqual([]);
    expect(result.mismatches).toEqual([]);
    expect(result.validatedRules).toEqual([]);
    expect(result.adjustments).toEqual([]);
    expect(result.newRuleProposals).toEqual([]);
    expect(executor).not.toHaveBeenCalled();
  });
});

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
          flaggedRuleIds: ["raw-color"],
          severities: ["risk"],
        },
      ],
      scoreReport: {
        overall: { score: 75, maxScore: 100, percentage: 75, grade: "B" as const },
        byCategory: {
          layout: {
            category: "layout" as const,
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
          token: {
            category: "token" as const,
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
          component: {
            category: "component" as const,
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
          naming: {
            category: "naming" as const,
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
          "ai-readability": {
            category: "ai-readability" as const,
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
          "handoff-risk": {
            category: "handoff-risk" as const,
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
              suggestedCategory: "token",
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
              ruleId: "raw-color",
              description: "Raw color was trivial to handle",
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
      "raw-color": { score: -5, severity: "risk" },
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
