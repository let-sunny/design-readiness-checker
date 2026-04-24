import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

import cac from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installSkills = vi.hoisted(() => vi.fn());
const installCursorBundledSkills = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());

vi.mock("../skill-installer.js", () => ({
  installSkills,
  installCursorBundledSkills,
}));

vi.mock("../../core/monitoring/index.js", () => ({
  trackEvent,
  trackError: vi.fn(),
  EVENTS: { CLI_INIT: "cic_cli_init" },
}));

import { registerInit } from "./init.js";

const mockSummary = (targetDir: string) => ({
  installed: ["canicode/SKILL.md"],
  overwritten: [] as string[],
  skipped: [] as string[],
  targetDir,
});

let tempCwd: string;

beforeEach(() => {
  tempCwd = mkdtempSync(join(tmpdir(), "canicode-init-skills-"));
  mkdirSync(tempCwd, { recursive: true });
  vi.clearAllMocks();
  installSkills.mockResolvedValue(mockSummary(join(tempCwd, ".claude", "skills")));
  installCursorBundledSkills.mockResolvedValue({
    installed: ["canicode-roundtrip/SKILL.md"],
    overwritten: [],
    skipped: [],
    targetDir: join(tempCwd, ".cursor", "skills"),
  });
});

afterEach(async () => {
  await rm(tempCwd, { recursive: true, force: true });
});

describe("registerInit skills without token (#461)", () => {
  it("runs --cursor-skills without --token (Claude skills + Cursor bundle)", async () => {
    const prev = process.cwd();
    process.chdir(tempCwd);
    try {
      const cli = cac("canicode");
      registerInit(cli);
      cli.parse(["node", "canicode", "init", "--cursor-skills"], { run: false });
      await cli.runMatchedCommand();
    } finally {
      process.chdir(prev);
    }

    expect(installSkills).toHaveBeenCalledTimes(1);
    expect(installCursorBundledSkills).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      "cic_cli_init",
      expect.objectContaining({ skillOnlyInit: true, skillStepOk: true }),
    );
  });

  it("prints setup guide when no token and no skill flags", async () => {
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    const prev = process.cwd();
    process.chdir(tempCwd);
    try {
      const cli = cac("canicode");
      registerInit(cli);
      cli.parse(["node", "canicode", "init"], { run: false });
      await cli.runMatchedCommand();
    } finally {
      process.chdir(prev);
      console.log = origLog;
    }

    expect(installSkills).not.toHaveBeenCalled();
    expect(installCursorBundledSkills).not.toHaveBeenCalled();
    expect(logs.join("\n")).toContain("CANICODE SETUP");
  });
});
