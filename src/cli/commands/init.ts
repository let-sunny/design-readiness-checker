import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CAC } from "cac";
import { z } from "zod";

import {
  initAiready, getConfigPath, getReportsDir,
} from "../../core/engine/config-store.js";
import {
  installSkills,
  installCursorBundledSkills,
} from "../skill-installer.js";
import { trackEvent, EVENTS } from "../../core/monitoring/index.js";

function figmaEntryInMcpFile(filePath: string): boolean {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    const figma = parsed?.mcpServers?.["figma"];
    return typeof figma === "object" && figma !== null;
  } catch {
    return false;
  }
}

/** True if project `.mcp.json` or Cursor's `.cursor/mcp.json` registers a Figma MCP server. */
export function figmaMcpRegistered(cwd: string = process.cwd()): boolean {
  return figmaEntryInMcpFile(join(cwd, ".mcp.json"))
    || figmaEntryInMcpFile(join(cwd, ".cursor", "mcp.json"));
}

export function formatNextSteps(opts: {
  figmaMcpPresent: boolean;
  skillsInstalled: boolean;
  /** User ran `canicode init --cursor-skills` — next steps reference Cursor + @ skills, not slash commands. */
  cursorSkillsInstalled?: boolean;
}): string {
  if (!opts.skillsInstalled) {
    return `\n  Next: canicode analyze "https://www.figma.com/design/..."`;
  }

  const cursor = opts.cursorSkillsInstalled === true;

  if (opts.figmaMcpPresent) {
    if (cursor) {
      return [
        "",
        "  Next:",
        "    1. Restart Cursor or reload MCP (so skills + MCP tools load in a fresh session)",
        "    2. In Agent chat, @ canicode-roundtrip with your Figma URL (or @ canicode-gotchas for survey-only)",
        "    • Optional — faster canicode MCP than `npx`: add `canicode-mcp` per https://github.com/let-sunny/canicode/blob/main/docs/CUSTOMIZATION.md#cursor-mcp-canicode (project `.cursor/mcp.json`), then reload MCP; otherwise skills keep using `npx canicode …` (#433).",
      ].join("\n");
    }
    return [
      "",
      "  Next:",
      "    1. Restart Claude Code (the newly installed skills only load on a fresh session)",
      "    2. Run /canicode-roundtrip <figma-url>",
      "    • Optional — faster canicode MCP than `npx`: `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp`, then restart Claude Code so `analyze` / `gotcha-survey` tools load — otherwise skills shell out to `npx canicode …` (#433).",
    ].join("\n");
  }

  if (cursor) {
    return [
      "",
      "  Next:",
      "    1. Add Figma MCP to .cursor/mcp.json (see https://github.com/let-sunny/canicode/blob/main/docs/CUSTOMIZATION.md#cursor-mcp-canicode and Figma MCP docs)",
      "    2. Restart Cursor so Figma tools (e.g. use_figma) load",
      "    3. @ canicode-roundtrip with your Figma URL for full roundtrip",
      "    • Optional — faster canicode MCP than `npx`: add `canicode-mcp` per the Customization guide (`#cursor-mcp-canicode`), then reload MCP; otherwise skills keep using `npx canicode …` (#433).",
    ].join("\n");
  }

  return [
    "",
    "  Next:",
    "    1. Install Figma MCP:",
    "         claude mcp add -s project -t http figma https://mcp.figma.com/mcp",
    "    2. Restart Claude Code (so the new skills + Figma MCP tools both load)",
    "    3. Run /canicode-roundtrip <figma-url>",
    "    • Optional — faster canicode MCP than `npx`: `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp`, then restart Claude Code so MCP tools load — otherwise skills shell out to `npx canicode …` (#433).",
  ].join("\n");
}

const InitOptionsSchema = z.object({
  token: z.string().optional(),
  global: z.boolean().optional(),
  /** Install `skills/cursor/*` into `.cursor/skills/` (canicode, gotchas, roundtrip — issue #407). */
  cursorSkills: z.boolean().optional(),
  force: z.boolean().optional(),
});

type InitOptions = z.infer<typeof InitOptionsSchema>;

type InitSkillSummary = {
  installed: number;
  overwritten: number;
  skipped: number;
};

/** True when user asked for skill install without passing `--token` (#461). */
function wantsSkillInstallWithoutToken(options: InitOptions): boolean {
  return options.cursorSkills === true;
}

/**
 * Install Claude skills, optional gotchas-only path, then optional Cursor bundle.
 * Mirrors the `--token` branch so behavior stays aligned (#461).
 */
