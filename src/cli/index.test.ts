import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { INTERNAL_COMMANDS } from "./internal-commands.js";

const CLI_PATH = resolve(import.meta.dirname, "../../dist/cli/index.js");

describe.skipIf(!existsSync(CLI_PATH))("CLI --help", () => {

  it("should not show internal commands in --help output", () => {
    const output = execFileSync("node", [CLI_PATH, "--help"], {
      encoding: "utf-8",
    });

    for (const cmd of INTERNAL_COMMANDS) {
      expect(output).not.toContain(cmd);
    }
  });

  it("should show user-facing commands in --help output", () => {
    const output = execFileSync("node", [CLI_PATH, "--help"], {
      encoding: "utf-8",
    });

    const userCommands = [
      "analyze",
      "design-tree",
      "implement",
      "visual-compare",
      "init",
      "config",
      "list-rules",
      "prompt",
      "docs",
    ];

    for (const cmd of userCommands) {
      expect(output).toContain(cmd);
    }
  });

  it("should allow direct invocation of internal commands", () => {
    const output = execFileSync(
      "node",
      [CLI_PATH, "calibrate-save-fixture", "--help"],
      { encoding: "utf-8" },
    );

    expect(output).toContain("calibrate-save-fixture");
    expect(output).toContain("Options");
  });
});
