import type { CAC } from "cac";

import {
  getConfigPath, readConfig, setTelemetryEnabled,
} from "../../core/engine/config-store.js";

interface ConfigOptions {
  telemetry?: boolean;
}

export function registerConfig(cli: CAC): void {
  cli
    .command("config", "Manage canicode configuration")
    .option("--telemetry", "Enable anonymous telemetry")
    .option("--no-telemetry", "Disable anonymous telemetry")
    .action((options: ConfigOptions) => {
      try {
        // CAC maps --no-telemetry to options.telemetry === false
        if (options.telemetry === false) {
          setTelemetryEnabled(false);
          console.log("Telemetry disabled. No analytics data will be sent.");
          return;
        }

        if (options.telemetry === true) {
          setTelemetryEnabled(true);
          console.log("Telemetry enabled. Only anonymous usage events are tracked — no design data.");
          return;
        }

        // No flags: show current config
        const cfg = readConfig();
        console.log("CANICODE CONFIG\n");
        console.log(`  Config path: ${getConfigPath()}`);
        console.log(`  Figma token: ${cfg.figmaToken ? "set" : "not set"}`);
        console.log(`  Telemetry:   ${cfg.telemetry !== false ? "enabled" : "disabled"}`);
        console.log(`\nOptions:`);
        console.log(`  canicode config --no-telemetry    Opt out of anonymous telemetry`);
        console.log(`  canicode config --telemetry       Opt back in`);
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exit(1);
      }
    });
}
