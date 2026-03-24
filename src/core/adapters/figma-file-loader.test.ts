import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { loadFigmaFileFromJson } from "./figma-file-loader.js";

const MINIMAL_FIGMA_DATA = {
  name: "Test Design",
  lastModified: "2024-01-01",
  version: "1",
  document: { id: "0:0", name: "Document", type: "DOCUMENT", children: [] },
  components: {},
  styles: {},
};

describe("loadFigmaFileFromJson", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "file-loader-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts fileKey from directory-based fixture (data.json → parent dir name)", async () => {
    const fixtureDir = join(tempDir, "my-design");
    mkdirSync(fixtureDir);
    writeFileSync(join(fixtureDir, "data.json"), JSON.stringify(MINIMAL_FIGMA_DATA));

    const result = await loadFigmaFileFromJson(join(fixtureDir, "data.json"));

    expect(result.fileKey).toBe("my-design");
  });

  it("extracts fileKey from legacy flat fixture (name.json → name)", async () => {
    writeFileSync(join(tempDir, "old-style.json"), JSON.stringify(MINIMAL_FIGMA_DATA));

    const result = await loadFigmaFileFromJson(join(tempDir, "old-style.json"));

    expect(result.fileKey).toBe("old-style");
  });

  it("loads file content correctly from directory-based fixture", async () => {
    const fixtureDir = join(tempDir, "card-grid");
    mkdirSync(fixtureDir);
    writeFileSync(join(fixtureDir, "data.json"), JSON.stringify(MINIMAL_FIGMA_DATA));

    const result = await loadFigmaFileFromJson(join(fixtureDir, "data.json"));

    expect(result.name).toBe("Test Design");
    expect(result.document).toBeDefined();
  });
});
