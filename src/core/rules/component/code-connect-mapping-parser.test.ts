import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  extractNodeIdsFromSource,
  parseCodeConnectMappings,
} from "./code-connect-mapping-parser.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "canicode-cc-parser-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("extractNodeIdsFromSource", () => {
  it("extracts node-id from a figma.connect URL with `-` separator and normalizes to `:`", () => {
    const src = `figma.connect(Button, "https://www.figma.com/design/abc/xyz?node-id=3384-3")`;
    const result = extractNodeIdsFromSource(src);
    expect(Array.from(result)).toEqual(["3384:3"]);
  });

  it("extracts node-id from a URL that already uses `:` form", () => {
    const src = `figma.connect(Card, "https://www.figma.com/design/abc/xyz?node-id=10:42")`;
    const result = extractNodeIdsFromSource(src);
    expect(Array.from(result)).toEqual(["10:42"]);
  });

  it("extracts multiple node-ids from a single file", () => {
    const src = `
      figma.connect(Button, "https://www.figma.com/design/abc/xyz?node-id=1-1");
      figma.connect(Card, "https://www.figma.com/design/abc/xyz?node-id=1-2");
    `;
    const result = extractNodeIdsFromSource(src);
    expect(result.has("1:1")).toBe(true);
    expect(result.has("1:2")).toBe(true);
  });

  it("ignores URL fragments without a node-id query param", () => {
    const src = `const link = "https://www.figma.com/design/abc/xyz";`;
    const result = extractNodeIdsFromSource(src);
    expect(result.size).toBe(0);
  });

  it("decodes URL-encoded node-id values when extracting", () => {
    const src = `figma.connect(X, "?node-id=1%3A1")`;
    const result = extractNodeIdsFromSource(src);
    expect(result.has("1:1")).toBe(true);
  });
});

describe("parseCodeConnectMappings", () => {
  it("flags skipReason='no-config' when figma.config.json is absent", () => {
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.size).toBe(0);
    expect(result.skipReason).toBe("no-config");
    expect(result.skippedReason).toMatch(/figma\.config\.json not found/);
  });

  it("flags skipReason='no-includes' when the config has no include paths", () => {
    writeFileSync(join(tmp, "figma.config.json"), JSON.stringify({}));
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.size).toBe(0);
    expect(result.skipReason).toBe("no-includes");
    expect(result.skippedReason).toMatch(/no codeConnect\.include/);
  });

  it("flags skipReason='malformed-config' when the config is malformed JSON", () => {
    writeFileSync(join(tmp, "figma.config.json"), "{ broken");
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.size).toBe(0);
    expect(result.skipReason).toBe("malformed-config");
    expect(result.skippedReason).toMatch(/malformed/);
  });

  it("scans a directory include path and finds node-ids in *.figma.tsx files", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(
      join(tmp, "src", "Button.figma.tsx"),
      `figma.connect(Button, "https://www.figma.com/design/abc/xyz?node-id=3384-3")`,
    );
    writeFileSync(
      join(tmp, "src", "NotAConnectFile.tsx"),
      `figma.connect(Other, "https://www.figma.com/design/abc/xyz?node-id=9999-9")`,
    );
    writeFileSync(
      join(tmp, "figma.config.json"),
      JSON.stringify({ codeConnect: { include: ["src"] } }),
    );

    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.has("3384:3")).toBe(true);
    expect(result.mappedNodeIds.has("9999:9")).toBe(false);
  });

  it("supports the legacy flat `include` shape (no `codeConnect` namespace)", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(
      join(tmp, "src", "Card.figma.tsx"),
      `figma.connect(Card, "https://figma.com/design/abc?node-id=10-42")`,
    );
    writeFileSync(
      join(tmp, "figma.config.json"),
      JSON.stringify({ include: ["src"] }),
    );
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.has("10:42")).toBe(true);
  });

  it("walks include paths with a glob suffix (** is treated as a recursive walk root)", () => {
    mkdirSync(join(tmp, "src", "components"), { recursive: true });
    writeFileSync(
      join(tmp, "src", "components", "Header.figma.tsx"),
      `figma.connect(Header, "?node-id=5-5")`,
    );
    writeFileSync(
      join(tmp, "figma.config.json"),
      JSON.stringify({ codeConnect: { include: ["src/**/*.figma.tsx"] } }),
    );
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.has("5:5")).toBe(true);
  });

  it("ignores node_modules and dotfile directories during the walk", () => {
    mkdirSync(join(tmp, "node_modules", "junk"), { recursive: true });
    mkdirSync(join(tmp, ".cache"), { recursive: true });
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(
      join(tmp, "node_modules", "junk", "Bad.figma.tsx"),
      `figma.connect(Bad, "?node-id=999-999")`,
    );
    writeFileSync(
      join(tmp, ".cache", "Bad.figma.tsx"),
      `figma.connect(Bad, "?node-id=888-888")`,
    );
    writeFileSync(
      join(tmp, "src", "Good.figma.tsx"),
      `figma.connect(Good, "?node-id=1-1")`,
    );
    writeFileSync(
      join(tmp, "figma.config.json"),
      JSON.stringify({ codeConnect: { include: ["."] } }),
    );
    const result = parseCodeConnectMappings(tmp);
    expect(result.mappedNodeIds.has("1:1")).toBe(true);
    expect(result.mappedNodeIds.has("999:999")).toBe(false);
    expect(result.mappedNodeIds.has("888:888")).toBe(false);
  });

  it("returns scannedFiles for debug visibility", () => {
    mkdirSync(join(tmp, "src"));
    const filePath = join(tmp, "src", "X.figma.tsx");
    writeFileSync(filePath, `figma.connect(X, "?node-id=1-1")`);
    writeFileSync(
      join(tmp, "figma.config.json"),
      JSON.stringify({ codeConnect: { include: ["src"] } }),
    );
    const result = parseCodeConnectMappings(tmp);
    expect(result.scannedFiles.length).toBeGreaterThan(0);
    expect(result.scannedFiles[0]).toMatch(/X\.figma\.tsx$/);
  });
});
