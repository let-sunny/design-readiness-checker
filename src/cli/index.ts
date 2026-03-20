#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { config } from "dotenv";
import cac from "cac";

// Load .env file
config();

import { FigmaClient } from "../adapters/figma-client.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import type { AnalysisFile } from "../contracts/figma-node.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";
import { analyzeFile } from "../core/rule-engine.js";
import { calculateScores, formatScoreSummary } from "../core/scoring.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../rules/rule-config.js";
import { ruleRegistry } from "../rules/rule-registry.js";
import { loadCustomRules } from "../rules/custom/custom-rule-loader.js";
import { loadConfigFile, mergeConfigs } from "../rules/custom/config-loader.js";
import { generateHtmlReport } from "../report-html/index.js";
import {
  runCalibration,
  runCalibrationAnalyze,
  runCalibrationEvaluate,
} from "../agents/orchestrator.js";
import { parseMcpMetadataXml } from "../adapters/figma-mcp-adapter.js";

// Import rules to register them
import "../rules/index.js";

const cli = cac("aiready");

type LoadMode = "mcp" | "api" | "auto";

const MAX_NODES_WITHOUT_SCOPE = 500;

/**
 * Find all FRAME/COMPONENT nodes with 50-500 nodes in their subtree,
 * then pick one at random. Used to auto-scope fixture analysis.
 */
function pickRandomScope(root: AnalysisFile["document"]): AnalysisFile["document"] | null {
  const candidates: AnalysisFile["document"][] = [];

  function collect(node: AnalysisFile["document"]): void {
    const isContainer = node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION";
    if (isContainer) {
      const size = countNodes(node);
      if (size >= 50 && size <= 500) {
        candidates.push(node);
      }
    }
    if ("children" in node && node.children) {
      for (const child of node.children) {
        collect(child);
      }
    }
  }

  collect(root);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx] ?? null;
}

function countNodes(node: { children?: readonly unknown[] | undefined }): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child as { children?: readonly unknown[] | undefined });
    }
  }
  return count;
}

interface AnalyzeOptions {
  preset?: Preset;
  output?: string;
  token?: string;
  mcp?: boolean;
  api?: boolean;
  screenshot?: boolean;
  customRules?: string;
  config?: string;
}

function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

interface LoadResult {
  file: AnalysisFile;
  nodeId?: string | undefined;
}

