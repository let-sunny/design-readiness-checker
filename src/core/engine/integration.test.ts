import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { analyzeFile } from "./rule-engine.js";
import { calculateScores, buildResultJson } from "./scoring.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import { RULE_CONFIGS } from "../rules/rule-config.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";

// Import rules to register
import "../rules/index.js";

// ─── Fixture-based integration tests ──────────────────────────────────────────

const FIXTURE_DIR = resolve(import.meta.dirname ?? ".", "../../../fixtures/desktop-pricing");

describe("Integration: fixture → analyze → score", () => {
  let file: AnalysisFile;

  beforeAll(async () => {
    const dataPath = resolve(FIXTURE_DIR, "data.json");
    file = await loadFigmaFileFromJson(dataPath);
  });

  it("loads fixture file with expected structure", () => {
    expect(file.fileKey).toBeTruthy();
    expect(file.name).toBeTruthy();
    expect(file.document).toBeDefined();
    expect(file.document.type).toBeTruthy();
  });

  it("analyzes full file and returns issues", () => {
    const result = analyzeFile(file);

    expect(result.nodeCount).toBeGreaterThan(0);
    expect(result.maxDepth).toBeGreaterThan(0);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.failedRules).toEqual([]);
  });

  it("analyzes with targetNodeId scoping", () => {
    // Find a suitable frame in the document
    function findFrame(node: AnalysisNode): AnalysisNode | undefined {
      if (node.type === "FRAME" && node.children && node.children.length > 0) return node;
      for (const child of node.children ?? []) {
        const found = findFrame(child);
        if (found) return found;
      }
      return undefined;
    }

    const frame = findFrame(file.document);
    expect(frame).toBeDefined();

    const scoped = analyzeFile(file, {
      configs: RULE_CONFIGS as Record<RuleId, RuleConfig>,
      targetNodeId: frame!.id,
    });

    expect(scoped.nodeCount).toBeLessThan(analyzeFile(file).nodeCount);
    expect(scoped.nodeCount).toBeGreaterThan(0);
  });

  it("calculates scores with valid structure", () => {
    const result = analyzeFile(file);
    const scores = calculateScores(result);

    expect(scores.overall.percentage).toBeGreaterThanOrEqual(0);
    expect(scores.overall.percentage).toBeLessThanOrEqual(100);
    expect(scores.overall.grade).toMatch(/^(S|A\+|A|B\+|B|C\+|C|D|F)$/);
    expect(scores.overall.score).toBe(scores.overall.percentage);
    expect(scores.overall.maxScore).toBe(100);

    // Exactly 6 categories present
    const categories = Object.keys(scores.byCategory).sort();
    expect(categories).toEqual(
      ["code-quality", "interaction", "minor", "pixel-critical", "responsive-critical", "token-management"],
    );

    // Each category has valid percentages
    for (const cat of Object.values(scores.byCategory)) {
      expect(cat.percentage).toBeGreaterThanOrEqual(5); // SCORE_FLOOR
      expect(cat.percentage).toBeLessThanOrEqual(100);
    }
  });

  it("builds JSON output with expected fields", () => {
    const result = analyzeFile(file);
    const scores = calculateScores(result);
    const json = buildResultJson(file.name, result, scores);

    expect(json["version"]).toBeTruthy();
    expect(json["fileName"]).toBe(file.name);
    expect(json["nodeCount"]).toBeGreaterThan(0);
    expect(json["issueCount"]).toBeGreaterThan(0);
    expect(json["scores"]).toBeDefined();
    expect(json["issuesByRule"]).toBeDefined();
    expect(json["summary"]).toBeTruthy();
  });

  it("issues reference valid rule IDs from config", () => {
    const result = analyzeFile(file);
    const configRuleIds = new Set(Object.keys(RULE_CONFIGS));

    for (const issue of result.issues) {
      expect(configRuleIds.has(issue.violation.ruleId)).toBe(true);
    }
  });

  it("produces deterministic results across multiple runs", () => {
    const result1 = analyzeFile(file);
    const result2 = analyzeFile(file);

    expect(result1.nodeCount).toBe(result2.nodeCount);
    expect(result1.issues.length).toBe(result2.issues.length);
    expect(result1.maxDepth).toBe(result2.maxDepth);

    const scores1 = calculateScores(result1);
    const scores2 = calculateScores(result2);
    expect(scores1.overall.percentage).toBe(scores2.overall.percentage);
    expect(scores1.overall.grade).toBe(scores2.overall.grade);
  });
});
