import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computeCodeConnectCoverage } from "./code-connect-coverage.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "canicode-cc-cov-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

const components = {
  "10:1": { key: "k1", name: "Button", description: "" },
  "10:2": { key: "k2", name: "Card", description: "" },
};

describe("computeCodeConnectCoverage", () => {
  it("returns undefined when figma.config.json is absent (no Code Connect adoption)", () => {
    expect(computeCodeConnectCoverage(components, tmp)).toBeUndefined();
  });

  it("returns 0/N when the config exists but has no include paths (adopted but empty)", () => {
    writeFileSync(join(tmp, "figma.config.json"), JSON.stringify({ codeConnect: { include: [] } }));
    expect(computeCodeConnectCoverage(components, tmp)).toEqual({ mapped: 0, total: 2 });
  });

  it("returns 0/N when the config is malformed (adopted but misconfigured)", () => {
    writeFileSync(join(tmp, "figma.config.json"), "{ broken");
    expect(computeCodeConnectCoverage(components, tmp)).toEqual({ mapped: 0, total: 2 });
  });
});
