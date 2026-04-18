import type { CAC } from "cac";
import { z } from "zod";

import {
  initAiready, getConfigPath, getReportsDir,
} from "../../core/engine/config-store.js";
import { installSkills } from "../skill-installer.js";

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
            } catch (skillError) {
              console.error(
                `\n  Skill install failed: ${skillError instanceof Error ? skillError.message : String(skillError)}`,
              );
              process.exitCode = 1;
            }
          }

          console.log(`\n  Next: canicode analyze "https://www.figma.com/design/..."`);
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
