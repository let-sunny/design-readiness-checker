import type { CAC } from "cac";
import { z } from "zod";

import type { RuleConfig, RuleId } from "../../core/contracts/rule.js";
import type { GotchaSurvey } from "../../core/contracts/gotcha-survey.js";
import { analyzeFile } from "../../core/engine/rule-engine.js";
import { loadFile, isJsonFile, isFixtureDir } from "../../core/engine/loader.js";
import { getFigmaToken } from "../../core/engine/config-store.js";
import { calculateScores } from "../../core/engine/scoring.js";
import { generateGotchaSurvey } from "../../core/gotcha/survey-generator.js";
import { computeDesignKey } from "../../core/contracts/design-key.js";
import { getConfigsWithPreset, RULE_CONFIGS } from "../../core/rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../../core/rules/config-loader.js";
import { trackEvent, trackError, EVENTS } from "../../core/monitoring/index.js";

const GotchaSurveyOptionsSchema = z.object({
  preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional(),
  token: z.string().optional(),
  config: z.string().optional(),
  targetNodeId: z.string().optional(),
  json: z.boolean().optional(),
});

export type GotchaSurveyOptions = z.infer<typeof GotchaSurveyOptionsSchema>;

/**
 * Run the gotcha-survey pipeline against a Figma URL or fixture and return
 * the survey JSON. Mirrors the MCP `gotcha-survey` tool call sequence so both
 * channels produce the same `GotchaSurvey` object.
 */
export async function runGotchaSurvey(
  input: string,
  options: GotchaSurveyOptions,
): Promise<GotchaSurvey> {
  const { file, nodeId } = await loadFile(input, options.token);
  const effectiveNodeId = options.targetNodeId ?? nodeId;

  let configs: Record<string, RuleConfig> = options.preset
    ? { ...getConfigsWithPreset(options.preset) }
    : { ...RULE_CONFIGS };

  if (options.config) {
    const configFile = await loadConfigFile(options.config);
    configs = mergeConfigs(configs, configFile);
  }

  const result = analyzeFile(file, {
    configs: configs as Record<RuleId, RuleConfig>,
    ...(effectiveNodeId ? { targetNodeId: effectiveNodeId } : {}),
  });

  const scores = calculateScores(result, configs as Record<RuleId, RuleConfig>);
  return generateGotchaSurvey(result, scores, { designKey: computeDesignKey(input) });
}

function formatHumanSummary(survey: GotchaSurvey): string {
  const lines = [
    `Design grade: ${survey.designGrade}`,
    `Ready for code generation: ${survey.isReadyForCodeGen ? "yes" : "no"}`,
    `Questions: ${survey.questions.length}`,
  ];
  if (survey.questions.length > 0) {
    lines.push("");
    lines.push("Use --json to get the full GotchaSurvey JSON for programmatic use.");
  }
  return lines.join("\n");
}

export function registerGotchaSurvey(cli: CAC): void {
  cli
    .command("gotcha-survey <input>", "Generate a gotcha survey from a Figma design analysis")
    .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
    .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
    .option("--config <path>", "Path to config JSON file (override rule scores/settings)")
    .option("--target-node-id <id>", "Scope analysis to a specific node ID")
    .option("--json", "Output GotchaSurvey JSON to stdout (same format as MCP)")
    .example("  canicode gotcha-survey https://www.figma.com/design/ABC123/MyDesign --json")
    .example("  canicode gotcha-survey ./fixtures/my-design --json")
    .action(async (input: string, rawOptions: Record<string, unknown>) => {
      const parseResult = GotchaSurveyOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        const msg = parseResult.error.issues.map(i => `--${i.path.join(".")}: ${i.message}`).join("\n");
        console.error(`\nInvalid options:\n${msg}`);
        process.exit(1);
      }
      const options = parseResult.data;
      const analysisStart = Date.now();
      trackEvent(EVENTS.ANALYSIS_STARTED, {
        source: isJsonFile(input) || isFixtureDir(input) ? "fixture" : "figma",
        tool: "gotcha-survey",
      });
      // In --json mode, send progress messages to stderr so stdout contains only valid JSON
      const log = options.json ? console.error.bind(console) : console.log.bind(console);

      try {
        if (!options.token && !getFigmaToken() && !isJsonFile(input) && !isFixtureDir(input)) {
          throw new Error(
            "canicode is not configured. Run 'canicode init --token YOUR_TOKEN' first.",
          );
        }

        const survey = await runGotchaSurvey(input, options);

        if (options.json) {
          console.log(JSON.stringify(survey, null, 2));
        } else {
          log(formatHumanSummary(survey));
        }

        trackEvent(EVENTS.ANALYSIS_COMPLETED, {
          grade: survey.designGrade,
          questionCount: survey.questions.length,
          isReadyForCodeGen: survey.isReadyForCodeGen,
          duration: Date.now() - analysisStart,
          tool: "gotcha-survey",
        });
      } catch (error) {
        trackError(
          error instanceof Error ? error : new Error(String(error)),
          { command: "gotcha-survey", input },
        );
        trackEvent(EVENTS.ANALYSIS_FAILED, {
          error: error instanceof Error ? error.message : String(error),
          duration: Date.now() - analysisStart,
          tool: "gotcha-survey",
        });
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error),
        );
        process.exitCode = 1;
      }
    });
}
