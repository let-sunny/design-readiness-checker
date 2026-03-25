import type { CAC } from "cac";
import { z } from "zod";

import {
  initAiready, getConfigPath, getReportsDir,
} from "../../core/engine/config-store.js";

const InitOptionsSchema = z.object({
  token: z.string().optional(),
  mcp: z.boolean().optional(),
}).refine(
  (opts) => !(opts.token && opts.mcp),
  { message: "--token and --mcp are mutually exclusive. Choose one." }
);

export function registerInit(cli: CAC): void {
  cli
    .command("init", "Set up canicode (Figma token or MCP)")
    .option("--token <token>", "Save Figma API token to ~/.canicode/")
    .option("--mcp", "Show Figma MCP setup instructions")
    .action((rawOptions: Record<string, unknown>) => {
      try {
        const parseResult = InitOptionsSchema.safeParse(rawOptions);
        if (!parseResult.success) {
          const msg = parseResult.error.issues.map(i => i.message).join("\n");
          console.error(`\nInvalid options:\n${msg}`);
          process.exit(1);
        }
        const options = parseResult.data;

        if (options.token) {
          initAiready(options.token);

          console.log(`  Config saved: ${getConfigPath()}`);
          console.log(`  Reports will be saved to: ${getReportsDir()}/`);
          console.log(`\n  Next: canicode analyze "https://www.figma.com/design/..."`);
          return;
        }

        if (options.mcp) {
          console.log(`FIGMA MCP SETUP (for Claude Code)\n`);
          console.log(`1. Register the official Figma MCP server at project level:`);
          console.log(`   claude mcp add -s project -t http figma https://mcp.figma.com/mcp\n`);
          console.log(`   This creates .mcp.json in your project root.\n`);
          console.log(`2. Use the /canicode skill in Claude Code:`);
          console.log(`   /canicode https://www.figma.com/design/.../MyDesign?node-id=1-234\n`);
          console.log(`   The skill calls Figma MCP directly — no FIGMA_TOKEN needed.`);
          return;
        }

        // No flags: show setup guide
        console.log(`CANICODE SETUP\n`);
        console.log(`Choose your Figma data source:\n`);
        console.log(`Option 1: REST API (recommended for CI/automation)`);
        console.log(`  canicode init --token YOUR_FIGMA_TOKEN`);
        console.log(`  Get token: figma.com > Settings > Personal access tokens\n`);
        console.log(`Option 2: Figma MCP (recommended for Claude Code)`);
        console.log(`  canicode init --mcp`);
        console.log(`  Uses the /canicode skill in Claude Code with official Figma MCP\n`);
        console.log(`After setup:`);
        console.log(`  canicode analyze "https://www.figma.com/design/..."`);
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error)
        );
        process.exitCode = 1;
      }
    });
}