async function loadFile(
  input: string,
  token?: string,
  mode: LoadMode = "auto"
): Promise<LoadResult> {
  if (isJsonFile(input)) {
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log(`Loading from JSON: ${filePath}`);
    return { file: await loadFigmaFileFromJson(filePath) };
  }

  if (isFigmaUrl(input)) {
    const { fileKey, nodeId, fileName } = parseFigmaUrl(input);

    if (mode === "mcp") {
      return loadFromMcp(fileKey, nodeId, fileName);
    }

    if (mode === "api") {
      return loadFromApi(fileKey, nodeId, token);
    }

    // Auto mode: try MCP first, fallback to API
    try {
      console.log("Auto-detecting data source... trying MCP first.");
      return await loadFromMcp(fileKey, nodeId, fileName);
    } catch (mcpError) {
      const mcpMsg = mcpError instanceof Error ? mcpError.message : String(mcpError);
      console.log(`MCP unavailable (${mcpMsg}). Falling back to REST API.`);
      return loadFromApi(fileKey, nodeId, token);
    }
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
}

async function loadFromMcp(
  fileKey: string,
  nodeId: string | undefined,
  fileName: string | undefined
): Promise<LoadResult> {
  console.log(`Loading via MCP: ${fileKey} (node: ${nodeId ?? "root"})`);
  const file = await loadViaMcp(fileKey, nodeId ?? "0:1", fileName);
  return { file, nodeId };
}

async function loadFromApi(
  fileKey: string,
  nodeId: string | undefined,
  token?: string
): Promise<LoadResult> {
  console.log(`Fetching from Figma REST API: ${fileKey}`);
  if (nodeId) {
    console.log(`Target node: ${nodeId}`);
  }

  const figmaToken = token ?? process.env["FIGMA_TOKEN"];
  if (!figmaToken) {
    throw new Error(
      "FIGMA_TOKEN required for REST API mode. Provide --token or set FIGMA_TOKEN env var, or use --mcp instead."
    );
  }

  const client = new FigmaClient({ token: figmaToken });
  const response = await client.getFile(fileKey);
  return {
    file: transformFigmaResponse(fileKey, response),
    nodeId,
  };
}

/**
 * Load Figma data via MCP Desktop bridge (no REST API, no rate limit)
 */
async function loadViaMcp(
  fileKey: string,
  nodeId: string,
  fileName?: string
): Promise<AnalysisFile> {
  // Dynamic import to avoid hard dependency when MCP is not available
  const { execSync } = await import("node:child_process");

  // Call Claude Code CLI to invoke MCP tool and capture the XML output
  // We use a simple approach: write a script that calls the MCP tool
  // Try using the Figma MCP directly via claude CLI
  const result = execSync(
    `claude --print "Use the mcp__figma__get_metadata tool with fileKey=\\"${fileKey}\\" and nodeId=\\"${nodeId.replace(/-/g, ":")}\\" — return ONLY the raw XML output, nothing else."`,
    { encoding: "utf-8", timeout: 120000 }
  );

  // Extract XML from the response (find first < to last >)
  const xmlStart = result.indexOf("<");
  const xmlEnd = result.lastIndexOf(">");
  if (xmlStart === -1 || xmlEnd === -1) {
    throw new Error("MCP did not return valid XML metadata");
  }
  const xml = result.slice(xmlStart, xmlEnd + 1);

  return parseMcpMetadataXml(xml, fileKey, fileName);
}

cli
  .command("analyze <input>", "Analyze a Figma file or JSON fixture")
  .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
  .option("--output <path>", "HTML report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--mcp", "Load via Figma MCP (no FIGMA_TOKEN needed)")
  .option("--api", "Load via Figma REST API (requires FIGMA_TOKEN)")
  .option("--screenshot", "Include screenshot comparison in report (requires ANTHROPIC_API_KEY)")
  .option("--custom-rules <path>", "Path to custom rules JSON file")
  .option("--config <path>", "Path to config JSON file (override rule scores/settings)")
  .example("  aiready analyze https://www.figma.com/design/ABC123/MyDesign")
  .example("  aiready analyze https://www.figma.com/design/ABC123/MyDesign --mcp")
  .example("  aiready analyze https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN")
  .example("  aiready analyze ./fixtures/design.json --output report.html")
  .example("  aiready analyze ./fixtures/design.json --custom-rules ./my-rules.json")
  .example("  aiready analyze ./fixtures/design.json --config ./my-config.json")
  .action(async (input: string, options: AnalyzeOptions) => {
    try {
      // Validate mutually exclusive flags
      if (options.mcp && options.api) {
        throw new Error("Cannot use --mcp and --api together. Choose one.");
      }

      // Validate --screenshot requirements
      if (options.screenshot) {
        const anthropicKey = process.env["ANTHROPIC_API_KEY"];
        if (!anthropicKey) {
          throw new Error(
            "ANTHROPIC_API_KEY required for --screenshot mode. Set it in .env or environment."
          );
        }
        console.log("Screenshot comparison mode enabled (coming soon).\n");
      }

      // Determine load mode
      const mode: LoadMode = options.mcp ? "mcp" : options.api ? "api" : "auto";

      // Load file
      const { file, nodeId } = await loadFile(input, options.token, mode);

      // Scope enforcement for large files
      const totalNodes = countNodes(file.document);
      let effectiveNodeId = nodeId;

      if (!effectiveNodeId && totalNodes > MAX_NODES_WITHOUT_SCOPE) {
        if (isJsonFile(input)) {
          // Fixture: auto-pick a random suitable FRAME
          const picked = pickRandomScope(file.document);
          if (picked) {
            effectiveNodeId = picked.id;
            console.log(`\nAuto-scoped to "${picked.name}" (${picked.id}, ${countNodes(picked)} nodes) — file too large (${totalNodes} nodes) for unscoped analysis.`);
          } else {
            console.warn(`\nWarning: Could not find a suitable scope in fixture. Analyzing all ${totalNodes} nodes.`);
          }
        } else {
          // Figma URL: require explicit node-id
          throw new Error(
            `Too many nodes (${totalNodes}) for unscoped analysis. ` +
            `Max ${MAX_NODES_WITHOUT_SCOPE} nodes without a node-id scope.\n\n` +
            `Add ?node-id=XXX to the Figma URL to target a specific section.\n` +
            `Example: aiready analyze "https://www.figma.com/design/.../MyDesign?node-id=1-234"`
          );
        }
      }
      if (!effectiveNodeId && totalNodes > 100) {
        console.warn(`\nWarning: Analyzing ${totalNodes} nodes without scope. Results may be noisy.`);
        console.warn("Tip: Add ?node-id=XXX to analyze a specific section.\n");
      }

      console.log(`\nAnalyzing: ${file.name}`);
      console.log(`Nodes: ${totalNodes}`);

      // Build rule configs: start from preset or defaults
      let configs: Record<string, RuleConfig> = options.preset
        ? { ...getConfigsWithPreset(options.preset) }
        : { ...RULE_CONFIGS };

      // Load and merge config file overrides
      if (options.config) {
        const configFile = await loadConfigFile(options.config);
        configs = mergeConfigs(configs, configFile);
        console.log(`Config loaded: ${options.config}`);
      }

      // Load and register custom rules
      if (options.customRules) {
        const { rules, configs: customConfigs } = await loadCustomRules(options.customRules);
        for (const rule of rules) {
          ruleRegistry.register(rule);
        }
        configs = { ...configs, ...customConfigs };
        console.log(`Custom rules loaded: ${rules.length} rules from ${options.customRules}`);
      }

      // Build analysis options
      const analyzeOptions = {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(effectiveNodeId && { targetNodeId: effectiveNodeId }),
      };

      // Run analysis
      const result = analyzeFile(file, analyzeOptions);
      console.log(`Nodes: ${result.nodeCount} (max depth: ${result.maxDepth})`);

      // Calculate scores
      const scores = calculateScores(result);

      // Print summary to terminal
      console.log("\n" + "=".repeat(50));
      console.log(formatScoreSummary(scores));
      console.log("=".repeat(50));

      // Generate HTML report
      const now = new Date();
      const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
      const defaultOutput = `reports/${ts}-${file.fileKey}.html`;
      const reportOutput = options.output ?? defaultOutput;
      const outputPath = resolve(reportOutput);
      const outputDir = dirname(outputPath);

      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      const html = generateHtmlReport(file, result, scores);
      await writeFile(outputPath, html, "utf-8");
      console.log(`\nReport saved: ${outputPath}`);

      // Exit with error code if grade is F
      if (scores.overall.grade === "F") {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Internal calibration commands (used by subagents, hidden from user help)
// ============================================

interface CalibrateAnalyzeOptions {
  output?: string;
  token?: string;
  targetNodeId?: string;
}

cli
  .command(
    "calibrate-analyze <input>",
    "Run calibration analysis and output JSON for conversion step"
  )
  .option("--output <path>", "Output JSON path", { default: "logs/calibration/calibration-analysis.json" })
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--target-node-id <nodeId>", "Scope analysis to a specific node")
  .action(async (input: string, options: CalibrateAnalyzeOptions) => {
    try {
      console.log("Running calibration analysis...");

      const calibConfig = {
        input,
        maxConversionNodes: 20,
        samplingStrategy: "top-issues" as const,
        outputPath: "logs/calibration/calibration-report.md",
        ...(options.token && { token: options.token }),
        ...(options.targetNodeId && { targetNodeId: options.targetNodeId }),
      };

      const { analysisOutput, ruleScores, fileKey } =
        await runCalibrationAnalyze(calibConfig);

      const outputData = {
        fileKey,
        fileName: analysisOutput.analysisResult.file.name,
        analyzedAt: analysisOutput.analysisResult.analyzedAt,
        nodeCount: analysisOutput.analysisResult.nodeCount,
        issueCount: analysisOutput.analysisResult.issues.length,
        scoreReport: analysisOutput.scoreReport,
        nodeIssueSummaries: analysisOutput.nodeIssueSummaries,
        ruleScores,
      };

      const outputPath = resolve(options.output ?? "logs/calibration/calibration-analysis.json");
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }
      await writeFile(outputPath, JSON.stringify(outputData, null, 2), "utf-8");

      console.log(`\nAnalysis complete.`);
      console.log(`  Nodes: ${outputData.nodeCount}`);
      console.log(`  Issues: ${outputData.issueCount}`);
      console.log(`  Nodes with issues: ${outputData.nodeIssueSummaries.length}`);
      console.log(`  Grade: ${outputData.scoreReport.overall.grade} (${outputData.scoreReport.overall.percentage}%)`);
      console.log(`\nOutput saved: ${outputPath}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

interface CalibrateEvaluateOptions {
  output?: string;
}

cli
  .command(
    "calibrate-evaluate <analysisJson> <conversionJson>",
    "Evaluate conversion results and generate calibration report"
  )
  .option("--output <path>", "Report output path")
  .action(async (analysisJsonPath: string, conversionJsonPath: string, options: CalibrateEvaluateOptions) => {
    try {
      console.log("Running calibration evaluation...");

      const analysisPath = resolve(analysisJsonPath);
      const conversionPath = resolve(conversionJsonPath);

      if (!existsSync(analysisPath)) {
        throw new Error(`Analysis file not found: ${analysisPath}`);
      }
      if (!existsSync(conversionPath)) {
        throw new Error(`Conversion file not found: ${conversionPath}`);
      }

      const { readFile } = await import("node:fs/promises");
      const analysisData = JSON.parse(await readFile(analysisPath, "utf-8"));
      const conversionData = JSON.parse(await readFile(conversionPath, "utf-8"));

      const { evaluationOutput, tuningOutput, report } = runCalibrationEvaluate(
        analysisData,
        conversionData,
        analysisData.ruleScores
      );

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const defaultCalOutput = `logs/calibration/calibration-${calTs}.md`;
      const outputPath = resolve(options.output ?? defaultCalOutput);
      const calOutputDir = dirname(outputPath);
      if (!existsSync(calOutputDir)) {
        mkdirSync(calOutputDir, { recursive: true });
      }
      await writeFile(outputPath, report, "utf-8");

      const mismatchCounts = {
        overscored: 0,
        underscored: 0,
        "missing-rule": 0,
        validated: 0,
      };
      for (const m of evaluationOutput.mismatches) {
        const key = m.type as keyof typeof mismatchCounts;
        mismatchCounts[key]++;
      }

      console.log(`\nEvaluation complete.`);
      console.log(`  Validated: ${mismatchCounts.validated}`);
      console.log(`  Overscored: ${mismatchCounts.overscored}`);
      console.log(`  Underscored: ${mismatchCounts.underscored}`);
      console.log(`  Missing rules: ${mismatchCounts["missing-rule"]}`);
      console.log(`  Score adjustments proposed: ${tuningOutput.adjustments.length}`);
      console.log(`  New rule proposals: ${tuningOutput.newRuleProposals.length}`);
      console.log(`\nReport saved: ${outputPath}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

interface CalibrateRunOptions {
  output?: string;
  token?: string;
  maxNodes?: number;
  sampling?: string;
}

cli
  .command(
    "calibrate-run <input>",
    "Run full calibration pipeline (analysis-only, conversion via /calibrate-loop)"
  )
  .option("--output <path>", "Markdown report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .option("--max-nodes <count>", "Max nodes to convert", { default: 5 })
  .option("--sampling <strategy>", "Sampling strategy (all | top-issues | random)", { default: "top-issues" })
  .action(async (input: string, options: CalibrateRunOptions) => {
    try {
      const figmaToken = options.token ?? process.env["FIGMA_TOKEN"];

      if (isFigmaUrl(input) && !parseFigmaUrl(input).nodeId) {
        console.warn("\nWarning: No node-id specified. Calibrating entire file may produce noisy results.");
        console.warn("Tip: Add ?node-id=XXX to target a specific section.\n");
      }

      console.log("Running calibration pipeline (analysis-only)...");
      console.log(`  Input: ${input}`);
      console.log(`  Max nodes: ${options.maxNodes ?? 5}`);
      console.log(`  Sampling: ${options.sampling ?? "top-issues"}`);
      console.log("");

      const calNow = new Date();
      const calTs = `${calNow.getFullYear()}-${String(calNow.getMonth() + 1).padStart(2, "0")}-${String(calNow.getDate()).padStart(2, "0")}-${String(calNow.getHours()).padStart(2, "0")}-${String(calNow.getMinutes()).padStart(2, "0")}`;
      const defaultOutput = `logs/calibration/calibration-${calTs}.md`;

      // Stub executor — code conversion is handled by the calibration-converter
      // subagent in /calibrate-loop, not by this CLI command.
      const executor = async (_nodeId: string, _fileKey: string, flaggedRuleIds: string[]) => ({
        generatedCode: `<!-- conversion skipped — use /calibrate-loop for full pipeline -->`,
        difficulty: "moderate" as const,
        notes: "Skipped — CLI runs analysis only. Use /calibrate-loop in Claude Code for full pipeline with code conversion.",
        ruleRelatedStruggles: flaggedRuleIds.map((r) => ({
          ruleId: r,
          description: "Unable to assess — conversion skipped",
          actualImpact: "moderate" as const,
        })),
        uncoveredStruggles: [],
      });

      const result = await runCalibration(
        {
          input,
          maxConversionNodes: options.maxNodes ?? 5,
          samplingStrategy: (options.sampling as "all" | "top-issues" | "random") ?? "top-issues",
          outputPath: options.output ?? defaultOutput,
          ...(figmaToken && { token: figmaToken }),
        },
        executor,
        { enableActivityLog: true }
      );

      if (result.status === "failed") {
        throw new Error(result.error ?? "Calibration pipeline failed");
      }

      console.log("\nCalibration complete (analysis-only).");
      console.log(`  Grade: ${result.scoreReport.overall.grade} (${result.scoreReport.overall.percentage}%)`);
      console.log(`  Nodes with issues: ${result.nodeIssueSummaries.length}`);
      console.log(`  Report: ${result.reportPath}`);
      if (result.logPath) {
        console.log(`  Activity log: ${result.logPath}`);
      }
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

// ============================================
// Utility commands
// ============================================

interface SaveFixtureOptions {
  output?: string;
  mcp?: boolean;
  api?: boolean;
  token?: string;
}

cli
  .command(
    "save-fixture <input>",
    "Save Figma file data as a JSON fixture for offline analysis"
  )
  .option("--output <path>", "Output JSON path (default: fixtures/<filekey>.json)")
  .option("--mcp", "Load via Figma MCP (no FIGMA_TOKEN needed)")
  .option("--api", "Load via Figma REST API (requires FIGMA_TOKEN)")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .example("  aiready save-fixture https://www.figma.com/design/ABC123/MyDesign --mcp")
  .example("  aiready save-fixture https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN")
  .action(async (input: string, options: SaveFixtureOptions) => {
    try {
      if (options.mcp && options.api) {
        throw new Error("Cannot use --mcp and --api together. Choose one.");
      }

      if (isFigmaUrl(input) && !parseFigmaUrl(input).nodeId) {
        console.warn("\nWarning: No node-id specified. Saving entire file as fixture.");
        console.warn("Tip: Add ?node-id=XXX to save a specific section.\n");
      }

      const mode: LoadMode = options.mcp ? "mcp" : options.api ? "api" : "auto";
      const { file } = await loadFile(input, options.token, mode);

      const outputPath = resolve(
        options.output ?? `fixtures/${file.fileKey}.json`
      );
      const outputDir = dirname(outputPath);
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      await writeFile(outputPath, JSON.stringify(file, null, 2), "utf-8");

      console.log(`Fixture saved: ${outputPath}`);
      console.log(`  File: ${file.name}`);
      console.log(`  Nodes: ${countNodes(file.document)}`);
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

cli.help();
cli.version("0.1.0");

cli.parse();
