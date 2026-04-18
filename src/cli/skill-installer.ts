import {
  existsSync, mkdirSync, readdirSync, statSync, copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const InstallSkillsOptionsSchema = z.object({
  target: z.enum(["project", "global"]),
  force: z.boolean(),
  cwd: z.string().optional(),
  sourceDir: z.string().optional(),
});

export type InstallSkillsOptions = z.input<typeof InstallSkillsOptionsSchema>;

export interface InstallSummary {
  installed: string[];
  overwritten: string[];
  skipped: string[];
  targetDir: string;
}

const SKILL_NAMES = ["canicode", "canicode-gotchas", "canicode-roundtrip"] as const;

// Resolve the bundled `skills/` dir at runtime. tsup bundles this module
// into the CLI entrypoint `<pkg>/dist/cli/index.js` (splitting: false), so
// `import.meta.url` at runtime resolves to that entrypoint — depth 2 under
// the package root. `../../skills/` therefore lands on `<pkg>/skills/`.
// If tsup's output layout ever changes (new entrypoint depth, splitting
// enabled, etc.), update this URL.
function defaultSourceDir(): string {
  return fileURLToPath(new URL("../../skills/", import.meta.url));
}

export async function installSkills(rawOptions: InstallSkillsOptions): Promise<InstallSummary> {
  const options = InstallSkillsOptionsSchema.parse(rawOptions);
  const sourceDir = options.sourceDir ?? defaultSourceDir();

  if (!existsSync(sourceDir)) {
    throw new Error(
      `Bundled skills directory not found: ${sourceDir}\n` +
      `If you are developing canicode, run 'pnpm build' first.\n` +
      `If you installed canicode from npm, please file a bug report — the tarball is missing skills/.`,
    );
  }

  const cwd = options.cwd ?? process.cwd();
  const targetDir = options.target === "global"
    ? join(homedir(), ".claude", "skills")
    : join(cwd, ".claude", "skills");

  mkdirSync(targetDir, { recursive: true });

  const summary: InstallSummary = {
    installed: [],
    overwritten: [],
    skipped: [],
    targetDir,
  };

  for (const skillName of SKILL_NAMES) {
    const srcSkillDir = join(sourceDir, skillName);
    if (!existsSync(srcSkillDir)) {
      throw new Error(`Bundled skill directory missing: ${srcSkillDir}`);
    }

    const destSkillDir = join(targetDir, skillName);
    mkdirSync(destSkillDir, { recursive: true });

    const files = listFilesRecursive(srcSkillDir);
    for (const relPath of files) {
      const src = join(srcSkillDir, relPath);
      const dest = join(destSkillDir, relPath);
      mkdirSync(dirname(dest), { recursive: true });

      const label = join(skillName, relPath);

      if (!existsSync(dest)) {
        copyFileSync(src, dest);
        summary.installed.push(label);
        continue;
      }

      if (options.force) {
        copyFileSync(src, dest);
        summary.overwritten.push(label);
        continue;
      }

      const overwrite = await promptOverwrite(dest);
      if (overwrite) {
        copyFileSync(src, dest);
        summary.overwritten.push(label);
      } else {
        summary.skipped.push(label);
      }
    }
  }

  return summary;
}

function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        out.push(relative(dir, full));
      }
    }
  };
  walk(dir);
  return out;
}

async function promptOverwrite(destPath: string): Promise<boolean> {
  // Non-interactive (CI, piped stdin): default to skip — safer than silently
  // clobbering a user-edited skill file. Users who want unattended overwrite
  // pass --force.
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`File exists: ${destPath}. Overwrite? [y/N] `);
    return answer.trim().toLowerCase().startsWith("y");
  } finally {
    rl.close();
  }
}
