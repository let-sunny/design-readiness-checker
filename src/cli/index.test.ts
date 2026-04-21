import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";

import { INTERNAL_COMMANDS } from "./internal-commands.js";

const CLI_PATH = resolve(import.meta.dirname, "../../dist/cli/index.js");
const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { description: string };

describe.skipIf(!existsSync(CLI_PATH))("CLI --help", () => {

  it("should print the product description from package.json (first-touch tagline)", () => {
    const output = execFileSync("node", [CLI_PATH, "--help"], {
      encoding: "utf-8",
    });
    expect(pkg.description.length).toBeGreaterThan(10);
    expect(output).toContain(pkg.description);
  });

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
      "visual-compare",
      "init",
      "config",
      "list-rules",
      "docs",
    ];

    for (const cmd of userCommands) {
      expect(output).toContain(cmd);
    }
  });

  it("should show product tagline above Usage in --help output", () => {
    const output = execFileSync("node", [CLI_PATH, "--help"], {
      encoding: "utf-8",
    });

    const taglineAnchor = "Lint Figma designs for AI code-gen";
    expect(output).toContain(taglineAnchor);

    const taglineIndex = output.indexOf(taglineAnchor);
    const usageIndex = output.indexOf("Usage:");
    expect(taglineIndex).toBeGreaterThan(-1);
    expect(usageIndex).toBeGreaterThan(-1);
    expect(taglineIndex).toBeLessThan(usageIndex);
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
