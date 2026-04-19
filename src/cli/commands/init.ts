import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CAC } from "cac";
import { z } from "zod";

import {
  initAiready, getConfigPath, getReportsDir,
} from "../../core/engine/config-store.js";
import { installSkills } from "../skill-installer.js";
import { trackEvent, EVENTS } from "../../core/monitoring/index.js";

export function figmaMcpRegistered(cwd: string = process.cwd()): boolean {
  try {
    const raw = readFileSync(join(cwd, ".mcp.json"), "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const figma = parsed?.mcpServers?.["figma"];
    return typeof figma === "object" && figma !== null;
  } catch {
    return false;
  }
}

export function formatNextSteps(opts: {
  figmaMcpPresent: boolean;
  skillsInstalled: boolean;
}): string {
  if (!opts.skillsInstalled) {
    return `\n  Next: canicode analyze "https://www.figma.com/design/..."`;
  }
  if (opts.figmaMcpPresent) {
    return [
      "",
      "  Next:",
      "    1. Restart Claude Code (the newly installed skills only load on a fresh session)",
      "    2. Run /canicode-roundtrip <figma-url>",
    ].join("\n");
  }
  return [
    "",
    "  Next:",
    "    1. Install Figma MCP:",
    "         claude mcp add -s project -t http figma https://mcp.figma.com/mcp",
    "    2. Restart Claude Code (so the new skills + Figma MCP tools both load)",
    "    3. Run /canicode-roundtrip <figma-url>",
  ].join("\n");
}

const InitOptionsSchema = z.object({
  token: z.string().optional(),
  global: z.boolean().optional(),
  // cac maps `--no-skills` to `skills: false` (mirrors `--no-telemetry`).
  skills: z.boolean().optional(),
  force: z.boolean().optional(),
});

export function registerInit(cli: CAC): void {
  cli
    .command("init", "Set up canicode with Figma API token")
    .option("--token <token>", "Save Figma API token and install Claude Code skills to .claude/skills/")
    .option("--global", "Install skills to ~/.claude/skills/ instead of ./.claude/skills/")
    .option("--no-skills", "Skip skill installation (token only)")
    .option("--force", "Overwrite existing skill files without prompting (also for non-TTY/CI)")
    .action(async (rawOptions: Record<string, unknown>) => {
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

          let skillStepOk = true;
          let skillSummary: { installed: number; overwritten: number; skipped: number } | undefined;
          if (options.skills !== false) {
            try {
              const summary = await installSkills({
                target: options.global ? "global" : "project",
                force: options.force ?? false,
              });
              console.log(`\n  Skills installed to: ${summary.targetDir}/`);
              console.log(`    installed:   ${summary.installed.length}`);
              console.log(`    overwritten: ${summary.overwritten.length}`);
              console.log(`    skipped:     ${summary.skipped.length}`);
              if (summary.skipped.length > 0) {
                console.log(`  (Re-run with --force to overwrite skipped files.)`);
              }
              skillSummary = {
                installed: summary.installed.length,
                overwritten: summary.overwritten.length,
                skipped: summary.skipped.length,
              };
            } catch (skillError) {
              console.error(
                `\n  Skill install failed: ${skillError instanceof Error ? skillError.message : String(skillError)}`,
              );
              process.exitCode = 1;
              skillStepOk = false;
            }
          }

          trackEvent(EVENTS.CLI_INIT, {
            skillsRequested: options.skills !== false,
            skillStepOk,
            target: options.global ? "global" : "project",
            force: options.force ?? false,
            ...(skillSummary ?? {}),
          });

          if (skillStepOk) {
            console.log(
              formatNextSteps({
                figmaMcpPresent: figmaMcpRegistered(),
                skillsInstalled: options.skills !== false,
              }),
            );
          }
          return;
        }

        // No flags: show setup guide
        console.log(`CANICODE SETUP\n`);
        console.log(`  canicode init --token YOUR_FIGMA_TOKEN`);
        console.log(`  Get token: figma.com > Settings > Personal access tokens\n`);
        console.log(`Skills:`);
        console.log(`  --token also installs three Claude Code skills into ./.claude/skills/`);
        console.log(`  (canicode, canicode-gotchas, canicode-roundtrip).`);
        console.log(`  --global       Install to ~/.claude/skills/ instead`);
        console.log(`  --no-skills    Skip skill install (token only)`);
        console.log(`  --force        Overwrite existing skill files without prompting\n`);
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
