import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const CLI = join(process.cwd(), "dist/cli/index.js");

describe("html-postprocess CLI", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "html-postprocess-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("sanitizes script tags and event handlers", () => {
    const inputPath = join(tempDir, "input.html");
    writeFileSync(inputPath, `<html><body><script>alert("xss")</script><div onclick="hack()">hi</div></body></html>`);

    execFileSync("node", [CLI, "html-postprocess", inputPath]);

    const result = readFileSync(inputPath, "utf-8");
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("onclick");
    expect(result).toContain("<div>hi</div>");
  });

  it("writes to --output path when specified", () => {
    const inputPath = join(tempDir, "input.html");
    const outputPath = join(tempDir, "output.html");
    writeFileSync(inputPath, `<html><body><div>hello</div></body></html>`);

    execFileSync("node", [CLI, "html-postprocess", inputPath, "--output", outputPath]);

    const result = readFileSync(outputPath, "utf-8");
    expect(result).toContain("hello");
    // Input should be unchanged
    expect(readFileSync(inputPath, "utf-8")).toContain("hello");
  });

  it("exits with error for missing file", () => {
    expect(() => {
      execFileSync("node", [CLI, "html-postprocess", join(tempDir, "nonexistent.html")], { stdio: "pipe" });
    }).toThrow();
  });
});
