import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { figmaMcpRegistered, formatNextSteps } from "./init.js";

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
});
