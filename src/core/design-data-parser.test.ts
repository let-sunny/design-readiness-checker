import { parseDesignData } from "./design-data-parser.js";

// Mock the adapter dependencies
vi.mock("../adapters/figma-mcp-adapter.js", () => ({
  parseMcpMetadataXml: vi.fn(
    (xml: string, fileKey: string, fileName?: string) => ({
      fileKey,
      name: fileName ?? "mcp-file",
      lastModified: "2024-01-01T00:00:00Z",
      version: "1",
      document: { id: "0:0", name: "Document", type: "DOCUMENT", visible: true },
      components: {},
      styles: {},
    })
  ),
}));

vi.mock("../adapters/figma-transformer.js", () => ({
  transformFigmaResponse: vi.fn((fileKey: string, response: unknown) => ({
    fileKey,
    name: (response as Record<string, unknown>)["name"],
    lastModified: "2024-01-01T00:00:00Z",
    version: "1",
    document: { id: "0:0", name: "Document", type: "DOCUMENT", visible: true },
    components: {},
    styles: {},
  })),
}));

describe("parseDesignData", () => {
  it("detects XML input and calls parseMcpMetadataXml", () => {
    const xml = '<figma-metadata fileKey="abc"><frame name="Test" /></figma-metadata>';
    const result = parseDesignData(xml, "abc123", "MyFile");

    expect(result.fileKey).toBe("abc123");
    expect(result.name).toBe("MyFile");
  });

  it("detects XML with leading whitespace", () => {
    const xml = '  \n  <root><node /></root>';
    const result = parseDesignData(xml, "key1");

    expect(result.fileKey).toBe("key1");
  });

  it("detects AnalysisFile JSON (has fileKey + document)", () => {
    const analysisFile = {
      fileKey: "existing-key",
      name: "My Design",
      lastModified: "2024-01-01",
      version: "1",
      document: { id: "0:0", name: "Doc", type: "DOCUMENT" },
      components: {},
      styles: {},
    };
    const data = JSON.stringify(analysisFile);

    const result = parseDesignData(data, "override-key");

    // Should return as-is since it has fileKey + document
    expect(result.fileKey).toBe("existing-key");
    expect(result.name).toBe("My Design");
  });

  it("detects Figma REST API response (has document + name but no fileKey)", () => {
    const apiResponse = {
      name: "API Design",
      lastModified: "2024-01-01",
      version: "1",
      document: { id: "0:0", name: "Doc", type: "DOCUMENT" },
      components: {},
      styles: {},
    };
    const data = JSON.stringify(apiResponse);

    const result = parseDesignData(data, "api-key");

    // Should call transformFigmaResponse which uses our mock
    expect(result.fileKey).toBe("api-key");
    expect(result.name).toBe("API Design");
  });

  it("throws for unrecognized JSON format (no document)", () => {
    const badData = JSON.stringify({ foo: "bar", baz: 123 });

    expect(() => parseDesignData(badData, "key")).toThrow(
      "Unrecognized designData format"
    );
  });

  it("throws for invalid JSON string", () => {
    expect(() => parseDesignData("not json at all {{{", "key")).toThrow();
  });

  it("throws for empty string", () => {
    expect(() => parseDesignData("", "key")).toThrow();
  });
});
