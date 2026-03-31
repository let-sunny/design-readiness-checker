import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const CLI = join(process.cwd(), "dist/cli/index.js");

describe("code-metrics CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "code-metrics-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("outputs JSON with code metrics", () => {
    const html = `<html><head><style>.foo { color: red; } .bar { --primary: blue; --spacing: 8px; }</style></head><body><div class="foo">test</div></body></html>`;
    const inputPath = join(tempDir, "test.html");
    writeFileSync(inputPath, html);

    const stdout = execFileSync("node", [CLI, "code-metrics", inputPath], { encoding: "utf-8" });
    const metrics = JSON.parse(stdout) as { htmlBytes: number; htmlLines: number; cssClassCount: number; cssVariableCount: number };

    expect(metrics.htmlBytes).toBeGreaterThan(0);
    expect(metrics.htmlLines).toBeGreaterThanOrEqual(1);
    expect(metrics.cssClassCount).toBe(2);
    expect(metrics.cssVariableCount).toBe(2);
  });

  it("exits with error for missing file", () => {
    expect(() => {
      execFileSync("node", [CLI, "code-metrics", join(tempDir, "nonexistent.html")], { stdio: "pipe" });
    }).toThrow();
  });
});