async function runInitSkillInstallSteps(
  options: InitOptions,
): Promise<{ skillStepOk: boolean; skillSummary?: InitSkillSummary }> {
  let skillStepOk = true;
  let skillSummary: InitSkillSummary | undefined;

  try {
    const summary = await installSkills({
      target: options.global ? "global" : "project",
      force: options.force ?? false,
    });
    console.log(`\n  Skills installed to: ${summary.targetDir}/`);
    console.log(`    files installed:   ${summary.installed.length}`);
    console.log(`    files overwritten: ${summary.overwritten.length}`);
    console.log(`    files skipped:     ${summary.skipped.length}`);
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

  if (options.cursorSkills && skillStepOk) {
    try {
      const cSummary = await installCursorBundledSkills({
        force: options.force ?? false,
      });
      console.log(`\n  Cursor skills installed to: ${cSummary.targetDir}/`);
      console.log(`    files installed:   ${cSummary.installed.length}`);
      console.log(`    files overwritten: ${cSummary.overwritten.length}`);
      console.log(`    files skipped:     ${cSummary.skipped.length}`);
      if (cSummary.skipped.length > 0) {
        console.log(`  (Re-run with --force to overwrite skipped files.)`);
      }
      console.log(`  Open a new chat and @-mention canicode, canicode-gotchas, or canicode-roundtrip if skills do not appear immediately.`);
    } catch (cursorError) {
      console.error(
        `\n  Cursor skill install failed: ${cursorError instanceof Error ? cursorError.message : String(cursorError)}`,
      );
      process.exitCode = 1;
      skillStepOk = false;
    }
  }

  return skillSummary !== undefined
    ? { skillStepOk, skillSummary }
    : { skillStepOk };
}

export function registerInit(cli: CAC): void {
  cli
    .command(
      "init",
      "Set up canicode with Figma API token (never paste a token into agent chat — use FIGMA_TOKEN=… or the interactive prompt)",
    )
    .option(
      "--token <token>",
      "Save Figma API token (use env/CLI only — not agent chat) and install Claude Code skills to .claude/skills/",
    )
    .option("--global", "Install skills to ~/.claude/skills/ instead of ./.claude/skills/")
    .option("--cursor-skills", "Also install Cursor copies of canicode / canicode-gotchas / canicode-roundtrip under .cursor/skills/ (with `--token`, runs after Claude skills; without token, installs Claude skills + Cursor bundle)")
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

          const { skillStepOk, skillSummary } = await runInitSkillInstallSteps(options);

          trackEvent(EVENTS.CLI_INIT, {
            skillsRequested: true,
            cursorSkillsRequested: options.cursorSkills === true,
            skillStepOk,
            target: options.global ? "global" : "project",
            force: options.force ?? false,
            ...(skillSummary ?? {}),
          });

          if (skillStepOk) {
            console.log(
              formatNextSteps({
                figmaMcpPresent: figmaMcpRegistered(),
                skillsInstalled: true,
                cursorSkillsInstalled: options.cursorSkills === true,
              }),
            );
          }
          return;
        }

        if (wantsSkillInstallWithoutToken(options)) {
          const { skillStepOk, skillSummary } = await runInitSkillInstallSteps(options);

          trackEvent(EVENTS.CLI_INIT, {
            skillsRequested: true,
            cursorSkillsRequested: options.cursorSkills === true,
            skillStepOk,
            target: options.global ? "global" : "project",
            force: options.force ?? false,
            skillOnlyInit: true,
            ...(skillSummary ?? {}),
          });

          if (skillStepOk) {
            console.log(
              formatNextSteps({
                figmaMcpPresent: figmaMcpRegistered(),
                skillsInstalled: true,
                cursorSkillsInstalled: options.cursorSkills === true,
              }),
            );
            console.log(
              "\n  Figma token not saved — run `canicode init --token …` when you need REST analyze or MCP against live files.",
            );
          }
          return;
        }

        // No flags: show setup guide
        console.log(`CANICODE SETUP\n`);
        console.log(
          `  Never paste your token into Claude/Cursor chat — use FIGMA_TOKEN=… npx canicode init or this prompt only.\n`,
        );
        console.log(`  canicode init --token YOUR_FIGMA_TOKEN`);
        console.log(`  Get token: figma.com > Settings > Personal access tokens\n`);
        console.log(`Skills:`);
        console.log(`  --token also installs three Claude Code skills into ./.claude/skills/`);
        console.log(`  (canicode, canicode-gotchas, canicode-roundtrip).`);
        console.log(`  --global       Install to ~/.claude/skills/ instead`);
        console.log(`  --cursor-skills Install Claude skills under .claude/skills/ plus Cursor copies under .cursor/skills/ (no --token yet — add --token when ready for REST analyze)`);
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
