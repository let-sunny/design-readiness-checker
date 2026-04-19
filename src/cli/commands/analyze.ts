import { existsSync, mkdirSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { CAC } from "cac";
import { z } from "zod";

import type { RuleConfig, RuleId } from "../../core/contracts/rule.js";
import { analyzeFile } from "../../core/engine/rule-engine.js";
import { loadFile, isJsonFile, isFixtureDir } from "../../core/engine/loader.js";
import {
  AcknowledgmentListSchema,
  type Acknowledgment,
} from "../../core/contracts/acknowledgment.js";
import {
  getFigmaToken, getReportsDir, ensureReportsDir,
} from "../../core/engine/config-store.js";
import { calculateScores, formatScoreSummary, buildResultJson } from "../../core/engine/scoring.js";
import { computeDesignKey } from "../../core/contracts/design-key.js";
import { getConfigsWithPreset, RULE_CONFIGS } from "../../core/rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../../core/rules/config-loader.js";
import { generateHtmlReport } from "../../core/report-html/index.js";
import { trackEvent, trackError, EVENTS } from "../../core/monitoring/index.js";
import { pickRandomScope, countNodes, MAX_NODES_WITHOUT_SCOPE } from "../helpers.js";

const AnalyzeOptionsSchema = z.object({
  preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional(),
  output: z.string().optional(),
  token: z.string().optional(),
  api: z.boolean().optional(),
  screenshot: z.boolean().optional(),
  config: z.string().optional(),
  noOpen: z.boolean().optional(),
  json: z.boolean().optional(),
  acknowledgments: z.string().optional(),
});


export function registerAnalyze(cli: CAC): void {
  cli
    .command("analyze <input>", "Analyze a Figma file or JSON fixture")
    .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
    .option("--output <path>", "HTML report output path")
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--api", "Load via Figma REST API (requires FIGMA_TOKEN)")
    .option("--screenshot", "Include screenshot comparison in report (requires ANTHROPIC_API_KEY)")
    .option("--config <path>", "Path to config JSON file (override rule scores/settings)")
    .option("--no-open", "Don't open report in browser after analysis")
    .option("--json", "Output JSON results to stdout (same format as MCP)")
    .option("--acknowledgments <path>", "(#371) Path to a JSON file containing [{ nodeId, ruleId }] pairs harvested from canicode-authored Figma annotations. Matching issues are flagged acknowledged and contribute half weight to density.")
    .example("  canicode analyze https://www.figma.com/design/ABC123/MyDesign")
    .example("  canicode analyze https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN")
    .example("  canicode analyze ./fixtures/my-design --output report.html")
    .example("  canicode analyze ./fixtures/my-design --config ./my-config.json")
    .action(async (input: string, rawOptions: Record<string, unknown>) => {
      const parseResult = AnalyzeOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        const msg = parseResult.error.issues.map(i => `--${i.path.join(".")}: ${i.message}`).join("\n");
        console.error(`\nInvalid options:\n${msg}`);
        process.exit(1);
      }
      const options = parseResult.data;
      const analysisStart = Date.now();
      trackEvent(EVENTS.ANALYSIS_STARTED, { source: isJsonFile(input) || isFixtureDir(input) ? "fixture" : "figma" });
      // In --json mode, send progress messages to stderr so stdout contains only valid JSON
      const log = options.json ? console.error.bind(console) : console.log.bind(console);
      try {
        // Check init
        if (!options.token && !getFigmaToken() && !isJsonFile(input) && !isFixtureDir(input)) {
          throw new Error(
            "canicode is not configured. Run 'canicode init --token YOUR_TOKEN' first."
          );
        }

        // Validate --screenshot requirements
        if (options.screenshot) {
          const anthropicKey = process.env["ANTHROPIC_API_KEY"];
          if (!anthropicKey) {
            throw new Error(
              "ANTHROPIC_API_KEY required for --screenshot mode. Set it in .env or environment."
            );
          }
          log("Screenshot comparison mode enabled (coming soon).\n");
        }

        // Load file
        const { file, nodeId } = await loadFile(input, options.token);

        // Scope enforcement for large files
        const totalNodes = countNodes(file.document);
        let effectiveNodeId = nodeId;

        if (!effectiveNodeId && totalNodes > MAX_NODES_WITHOUT_SCOPE) {
          if (isJsonFile(input) || isFixtureDir(input)) {
            // Fixture: auto-pick a random suitable FRAME
            const picked = pickRandomScope(file.document);
            if (picked) {
              effectiveNodeId = picked.id;
              log(`\nAuto-scoped to "${picked.name}" (${picked.id}, ${countNodes(picked)} nodes) — file too large (${totalNodes} nodes) for unscoped analysis.`);
            } else {
              console.warn(`\nWarning: Could not find a suitable scope in fixture. Analyzing all ${totalNodes} nodes.`);
            }
          } else {
            // Figma URL: require explicit node-id
            throw new Error(
              `Too many nodes (${totalNodes}) for unscoped analysis. ` +
              `Max ${MAX_NODES_WITHOUT_SCOPE} nodes without a node-id scope.\n\n` +
              `Add ?node-id=XXX to the Figma URL to target a specific section.\n` +
              `Example: canicode analyze "https://www.figma.com/design/.../MyDesign?node-id=1-234"`
            );
          }
        }
        if (!effectiveNodeId && totalNodes > 100) {
          console.warn(`\nWarning: Analyzing ${totalNodes} nodes without scope. Results may be noisy.`);
          console.warn("Tip: Add ?node-id=XXX to analyze a specific section.\n");
        }

        log(`\nAnalyzing: ${file.name}`);
        log(`Nodes: ${totalNodes}`);

        // Build rule configs: start from preset or defaults
        let configs: Record<string, RuleConfig> = options.preset
          ? { ...getConfigsWithPreset(options.preset) }
          : { ...RULE_CONFIGS };

        // Load and merge config file overrides
        let excludeNodeNames: string[] | undefined;
        let excludeNodeTypes: string[] | undefined;

        if (options.config) {
          const configFile = await loadConfigFile(options.config);
          configs = mergeConfigs(configs, configFile);
          excludeNodeNames = configFile.excludeNodeNames;
          excludeNodeTypes = configFile.excludeNodeTypes;
          log(`Config loaded: ${options.config}`);
        }

        let acknowledgments: Acknowledgment[] | undefined;
        if (options.acknowledgments) {
          const ackPath = resolve(options.acknowledgments);
          const raw = await readFile(ackPath, "utf-8");
          const parsed = AcknowledgmentListSchema.safeParse(JSON.parse(raw));
          if (!parsed.success) {
            throw new Error(
              `Invalid --acknowledgments file at ${ackPath}: ${parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`
            );
          }
          acknowledgments = parsed.data;
          log(`Acknowledgments loaded: ${acknowledgments.length} entries from ${ackPath}`);
        }

        // Build analysis options
        const analyzeOptions = {
          configs: configs as Record<RuleId, RuleConfig>,
          ...(effectiveNodeId && { targetNodeId: effectiveNodeId }),
          ...(excludeNodeNames && { excludeNodeNames }),
          ...(excludeNodeTypes && { excludeNodeTypes }),
          ...(acknowledgments && { acknowledgments }),
        };

        // Run analysis
        const result = analyzeFile(file, analyzeOptions);
        log(`Nodes: ${result.nodeCount} (max depth: ${result.maxDepth})`);

        // Calculate scores using the same preset-adjusted configs
        const scores = calculateScores(result, configs as Record<RuleId, RuleConfig>);

        // JSON output mode — only JSON goes to stdout; exit code still applies
        if (options.json) {
          console.log(JSON.stringify(buildResultJson(file.name, result, scores, { fileKey: file.fileKey, designKey: computeDesignKey(input) }), null, 2));
          if (scores.overall.grade === "F") {
            process.exitCode = 1;
          }
          return;
        }

        // Print summary to terminal
        console.log("\n" + "=".repeat(50));
        console.log(formatScoreSummary(scores));
        console.log("=".repeat(50));

        // Generate HTML report
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
        let outputPath: string;

        if (options.output) {
          outputPath = resolve(options.output);
          const outputDir = dirname(outputPath);
          if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
          }
        } else {
          ensureReportsDir();
          outputPath = resolve(getReportsDir(), `report-${ts}-${file.fileKey}.html`);
        }

        const figmaToken = options.token ?? getFigmaToken();
        const html = generateHtmlReport(file, result, scores, { figmaToken });
        await writeFile(outputPath, html, "utf-8");
        console.log(`\nReport saved: ${outputPath}`);

        trackEvent(EVENTS.ANALYSIS_COMPLETED, {
          nodeCount: result.nodeCount,
          issueCount: result.issues.length,
          grade: scores.overall.grade,
          percentage: scores.overall.percentage,
          duration: Date.now() - analysisStart,
        });
        trackEvent(EVENTS.REPORT_GENERATED, { format: "html" });

        // Open in browser unless --no-open
        if (!options.noOpen) {
          const { exec } = await import("node:child_process");
          const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
          exec(`${cmd} "${outputPath}"`);
        }

        // Exit with error code if grade is F
        if (scores.overall.grade === "F") {
          process.exitCode = 1;
        }
      } catch (error) {
        trackError(
          error instanceof Error ? error : new Error(String(error)),
          { command: "analyze", input },
        );
        trackEvent(EVENTS.ANALYSIS_FAILED, {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - analysisStart,
        });
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
