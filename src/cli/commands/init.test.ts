import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import cac from "cac";

import { figmaMcpRegistered, formatNextSteps, registerInit } from "./init.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "canicode-init-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("figmaMcpRegistered", () => {
  it("returns false when .mcp.json is absent", () => {
    expect(figmaMcpRegistered(tempRoot)).toBe(false);
  });

  it("returns true when .mcp.json registers a figma entry", () => {
    writeFileSync(
      join(tempRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { figma: { type: "http", url: "https://mcp.figma.com/mcp" } } }),
      "utf-8",
    );
    expect(figmaMcpRegistered(tempRoot)).toBe(true);
  });

  it("returns false when .mcp.json registers other servers but not figma", () => {
    writeFileSync(
      join(tempRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { canicode: {} } }),
      "utf-8",
    );
    expect(figmaMcpRegistered(tempRoot)).toBe(false);
  });

  it("returns false when .mcp.json is malformed JSON", () => {
    writeFileSync(join(tempRoot, ".mcp.json"), "{ not valid json", "utf-8");
    expect(figmaMcpRegistered(tempRoot)).toBe(false);
  });

  it("returns false when mcpServers.figma is null", () => {
    writeFileSync(
      join(tempRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { figma: null } }),
      "utf-8",
    );
    expect(figmaMcpRegistered(tempRoot)).toBe(false);
  });

  it("returns true when only .cursor/mcp.json registers figma (Cursor project layout)", () => {
    const cursorDir = join(tempRoot, ".cursor");
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      join(cursorDir, "mcp.json"),
      JSON.stringify({ mcpServers: { figma: { url: "https://mcp.figma.com/mcp" } } }),
      "utf-8",
    );
    expect(figmaMcpRegistered(tempRoot)).toBe(true);
  });
});

describe("formatNextSteps", () => {
  it("prints a 3-step checklist when skills installed and Figma MCP missing", () => {
    const out = formatNextSteps({ figmaMcpPresent: false, skillsInstalled: true });
    expect(out).toContain("claude mcp add -s project -t http figma https://mcp.figma.com/mcp");
    expect(out).toContain("Restart Claude Code");
    expect(out).toContain("/canicode-roundtrip <figma-url>");
    expect(out).not.toContain("canicode analyze");
  });

  it("prints a 2-step checklist (no MCP install) when Figma MCP already registered", () => {
    const out = formatNextSteps({ figmaMcpPresent: true, skillsInstalled: true });
    expect(out).not.toContain("claude mcp add");
    expect(out).toContain("Restart Claude Code");
    expect(out).toContain("/canicode-roundtrip <figma-url>");
    expect(out).not.toContain("canicode analyze");
  });

  it("falls back to the analyze hint when --no-skills was passed", () => {
    const out = formatNextSteps({ figmaMcpPresent: false, skillsInstalled: false });
    expect(out).toContain(`Next: canicode analyze "https://www.figma.com/design/..."`);
    expect(out).not.toContain("Restart Claude Code");
    expect(out).not.toContain("/canicode-roundtrip");
  });

  it("falls back to the analyze hint when --no-skills was passed even if Figma MCP is present", () => {
    const out = formatNextSteps({ figmaMcpPresent: true, skillsInstalled: false });
    expect(out).toContain(`Next: canicode analyze`);
    expect(out).not.toContain("Restart Claude Code");
  });

  it("when cursorSkillsInstalled, omits Claude slash commands and mentions @ canicode-roundtrip", () => {
    const out = formatNextSteps({
      figmaMcpPresent: true,
      skillsInstalled: true,
      cursorSkillsInstalled: true,
    });
    expect(out).toContain("@ canicode-roundtrip");
    expect(out).not.toContain("/canicode-roundtrip");
    expect(out).not.toContain("Claude Code");
  });

  it("when cursorSkillsInstalled and Figma MCP missing, points at .cursor/mcp.json", () => {
    const out = formatNextSteps({
      figmaMcpPresent: false,
      skillsInstalled: true,
      cursorSkillsInstalled: true,
    });
    expect(out).toContain(".cursor/mcp.json");
    expect(out).not.toContain("claude mcp add");
  });
});

describe("registerInit --help rendering", () => {
  // Guards against the cac `(default: true)` artifact from issue #432.
  // cac auto-injects `config.default = true` on any option whose rawName
  // begins with `--no-`, which then renders as `(default: true)` in help.
  it("declares the skills option positively so cac does not inject a default", () => {
    const cli = cac("canicode");
    registerInit(cli);
    const initCommand = cli.commands.find(c => c.name === "init");
    expect(initCommand).toBeDefined();
    const skillsOption = initCommand!.options.find(o => o.name === "skills");
    expect(skillsOption).toBeDefined();
    expect(skillsOption!.rawName).toBe("--skills");
    expect(skillsOption!.negated).toBe(false);
    expect(skillsOption!.config.default).toBeUndefined();
  });

  it("renders init --help without a misleading (default: true) on the skills line", () => {
    const cli = cac("canicode");
    registerInit(cli);
    const initCommand = cli.commands.find(c => c.name === "init")!;
    const logs: string[] = [];
    const originalInfo = console.info;
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      initCommand.outputHelp();
    } finally {
      console.info = originalInfo;
    }
    const output = logs.join("\n");
    const skillsLine = output.split("\n").find(line => /--skills\b/.test(line));
    expect(skillsLine).toBeDefined();
    expect(skillsLine!).not.toContain("(default: true)");
    expect(output).toContain("--no-skills");
  });
});
