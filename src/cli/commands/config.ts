import type { CAC } from "cac";

import {
  getConfigPath,
  getFigmaToken,
  getReportsDir,
  readConfig,
  setFigmaToken,
  setTelemetryEnabled,
} from "../../core/engine/config-store.js";
import { trackEvent, EVENTS } from "../../core/monitoring/index.js";
import { maskFigmaToken, NonInteractiveError, promptForFigmaToken } from "../prompts.js";

interface ConfigOptions {
  telemetry?: boolean;
  token?: string;
}

const VALID_ACTIONS = ["set-token", "show", "path"] as const;
type ConfigAction = (typeof VALID_ACTIONS)[number];

function isConfigAction(value: string | undefined): value is ConfigAction {
  return value !== undefined && (VALID_ACTIONS as readonly string[]).includes(value);
}

function printConfigShow(): void {
  const cfg = readConfig();
  const envToken = process.env["FIGMA_TOKEN"];
  const effectiveToken = getFigmaToken();
  const tokenSource = envToken ? " (env: FIGMA_TOKEN)" : "";

  console.log("CANICODE CONFIG\n");
  console.log(`  Config path: ${getConfigPath()}`);
  console.log(`  Reports dir: ${getReportsDir()}`);
  console.log(`  Figma token: ${maskFigmaToken(effectiveToken)}${tokenSource}`);
  console.log(`  Telemetry:   ${cfg.telemetry !== false ? "enabled" : "disabled"}`);
  console.log(`\nOptions:`);
  console.log(`  canicode config set-token         Update saved Figma token (no skill reinstall)`);
  console.log(`  canicode config show              Show current configuration`);
  console.log(`  canicode config path              Print absolute config path`);
  console.log(`  canicode config --no-telemetry    Opt out of anonymous telemetry`);
  console.log(`  canicode config --telemetry       Opt back in`);
}

async function handleSetToken(options: ConfigOptions): Promise<void> {
  let token = options.token;
  const usedFlag = Boolean(token);
  if (!token) {
    try {
      token = await promptForFigmaToken();
    } catch (err) {
      if (err instanceof NonInteractiveError) {
        console.error(
          "Run with --token <token> or set FIGMA_TOKEN=… (interactive prompt requires a TTY).",
        );
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  }

  setFigmaToken(token);
  console.log(`Token saved: ${getConfigPath()}`);
  trackEvent(EVENTS.CLI_CONFIG_SET_TOKEN, { interactive: !usedFlag });
}

export function registerConfig(cli: CAC): void {
  // cac (v7) does not match space-delimited multi-word command names cleanly
  // when an overlapping shorter command exists (`config` vs. `config set-token`):
  // it greedy-matches the shorter one and rejects the inner flag as unknown.
  // Use a single command with a positional `[action]` and dispatch internally
  // — the plan in #505 anticipated this fallback.
  cli
    .command("config [action]", "Manage canicode configuration (actions: set-token, show, path)")
    .option("--telemetry", "Enable anonymous telemetry")
    .option("--no-telemetry", "Disable anonymous telemetry")
    .option("--token <token>", "For `config set-token`: set token non-interactively (CI / non-TTY)")
    .action(async (action: string | undefined, options: ConfigOptions) => {
      try {
        if (action !== undefined && !isConfigAction(action)) {
          console.error(
            `Unknown config action: ${action}. Available: ${VALID_ACTIONS.join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }

        if (action === "set-token") {
          await handleSetToken(options);
          return;
        }

        if (action === "path") {
          console.log(getConfigPath());
          return;
        }

        if (action === "show") {
          printConfigShow();
          return;
        }

        // No action — telemetry flags only flip when explicitly passed. cac
        // defaults `options.telemetry` to `true` whenever `--no-telemetry` is
        // registered, so checking the parsed value alone would always trip
        // and shadow the show-config fallback.
        const argv = process.argv.slice(2);
        const flippedOff = argv.includes("--no-telemetry");
        const flippedOn = argv.includes("--telemetry");

        if (flippedOff) {
          setTelemetryEnabled(false);
          console.log("Telemetry disabled. No analytics data will be sent.");
          return;
        }

        if (flippedOn) {
          setTelemetryEnabled(true);
          console.log("Telemetry enabled. Only anonymous usage events are tracked — no design data.");
          return;
        }

        printConfigShow();
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
