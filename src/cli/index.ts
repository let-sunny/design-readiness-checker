#!/usr/bin/env node
import { createRequire } from "node:module";
import { config } from "dotenv";
import cac from "cac";

// Load .env file (quiet: suppress dotenv's stdout banner)
config({ quiet: true });

import {
  getTelemetryEnabled, getPosthogApiKey, getSentryDsn, getDeviceId,
} from "../core/engine/config-store.js";
import { initMonitoring, shutdownMonitoring } from "../core/monitoring/index.js";
import { POSTHOG_API_KEY as BUILTIN_PH_KEY, SENTRY_DSN as BUILTIN_SENTRY_DSN } from "../core/monitoring/keys.js";
import { handleDocs } from "./docs.js";

// Import rules to register them
import "../core/rules/index.js";

// User-facing commands
import { registerAnalyze } from "./commands/analyze.js";
import { registerGotchaSurvey } from "./commands/gotcha-survey.js";
import { registerDesignTree } from "./commands/design-tree.js";
import { registerVisualCompare } from "./commands/visual-compare.js";
import { registerInit } from "./commands/init.js";
import { registerConfig } from "./commands/config.js";
import { registerListRules } from "./commands/list-rules.js";

import { INTERNAL_COMMANDS } from "./internal-commands.js";

// Internal commands (used by subagents, hidden from user help)
// When adding a new internal command, also add its name to internal-commands.ts
import { registerCalibrateAnalyze } from "./commands/internal/calibrate-analyze.js";
import { registerCalibrateEvaluate } from "./commands/internal/calibrate-evaluate.js";
import { registerCalibrateGapReport } from "./commands/internal/calibrate-gap-report.js";
import { registerCalibrateRun } from "./commands/internal/calibrate-run.js";
import { registerGatherEvidence, registerFinalizeDebate } from "./commands/internal/calibrate-debate.js";
import { registerFixtureManagement, registerEvidenceEnrich, registerEvidencePrune } from "./commands/internal/fixture-management.js";
import { registerDesignTreeStrip } from "./commands/internal/design-tree-strip.js";
import { registerHtmlPostprocess } from "./commands/internal/html-postprocess.js";
import { registerCalibrateSaveFixture } from "./commands/internal/calibrate-save-fixture.js";
import { registerCalibrateImplement } from "./commands/internal/calibrate-implement.js";
import { registerCodeMetrics } from "./commands/internal/code-metrics.js";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

const cli = cac("canicode");

// Initialise monitoring (fire-and-forget, never blocks startup)
{
  const monitoringConfig: Parameters<typeof initMonitoring>[0] = {
    environment: "cli",
    version: pkg.version,
    enabled: getTelemetryEnabled(),
  };
  const phKey = getPosthogApiKey() || BUILTIN_PH_KEY;
  if (phKey) monitoringConfig.posthogApiKey = phKey;
  const sDsn = getSentryDsn() || BUILTIN_SENTRY_DSN;
  if (sDsn) monitoringConfig.sentryDsn = sDsn;
  monitoringConfig.distinctId = getDeviceId();
  initMonitoring(monitoringConfig);
}

process.on("beforeExit", () => {
  shutdownMonitoring();
});

// ============================================
// User-facing commands
// ============================================
registerAnalyze(cli);
registerGotchaSurvey(cli);
registerDesignTree(cli);
registerVisualCompare(cli);
registerInit(cli);
registerConfig(cli);
registerListRules(cli);

// ============================================
// Internal commands (calibration & fixtures)
// ============================================
registerCalibrateAnalyze(cli);
registerCalibrateEvaluate(cli);
registerCalibrateGapReport(cli);
registerCalibrateRun(cli);
registerGatherEvidence(cli);
registerFinalizeDebate(cli);
registerFixtureManagement(cli);
registerEvidenceEnrich(cli);
registerEvidencePrune(cli);
registerDesignTreeStrip(cli);
registerHtmlPostprocess(cli);
registerCalibrateSaveFixture(cli);
registerCalibrateImplement(cli);
registerCodeMetrics(cli);

// ============================================
// Documentation command
// ============================================
cli
  .command("docs [topic]", "Show documentation (topics: setup, config, scoring, rules, visual-compare, design-tree)")
  .action((topic?: string) => {
    handleDocs(topic);
  });

cli.help((sections) => {
  // Filter internal commands from "Commands" and "For more info" sections
  for (const section of sections) {
    if (section.title === "Commands" || section.title?.startsWith("For more info")) {
      section.body = section.body
        .split("\n")
        .filter((line: string) => !INTERNAL_COMMANDS.some((cmd) => line.includes(cmd)))
        .join("\n");
    }
  }

  sections.push(
    {
      title: "\nSetup",
      body: `  canicode init --token <token>   Save Figma token to ~/.canicode/`,
    },
    {
      title: "\nData source",
      body: [
        `  --api                   Load via Figma REST API (needs FIGMA_TOKEN)`,
        `  --token <token>         Figma API token (or use FIGMA_TOKEN env var)`,
      ].join("\n"),
    },
    {
      title: "\nCustomization",
      body: `  --config <path>         Override rule settings (see: canicode docs config)`,
    },
    {
      title: "\nExamples",
      body: [
        `  $ canicode analyze "https://www.figma.com/design/..." --api`,
        `  $ canicode analyze "https://www.figma.com/design/..." --preset strict`,
        `  $ canicode analyze "https://www.figma.com/design/..." --config ./my-config.json`,
        `  $ canicode gotcha-survey "https://www.figma.com/design/..." --json`,
      ].join("\n"),
    },
    {
      title: "\nInstallation",
      body: [
        `  CLI:     npm install -g canicode`,
        `  MCP:     claude mcp add canicode -- npx --yes --package=canicode canicode-mcp`,
        `  Skills:  github.com/let-sunny/canicode`,
      ].join("\n"),
    },
  );
});
cli.version(pkg.version);

cli.parse();
