import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { isFigmaUrl, isJsonFile, loadFile } from "./loader.js";

describe("isFigmaUrl", () => {
  it("returns true for figma.com design URLs", () => {
    expect(isFigmaUrl("https://www.figma.com/design/abc123/MyDesign")).toBe(true);
  });

  it("returns true for figma.com file URLs", () => {
    expect(isFigmaUrl("https://www.figma.com/file/abc123/MyDesign")).toBe(true);
  });

  it("returns true for figma.com proto URLs", () => {
    expect(isFigmaUrl("https://www.figma.com/proto/abc123/MyDesign")).toBe(true);
  });

  it("returns true for URL with node-id", () => {
    expect(
      isFigmaUrl(
        "https://www.figma.com/design/abc123/MyDesign?node-id=1-234"
      )
    ).toBe(true);
  });

  it("returns false for non-figma URLs", () => {
    expect(isFigmaUrl("https://example.com/page")).toBe(false);
  });

  it("returns false for random strings", () => {
    expect(isFigmaUrl("not-a-url")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isFigmaUrl("")).toBe(false);
  });

  it("returns true for URL containing figma.com/ anywhere", () => {
    expect(isFigmaUrl("http://figma.com/something")).toBe(true);
  });
});

describe("isJsonFile", () => {
  it("returns true for .json extension", () => {
    expect(isJsonFile("fixtures/my-design.json")).toBe(true);
  });

  it("returns true for absolute path with .json", () => {
    expect(isJsonFile("/home/user/data.json")).toBe(true);
  });

  it("returns false for .ts files", () => {
    expect(isJsonFile("src/index.ts")).toBe(false);
  });

  it("returns false for .html files", () => {
    expect(isJsonFile("report.html")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isJsonFile("")).toBe(false);
  });

  it("returns false for string ending with .jsonl", () => {
    expect(isJsonFile("data.jsonl")).toBe(false);
  });
});

describe("loadFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("throws for non-existent JSON file", async () => {
    await expect(
      loadFile(join(tempDir, "nonexistent.json"))
    ).rejects.toThrow("File not found");
  });

  it("throws for invalid input (not URL and not JSON)", async () => {
    await expect(loadFile("some-random-string")).rejects.toThrow(
      "Invalid input"
    );
  });

  it("throws for empty string input", async () => {
    await expect(loadFile("")).rejects.toThrow("Invalid input");
  });

  it("throws for plain text file path", async () => {
    await expect(loadFile("readme.txt")).rejects.toThrow("Invalid input");
  });
});
