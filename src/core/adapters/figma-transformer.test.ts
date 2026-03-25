import { transformFigmaResponse } from "./figma-transformer.js";
import type { GetFileResponse } from "@figma/rest-api-spec";

function makeFigmaNode(overrides: Record<string, unknown>) {
  return {
    id: "0:1",
    name: "Test",
    type: "FRAME",
    ...overrides,
  };
}

function makeFigmaResponse(document: Record<string, unknown>): GetFileResponse {
  return {
    name: "TestFile",
    lastModified: "2024-01-01",
    version: "1",
    document: document as GetFileResponse["document"],
    components: {},
    styles: {},
    schemaVersion: 0,
    role: "owner",
    thumbnailUrl: "",
    editorType: "figma",
  } as GetFileResponse;
}

describe("figma-transformer responsive fields", () => {
  it("maps minWidth/maxWidth/minHeight/maxHeight", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({
        minWidth: 100,
        maxWidth: 800,
        minHeight: 50,
        maxHeight: 600,
      }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.minWidth).toBe(100);
    expect(result.document.maxWidth).toBe(800);
    expect(result.document.minHeight).toBe(50);
    expect(result.document.maxHeight).toBe(600);
  });

  it("maps layoutGrow", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({ layoutGrow: 1 }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.layoutGrow).toBe(1);
  });

  it("maps constraints", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({
        constraints: { horizontal: "LEFT_RIGHT", vertical: "TOP_BOTTOM" },
      }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.constraints).toEqual({
      horizontal: "LEFT_RIGHT",
      vertical: "TOP_BOTTOM",
    });
  });

  it("maps layoutWrap and counterAxisSpacing", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({
        layoutWrap: "WRAP",
        counterAxisSpacing: 16,
        counterAxisAlignContent: "SPACE_BETWEEN",
      }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.layoutWrap).toBe("WRAP");
    expect(result.document.counterAxisSpacing).toBe(16);
    expect(result.document.counterAxisAlignContent).toBe("SPACE_BETWEEN");
  });

  it("maps clipsContent and overflowDirection", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({
        clipsContent: true,
        overflowDirection: "VERTICAL_SCROLLING",
      }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.clipsContent).toBe(true);
    expect(result.document.overflowDirection).toBe("VERTICAL_SCROLLING");
  });

  it("maps layoutMode GRID", () => {
    const response = makeFigmaResponse(
      makeFigmaNode({ layoutMode: "GRID" }),
    );
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.layoutMode).toBe("GRID");
  });

  it("does not set fields when absent", () => {
    const response = makeFigmaResponse(makeFigmaNode({}));
    const result = transformFigmaResponse("test-key", response);
    expect(result.document.minWidth).toBeUndefined();
    expect(result.document.maxWidth).toBeUndefined();
    expect(result.document.layoutWrap).toBeUndefined();
    expect(result.document.clipsContent).toBeUndefined();
    expect(result.document.constraints).toBeUndefined();
  });
});
