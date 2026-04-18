import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import { installSkills } from "./skill-installer.js";

let tempRoot: string;
let sourceDir: string;
let cwd: string;
let originalHome: string | undefined;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "canicode-skill-installer-"));
  sourceDir = join(tempRoot, "skills");
  cwd = join(tempRoot, "project");
  originalHome = process.env["HOME"];

  mkdirSync(cwd, { recursive: true });

  // Build a fixture skills tree mirroring the real shape: three skills,
  // canicode-roundtrip has both SKILL.md and helpers.js.
  for (const name of ["canicode", "canicode-gotchas", "canicode-roundtrip"]) {
    const dir = join(sourceDir, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), `# ${name}\nfresh\n`, "utf-8");
  }
  writeFileSync(
    join(sourceDir, "canicode-roundtrip", "helpers.js"),
    "// helpers fresh\n",
    "utf-8",
  );
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
  vi.restoreAllMocks();
});

describe("installSkills", () => {
  it("performs a fresh install — copies all skill files into ./.claude/skills/", async () => {
    const summary = await installSkills({
      target: "project",
      force: false,
      cwd,
      sourceDir,
    });

    expect(summary.targetDir).toBe(join(cwd, ".claude", "skills"));
    expect(summary.installed.sort()).toEqual([
      join("canicode", "SKILL.md"),
      join("canicode-gotchas", "SKILL.md"),
      join("canicode-roundtrip", "SKILL.md"),
      join("canicode-roundtrip", "helpers.js"),
    ].sort());
    expect(summary.overwritten).toEqual([]);
    expect(summary.skipped).toEqual([]);

    expect(existsSync(join(summary.targetDir, "canicode-roundtrip", "SKILL.md"))).toBe(true);
    expect(existsSync(join(summary.targetDir, "canicode-roundtrip", "helpers.js"))).toBe(true);
    expect(readFileSync(join(summary.targetDir, "canicode", "SKILL.md"), "utf-8"))
      .toBe("# canicode\nfresh\n");
  });

  it("overwrites existing files when force=true and reports them in `overwritten`", async () => {
    // Pre-create one file with stale content
    const stalePath = join(cwd, ".claude", "skills", "canicode", "SKILL.md");
    mkdirSync(join(cwd, ".claude", "skills", "canicode"), { recursive: true });
    writeFileSync(stalePath, "# stale\n", "utf-8");

    const summary = await installSkills({
      target: "project",
      force: true,
      cwd,
      sourceDir,
    });

    expect(summary.overwritten).toContain(join("canicode", "SKILL.md"));
    expect(readFileSync(stalePath, "utf-8")).toBe("# canicode\nfresh\n");
  });

  it("skips existing files when force=false and stdin is non-TTY (CI safe default)", async () => {
    const stalePath = join(cwd, ".claude", "skills", "canicode", "SKILL.md");
    mkdirSync(join(cwd, ".claude", "skills", "canicode"), { recursive: true });
    writeFileSync(stalePath, "# stale\n", "utf-8");

    // vitest runs without a TTY (process.stdin.isTTY/process.stdout.isTTY are
    // undefined), so promptOverwrite hits its non-TTY branch and returns false.
    expect(process.stdin.isTTY).toBeFalsy();

    const summary = await installSkills({
      target: "project",
      force: false,
      cwd,
      sourceDir,
    });

    expect(summary.skipped).toContain(join("canicode", "SKILL.md"));
    expect(summary.overwritten).not.toContain(join("canicode", "SKILL.md"));
    expect(readFileSync(stalePath, "utf-8")).toBe("# stale\n");
  });

  it("target=global writes under os.homedir()/.claude/skills/", async () => {
    const fakeHome = join(tempRoot, "home");
    mkdirSync(fakeHome, { recursive: true });
    // os.homedir() respects $HOME on Unix; on darwin (CI + dev), this is enough.
    process.env["HOME"] = fakeHome;

    const summary = await installSkills({
      target: "global",
      force: false,
      cwd,
      sourceDir,
    });

    expect(summary.targetDir).toBe(join(fakeHome, ".claude", "skills"));
    expect(existsSync(join(fakeHome, ".claude", "skills", "canicode", "SKILL.md"))).toBe(true);
  });

  it("throws a clear error when sourceDir is missing", async () => {
    await expect(
      installSkills({
        target: "project",
        force: false,
        cwd,
        sourceDir: join(tempRoot, "does-not-exist"),
      }),
    ).rejects.toThrow(/Bundled skills directory not found/);
  });
});
