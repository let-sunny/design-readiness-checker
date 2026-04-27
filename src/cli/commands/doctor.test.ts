import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  formatDoctorReport,
  runCodeConnectChecks,
  runFigmaPublishCheck,
} from "./doctor.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "canicode-doctor-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function writePkg(deps: Record<string, string> = {}, devDeps: Record<string, string> = {}): void {
  writeFileSync(
    join(tmp, "package.json"),
    JSON.stringify({ name: "fixture", dependencies: deps, devDependencies: devDeps }),
  );
}

describe("runCodeConnectChecks", () => {
  it("flags both checks failed when neither package.json nor figma.config.json exist", () => {
    const results = runCodeConnectChecks(tmp);
    expect(results).toHaveLength(2);
    expect(results.every(r => !r.pass)).toBe(true);
    expect(results[0]?.remediation).toMatch(/No package\.json/);
  });

  it("passes when @figma/code-connect is in devDependencies and figma.config.json exists", () => {
    writePkg({}, { "@figma/code-connect": "^1.2.3" });
    writeFileSync(join(tmp, "figma.config.json"), "{}");
    const results = runCodeConnectChecks(tmp);
    expect(results.every(r => r.pass)).toBe(true);
    expect(results[0]?.detail).toBe("^1.2.3");
  });

  it("detects code-connect in dependencies (not just devDependencies)", () => {
    writePkg({ "@figma/code-connect": "1.0.0" });
    const results = runCodeConnectChecks(tmp);
    expect(results[0]?.pass).toBe(true);
    expect(results[0]?.detail).toBe("1.0.0");
  });

  it("recommends pnpm install when package.json exists but code-connect is missing", () => {
    writePkg({}, { vitest: "^1.0.0" });
    const results = runCodeConnectChecks(tmp);
    expect(results[0]?.pass).toBe(false);
    expect(results[0]?.remediation).toMatch(/pnpm add -D @figma\/code-connect/);
  });

  it("links the Code Connect docs when figma.config.json is missing", () => {
    writePkg({}, { "@figma/code-connect": "^1.0.0" });
    const results = runCodeConnectChecks(tmp);
    expect(results[1]?.pass).toBe(false);
    expect(results[1]?.remediation).toMatch(/figma\.com\/code-connect-docs/);
  });

  it("survives a malformed package.json without throwing", () => {
    writeFileSync(join(tmp, "package.json"), "{ this is not json");
    const results = runCodeConnectChecks(tmp);
    expect(results[0]?.pass).toBe(false);
  });
});

describe("formatDoctorReport", () => {
  it("renders ✅/❌ with detail and remediation lines", () => {
    const out = formatDoctorReport([
      { name: "@figma/code-connect installed", pass: true, detail: "1.0.0" },
      {
        name: "figma.config.json not found at repo root",
        pass: false,
        remediation: "see https://www.figma.com/code-connect-docs/",
      },
    ]);
    expect(out).toContain("✅ @figma/code-connect installed (1.0.0)");
    expect(out).toContain("❌ figma.config.json not found at repo root");
    expect(out).toContain("→ see https://www.figma.com/code-connect-docs/");
    expect(out).toContain("Some checks failed");
  });

  it("renders ⚠️ for inconclusive checks and uses a softer summary line (#532)", () => {
    const out = formatDoctorReport([
      { name: "@figma/code-connect installed", pass: true, detail: "1.0.0" },
      { name: "figma.config.json found at repo root", pass: true },
      {
        name: "Figma component published in a library",
        pass: false,
        inconclusive: true,
        detail: "FIGMA_TOKEN not configured — skipping publish-status check",
        remediation: "Set FIGMA_TOKEN.",
      },
    ]);
    expect(out).toContain("⚠️ Figma component published in a library");
    expect(out).toContain("Set FIGMA_TOKEN");
    expect(out).toContain("Blocking checks passed; some checks were skipped");
    expect(out).not.toContain("Some checks failed");
    expect(out).not.toContain("All checks passed.");
  });

  it("ends with all-pass summary when every check passes", () => {
    const out = formatDoctorReport([
      { name: "a", pass: true },
      { name: "b", pass: true },
    ]);
    expect(out).toContain("All checks passed.");
    expect(out).not.toContain("Some checks failed");
  });
});

describe("runFigmaPublishCheck (#532)", () => {
  const validUrl =
    "https://www.figma.com/design/PUNBNLflVnbxKwCSSb6BvK/test?node-id=3384-3";

  it("returns ✅ when the parsed nodeId matches a component in the published-components list", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: validUrl,
      token: "tok",
      fetchPublishedComponents: async () => [
        { node_id: "3384:3", name: "Button" },
      ],
    });
    expect(result.pass).toBe(true);
    expect(result.inconclusive).toBeUndefined();
    expect(result.detail).toContain("Button");
  });

  it("returns ❌ (not inconclusive) when the API responds but the nodeId is absent — Step 7d would fail with 'Published component not found'", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: validUrl,
      token: "tok",
      fetchPublishedComponents: async () => [
        { node_id: "9999:9", name: "Other" },
      ],
    });
    expect(result.pass).toBe(false);
    expect(result.inconclusive).toBeUndefined();
    expect(result.remediation).toMatch(/Publish library/);
  });

  it("returns ⚠️ inconclusive when FIGMA_TOKEN is missing — issue #532 keeps doctor informational, not a hard gate", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: validUrl,
      token: undefined,
      fetchPublishedComponents: undefined,
    });
    expect(result.pass).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.remediation).toMatch(/FIGMA_TOKEN/);
  });

  it("returns ⚠️ inconclusive when the Figma API call throws — Step 7d remains the authority", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: validUrl,
      token: "tok",
      fetchPublishedComponents: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    expect(result.pass).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toMatch(/ECONNREFUSED/);
  });

  it("returns ⚠️ inconclusive when the URL has no node-id — Code Connect mapping is per-component", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: "https://www.figma.com/design/abc/file",
      token: "tok",
      fetchPublishedComponents: async () => [],
    });
    expect(result.pass).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toContain("missing a node-id");
  });

  it("returns ⚠️ inconclusive when the URL is unparseable", async () => {
    const result = await runFigmaPublishCheck({
      figmaUrl: "not-a-figma-url",
      token: "tok",
      fetchPublishedComponents: async () => [],
    });
    expect(result.pass).toBe(false);
    expect(result.inconclusive).toBe(true);
    expect(result.detail).toMatch(/parse URL/);
  });
});

describe("doctor command", () => {
  it("creates an empty fixture directory and verifies isolation", () => {
    mkdirSync(join(tmp, "subdir"));
    const results = runCodeConnectChecks(join(tmp, "subdir"));
    expect(results.every(r => !r.pass)).toBe(true);
  });
});
