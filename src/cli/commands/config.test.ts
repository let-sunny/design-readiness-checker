import cac from "cac";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setFigmaToken = vi.hoisted(() => vi.fn());
const setTelemetryEnabled = vi.hoisted(() => vi.fn());
const readConfig = vi.hoisted(() => vi.fn(() => ({})));
const getFigmaToken = vi.hoisted(() => vi.fn(() => undefined as string | undefined));
const getConfigPath = vi.hoisted(() => vi.fn(() => "/tmp/canicode-test/config.json"));
const getReportsDir = vi.hoisted(() => vi.fn(() => "/tmp/canicode-test/reports"));
const trackEvent = vi.hoisted(() => vi.fn());
const promptForFigmaToken = vi.hoisted(() => vi.fn());

vi.mock("../../core/engine/config-store.js", () => ({
  setFigmaToken,
  setTelemetryEnabled,
  readConfig,
  getFigmaToken,
  getConfigPath,
  getReportsDir,
}));

vi.mock("../../core/monitoring/index.js", () => ({
  trackEvent,
  trackError: vi.fn(),
  EVENTS: {
    CLI_CONFIG_SET_TOKEN: "cic_cli_config_set_token",
  },
}));

vi.mock("../prompts.js", async () => {
  class NonInteractiveError extends Error {
    constructor(message = "Interactive prompt requires a TTY") {
      super(message);
      this.name = "NonInteractiveError";
    }
  }
  return {
    promptForFigmaToken,
    NonInteractiveError,
    maskFigmaToken: (t: string | undefined) => {
      if (!t) return "(empty)";
      if (t.startsWith("figd_") && t.length > 9) return `figd_••••••••${t.slice(-4)}`;
      if (t.length >= 4) return `••••••••${t.slice(-4)}`;
      return "•".repeat(t.length);
    },
  };
});

import { registerConfig } from "./config.js";

let logs: string[] = [];
let errors: string[] = [];
let origLog: typeof console.log;
let origError: typeof console.error;
let origExitCode: number | string | undefined;
let origEnvToken: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  readConfig.mockReturnValue({});
  getFigmaToken.mockReturnValue(undefined);
  promptForFigmaToken.mockImplementation(async () => {
    const { NonInteractiveError } = await import("../prompts.js");
    throw new NonInteractiveError();
  });
  logs = [];
  errors = [];
  origLog = console.log;
  origError = console.error;
  origExitCode = process.exitCode;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
  };
  origEnvToken = process.env["FIGMA_TOKEN"];
  delete process.env["FIGMA_TOKEN"];
});

afterEach(() => {
  console.log = origLog;
  console.error = origError;
  process.exitCode = origExitCode;
  if (origEnvToken === undefined) {
    delete process.env["FIGMA_TOKEN"];
  } else {
    process.env["FIGMA_TOKEN"] = origEnvToken;
  }
});

async function runConfig(args: string[]): Promise<void> {
  const cli = cac("canicode");
  registerConfig(cli);
  const origArgv = process.argv;
  process.argv = ["node", "canicode", "config", ...args];
  try {
    cli.parse(process.argv, { run: false });
    await cli.runMatchedCommand();
  } finally {
    process.argv = origArgv;
  }
}

describe("config set-token", () => {
  it("with --token writes the token via setFigmaToken and emits telemetry (non-interactive)", async () => {
    await runConfig(["set-token", "--token", "figd_round_trip"]);
    expect(setFigmaToken).toHaveBeenCalledWith("figd_round_trip");
    expect(promptForFigmaToken).not.toHaveBeenCalled();
    expect(trackEvent).toHaveBeenCalledWith(
      "cic_cli_config_set_token",
      expect.objectContaining({ interactive: false }),
    );
    expect(logs.join("\n")).toContain("Token saved:");
  });

  it("without --token in non-TTY exits with code 1 and prints CI hint", async () => {
    await runConfig(["set-token"]);
    expect(setFigmaToken).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/--token|FIGMA_TOKEN/);
  });

  it("with TTY uses the prompt and emits telemetry with interactive: true", async () => {
    promptForFigmaToken.mockResolvedValueOnce("figd_from_prompt");
    await runConfig(["set-token"]);
    expect(setFigmaToken).toHaveBeenCalledWith("figd_from_prompt");
    expect(trackEvent).toHaveBeenCalledWith(
      "cic_cli_config_set_token",
      expect.objectContaining({ interactive: true }),
    );
  });
});

describe("config show", () => {
  it("masks the stored token and prints config + reports paths", async () => {
    readConfig.mockReturnValue({ figmaToken: "figd_abcdefgh1234", telemetry: true });
    getFigmaToken.mockReturnValue("figd_abcdefgh1234");
    await runConfig(["show"]);
    const out = logs.join("\n");
    expect(out).toContain("figd_••••••••1234");
    expect(out).toContain("/tmp/canicode-test/config.json");
    expect(out).toContain("/tmp/canicode-test/reports");
    expect(out).toContain("Telemetry:   enabled");
  });

  it("annotates env-sourced token with (env: FIGMA_TOKEN)", async () => {
    process.env["FIGMA_TOKEN"] = "figd_envtoken9999";
    getFigmaToken.mockReturnValue("figd_envtoken9999");
    await runConfig(["show"]);
    const out = logs.join("\n");
    expect(out).toContain("(env: FIGMA_TOKEN)");
    expect(out).toContain("figd_••••••••9999");
  });

  it("shows (empty) when no token is configured", async () => {
    await runConfig(["show"]);
    expect(logs.join("\n")).toContain("Figma token: (empty)");
  });
});

describe("config path", () => {
  it("prints exactly the absolute config path", async () => {
    await runConfig(["path"]);
    expect(logs).toEqual(["/tmp/canicode-test/config.json"]);
  });
});

describe("config (no action)", () => {
  it("--no-telemetry disables telemetry and does not show config", async () => {
    await runConfig(["--no-telemetry"]);
    expect(setTelemetryEnabled).toHaveBeenCalledWith(false);
    expect(logs.join("\n")).toContain("Telemetry disabled");
    expect(logs.join("\n")).not.toContain("CANICODE CONFIG");
  });

  it("--telemetry enables telemetry", async () => {
    await runConfig(["--telemetry"]);
    expect(setTelemetryEnabled).toHaveBeenCalledWith(true);
    expect(logs.join("\n")).toContain("Telemetry enabled");
  });

  it("no args delegates to show", async () => {
    await runConfig([]);
    expect(logs.join("\n")).toContain("CANICODE CONFIG");
  });
});

describe("config invalid action", () => {
  it("prints error and exits 1 for unknown action", async () => {
    await runConfig(["bogus"]);
    expect(process.exitCode).toBe(1);
    expect(errors.join("\n")).toMatch(/Unknown config action/);
  });
});
