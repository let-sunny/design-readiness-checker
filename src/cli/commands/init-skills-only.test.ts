import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";

import cac from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const installSkills = vi.hoisted(() => vi.fn());
const installCursorBundledSkills = vi.hoisted(() => vi.fn());
const trackEvent = vi.hoisted(() => vi.fn());
const promptForFigmaToken = vi.hoisted(() => vi.fn());
const initAiready = vi.hoisted(() => vi.fn());
const getConfigPath = vi.hoisted(() => vi.fn(() => "/tmp/canicode-test/config.json"));
const getReportsDir = vi.hoisted(() => vi.fn(() => "/tmp/canicode-test/reports"));

vi.mock("../skill-installer.js", () => ({
  installSkills,
  installCursorBundledSkills,
}));

vi.mock("../../core/monitoring/index.js", () => ({
  trackEvent,
  trackError: vi.fn(),
  EVENTS: { CLI_INIT: "cic_cli_init" },
}));

vi.mock("../prompts.js", async () => {
  // Keep NonInteractiveError as a real class so `instanceof` checks in init.ts
  // continue to work against thrown errors from the mocked prompt.
  class NonInteractiveError extends Error {
    constructor(message = "Interactive prompt requires a TTY") {
      super(message);
      this.name = "NonInteractiveError";
    }
  }
  return { promptForFigmaToken, NonInteractiveError };
});

vi.mock("../../core/engine/config-store.js", () => ({
  initAiready,
  getConfigPath,
  getReportsDir,
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
  // Default: prompt rejects as non-interactive (matches vitest's stdin which
  // is not a TTY). Individual tests can override with mockResolvedValueOnce.
  promptForFigmaToken.mockImplementation(async () => {
    const { NonInteractiveError } = await import("../prompts.js");
    throw new NonInteractiveError();
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

  it("prints setup guide when no token, no skill flags, and stdin is not a TTY", async () => {
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

describe("registerInit interactive (#505)", () => {
  it("TTY + no flags: prompts for token, runs initAiready, installs skills", async () => {
    promptForFigmaToken.mockResolvedValueOnce("figd_interactive_test");
    const prev = process.cwd();
    process.chdir(tempCwd);
    try {
      const cli = cac("canicode");
      registerInit(cli);
      cli.parse(["node", "canicode", "init"], { run: false });
      await cli.runMatchedCommand();
    } finally {
      process.chdir(prev);
    }

    expect(promptForFigmaToken).toHaveBeenCalledTimes(1);
    expect(initAiready).toHaveBeenCalledWith("figd_interactive_test");
    expect(installSkills).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      "cic_cli_init",
      expect.objectContaining({ interactive: true, skillStepOk: true }),
    );
  });

  it("--token branch: emits telemetry with interactive: false", async () => {
    const prev = process.cwd();
    process.chdir(tempCwd);
    try {
      const cli = cac("canicode");
      registerInit(cli);
      cli.parse(["node", "canicode", "init", "--token", "figd_flag_test"], { run: false });
      await cli.runMatchedCommand();
    } finally {
      process.chdir(prev);
    }

    expect(promptForFigmaToken).not.toHaveBeenCalled();
    expect(initAiready).toHaveBeenCalledWith("figd_flag_test");
    expect(installSkills).toHaveBeenCalledTimes(1);
    expect(trackEvent).toHaveBeenCalledWith(
      "cic_cli_init",
      expect.objectContaining({ interactive: false, skillStepOk: true }),
    );
  });
});
