import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";

import {
  installSkills,
  installCursorBundledSkills,
} from "./skill-installer.js";

vi.mock("node:readline/promises", () => ({
  createInterface: vi.fn(),
}));

async function getCreateInterfaceMock(): Promise<ReturnType<typeof vi.fn>> {
  const mod = await import("node:readline/promises");
  return mod.createInterface as unknown as ReturnType<typeof vi.fn>;
}

function forceTty(): void {
  Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
}

function preCreateAllStaleSkills(cwd: string): string[] {
  const staleFiles = [
    join(cwd, ".claude", "skills", "canicode", "SKILL.md"),
    join(cwd, ".claude", "skills", "canicode-gotchas", "SKILL.md"),
    join(cwd, ".claude", "skills", "canicode-roundtrip", "SKILL.md"),
    join(cwd, ".claude", "skills", "canicode-roundtrip", "helpers.js"),
    join(cwd, ".claude", "skills", "canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"),
  ];
  for (const p of staleFiles) {
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, "# stale\n", "utf-8");
  }
  return staleFiles;
}

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
  writeFileSync(
    join(sourceDir, "canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"),
    "declare const CanICodeRoundtrip: unknown;\n",
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
  // Restore TTY state to vitest's default (undefined) after tests that forced it.
  Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
  Object.defineProperty(process.stdout, "isTTY", { value: undefined, configurable: true });
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
      join("canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"),
      join("canicode-roundtrip", "helpers.js"),
    ].sort());
    expect(summary.overwritten).toEqual([]);
    expect(summary.skipped).toEqual([]);

    expect(existsSync(join(summary.targetDir, "canicode-roundtrip", "SKILL.md"))).toBe(true);
    expect(existsSync(join(summary.targetDir, "canicode-roundtrip", "helpers.js"))).toBe(true);
    expect(existsSync(join(summary.targetDir, "canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"))).toBe(true);
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

  it("prompts per candidate when user answers 'y' to each", async () => {
    const staleFiles = preCreateAllStaleSkills(cwd);
    forceTty();

    const question = vi.fn()
      .mockResolvedValueOnce("y")
      .mockResolvedValueOnce("y")
      .mockResolvedValueOnce("y")
      .mockResolvedValueOnce("y")
      .mockResolvedValueOnce("y");
    const close = vi.fn();
    const createInterface = await getCreateInterfaceMock();
    createInterface.mockReturnValue({ question, close });

    const summary = await installSkills({
      target: "project",
      force: false,
      cwd,
      sourceDir,
    });

    expect(createInterface).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenCalledTimes(staleFiles.length);
    expect(summary.overwritten.length).toBe(staleFiles.length);
    expect(summary.skipped).toEqual([]);
    for (const p of staleFiles) {
      expect(readFileSync(p, "utf-8")).not.toBe("# stale\n");
    }
  });

  it("'a' short-circuits remaining decisions to overwrite", async () => {
    const staleFiles = preCreateAllStaleSkills(cwd);
    forceTty();

    const question = vi.fn().mockResolvedValueOnce("a");
    const close = vi.fn();
    const createInterface = await getCreateInterfaceMock();
    createInterface.mockReturnValue({ question, close });

    const summary = await installSkills({
      target: "project",
      force: false,
      cwd,
      sourceDir,
    });

    expect(question).toHaveBeenCalledTimes(1);
    expect(summary.overwritten.length).toBe(staleFiles.length);
    expect(summary.skipped).toEqual([]);
    for (const p of staleFiles) {
      expect(readFileSync(p, "utf-8")).not.toBe("# stale\n");
    }
  });

  it("'s' short-circuits remaining decisions to skip", async () => {
    const staleFiles = preCreateAllStaleSkills(cwd);
    forceTty();

    const question = vi.fn().mockResolvedValueOnce("s");
    const close = vi.fn();
    const createInterface = await getCreateInterfaceMock();
    createInterface.mockReturnValue({ question, close });

    const summary = await installSkills({
      target: "project",
      force: false,
      cwd,
      sourceDir,
    });

    expect(question).toHaveBeenCalledTimes(1);
    expect(summary.skipped.length).toBe(staleFiles.length);
    expect(summary.overwritten).toEqual([]);
    for (const p of staleFiles) {
      expect(readFileSync(p, "utf-8")).toBe("# stale\n");
    }
  });
});

describe("installCursorBundledSkills", () => {
  it("copies every directory under skills/cursor into the target skills root", async () => {
    const cursorBundle = join(tempRoot, "cursor-bundle");
    for (const name of ["canicode", "canicode-gotchas"]) {
      const dir = join(cursorBundle, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), `# ${name}\n`, "utf-8");
    }
    mkdirSync(join(cursorBundle, "canicode-roundtrip"), { recursive: true });
    writeFileSync(join(cursorBundle, "canicode-roundtrip", "helpers.js"), "// h\n", "utf-8");
    writeFileSync(join(cursorBundle, "canicode-roundtrip", "SKILL.md"), "# rt\n", "utf-8");
    writeFileSync(
      join(cursorBundle, "canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"),
      "export {};\n",
      "utf-8",
    );

    const targetSkillsRoot = join(cwd, "cursor-skill-target");
    const summary = await installCursorBundledSkills({
      force: false,
      cwd,
      sourceRoot: cursorBundle,
      targetSkillsRoot,
    });

    expect(summary.targetDir).toBe(targetSkillsRoot);
    expect(summary.installed.sort()).toEqual([
      join("canicode", "SKILL.md"),
      join("canicode-gotchas", "SKILL.md"),
      join("canicode-roundtrip", "SKILL.md"),
      join("canicode-roundtrip", "canicode-roundtrip-helpers.d.ts"),
      join("canicode-roundtrip", "helpers.js"),
    ].sort());
  });
});
