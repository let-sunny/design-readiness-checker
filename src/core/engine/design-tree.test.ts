import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { generateDesignTree } from "./design-tree.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

function makeFile(document: AnalysisNode): AnalysisFile {
  return {
    fileKey: "test-key",
    name: "Test File",
    lastModified: "2024-01-01T00:00:00Z",
    version: "1",
    document,
    components: {},
    styles: {},
  };
}

function makeNode(overrides: Partial<AnalysisNode> & { id: string; name: string; type: AnalysisNode["type"] }): AnalysisNode {
  return {
    visible: true,
    ...overrides,
  };
}

describe("generateDesignTree", () => {
  describe("header generation", () => {
    it("generates header with root dimensions", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Frame",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 375.6, height: 812.4 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("# Design Tree");
      expect(output).toContain("# Root: 376px x 812px");
    });

    it("outputs header lines describing the format", () => {
      const file = makeFile(
        makeNode({ id: "1:1", name: "Root", type: "FRAME" })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("# Each node shows: name (TYPE, WxH) followed by CSS-like styles");
      expect(output).toContain("# Reproduce this tree as HTML");
    });

    it("uses 0x0 dimensions when absoluteBoundingBox is absent", () => {
      const file = makeFile(
        makeNode({ id: "1:1", name: "Root", type: "FRAME" })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("# Root: 0px x 0px");
    });
  });

  describe("TEXT nodes", () => {
    it("TEXT nodes use color: not background: for fill", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Label",
          type: "TEXT",
          characters: "Hello",
          // A TEXT node must have a style property for color to be output
          style: { fontFamily: "Inter" },
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("color: #000000");
      expect(output).not.toContain("background: #000000");
    });

    it("TEXT nodes include text: with quoted content", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Heading",
          type: "TEXT",
          characters: "Welcome",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain('text: "Welcome"');
    });

    it("TEXT nodes with no characters do not include text: property", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "EmptyText",
          type: "TEXT",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("text:");
    });

    it("TEXT nodes include typography styles from style property", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Body",
          type: "TEXT",
          characters: "Content",
          style: {
            fontFamily: "Inter",
            fontWeight: 400,
            fontSize: 16,
            lineHeightPx: 24,
            letterSpacing: 0.5,
          },
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 24 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain('font-family: "Inter"');
      expect(output).toContain("font-weight: 400");
      expect(output).toContain("font-size: 16px");
      expect(output).toContain("line-height: 24px");
      expect(output).toContain("letter-spacing: 0.5px");
    });
  });

  describe("layout nodes", () => {
    it("VERTICAL layout mode produces flex column styles", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "VStack",
          type: "FRAME",
          layoutMode: "VERTICAL",
          itemSpacing: 8,
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 400 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("display: flex");
      expect(output).toContain("flex-direction: column");
      expect(output).toContain("gap: 8px");
    });

    it("HORIZONTAL layout mode produces flex row styles", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "HStack",
          type: "FRAME",
          layoutMode: "HORIZONTAL",
          itemSpacing: 12,
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 60 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("display: flex");
      expect(output).toContain("flex-direction: row");
      expect(output).toContain("gap: 12px");
    });

    it("layout node includes justify-content and align-items when set", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Card",
          type: "FRAME",
          layoutMode: "VERTICAL",
          primaryAxisAlignItems: "CENTER",
          counterAxisAlignItems: "MIN",
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("justify-content: center");
      expect(output).toContain("align-items: flex-start");
    });

    it("NONE layout mode does not produce flex styles", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "AbsoluteFrame",
          type: "FRAME",
          layoutMode: "NONE",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("display: flex");
    });
  });

  describe("padding formatting", () => {
    it("padding is formatted as padding: top right bottom left", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Padded",
          type: "FRAME",
          paddingTop: 16,
          paddingRight: 24,
          paddingBottom: 16,
          paddingLeft: 24,
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("padding: 16px 24px 16px 24px");
    });

    it("zero padding is not output", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "NoPadding",
          type: "FRAME",
          paddingTop: 0,
          paddingRight: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("padding:");
    });

    it("partial padding (only top) is still output with all four values", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "TopPad",
          type: "FRAME",
          paddingTop: 8,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("padding: 8px 0px 0px 0px");
    });
  });

  describe("cornerRadius", () => {
    it("cornerRadius outputs as border-radius", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "RoundedButton",
          type: "RECTANGLE",
          cornerRadius: 8,
          absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("border-radius: 8px");
    });

    it("zero cornerRadius is not output", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "SharpBox",
          type: "RECTANGLE",
          cornerRadius: 0,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("border-radius:");
    });
  });

  describe("strokes", () => {
    it("stroke outputs as border with 1px solid and hex color", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "BorderedBox",
          type: "RECTANGLE",
          strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("border: 1px solid #FF0000");
    });
  });

  describe("fills (non-TEXT)", () => {
    it("FRAME with solid fill gets background: with hex color", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "ColoredFrame",
          type: "FRAME",
          fills: [{ type: "SOLID", color: { r: 0, g: 0.502, b: 1 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("background: #");
      expect(output).not.toContain("color: #");
    });
  });

  describe("invisible nodes", () => {
    it("nodes with visible: false are excluded from output", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Visible",
          type: "FRAME",
          visible: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
          children: [
            makeNode({
              id: "1:2",
              name: "HiddenChild",
              type: "RECTANGLE",
              visible: false,
              absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
            }),
            makeNode({
              id: "1:3",
              name: "VisibleChild",
              type: "RECTANGLE",
              visible: true,
              absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
            }),
          ],
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("HiddenChild");
      expect(output).toContain("VisibleChild");
    });

    it("root node with visible: false produces empty tree body", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "HiddenRoot",
          type: "FRAME",
          visible: false,
        })
      );

      const output = generateDesignTree(file);

      // Header is still present but tree body is empty
      expect(output).toContain("# Design Tree");
      expect(output).not.toContain("HiddenRoot");
    });
  });

  describe("empty/minimal fixture", () => {
    it("produces valid output with just a root node and no children", () => {
      const file = makeFile(
        makeNode({
          id: "0:0",
          name: "Document",
          type: "DOCUMENT",
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("# Design Tree");
      expect(output).toContain("Document (DOCUMENT, ?x?)");
    });

    it("handles null absoluteBoundingBox gracefully", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Frame",
          type: "FRAME",
          absoluteBoundingBox: null,
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("Frame (FRAME, ?x?)");
    });
  });

  describe("nested children indentation", () => {
    it("nested children are indented with two spaces per level", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Parent",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 300 },
          children: [
            makeNode({
              id: "1:2",
              name: "Child",
              type: "FRAME",
              absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
              children: [
                makeNode({
                  id: "1:3",
                  name: "Grandchild",
                  type: "RECTANGLE",
                  absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
                }),
              ],
            }),
          ],
        })
      );

      const output = generateDesignTree(file);
      const lines = output.split("\n");

      const parentLine = lines.find((l) => l.includes("Parent (FRAME"));
      const childLine = lines.find((l) => l.includes("Child (FRAME"));
      const grandchildLine = lines.find((l) => l.includes("Grandchild (RECTANGLE"));

      expect(parentLine).toBeDefined();
      expect(childLine).toBeDefined();
      expect(grandchildLine).toBeDefined();

      // Parent at indent 0 — no leading spaces before the name
      expect(parentLine!.match(/^(\s*)/)?.[1]).toBe("");
      // Child at indent 1 — two leading spaces
      expect(childLine!.startsWith("  ")).toBe(true);
      expect(childLine!.startsWith("    ")).toBe(false);
      // Grandchild at indent 2 — four leading spaces
      expect(grandchildLine!.startsWith("    ")).toBe(true);
      expect(grandchildLine!.startsWith("      ")).toBe(false);
    });

    it("style lines are indented one extra level relative to their node header", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "StyledNode",
          type: "FRAME",
          layoutMode: "VERTICAL",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
          children: [
            makeNode({
              id: "1:2",
              name: "InnerNode",
              type: "FRAME",
              layoutMode: "HORIZONTAL",
              absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
            }),
          ],
        })
      );

      const output = generateDesignTree(file);
      const lines = output.split("\n");

      const styleLine = lines.find((l) => l.includes("display: flex; flex-direction: column"));
      const innerStyleLine = lines.find((l) => l.includes("display: flex; flex-direction: row"));

      // Root node style line should start with two spaces ("  style: ...")
      expect(styleLine).toBeDefined();
      expect(styleLine!.startsWith("  style:")).toBe(true);

      // Child node style line should start with four spaces ("    style: ...")
      expect(innerStyleLine).toBeDefined();
      expect(innerStyleLine!.startsWith("    style:")).toBe(true);
    });
  });

  describe("layoutSizing", () => {
    it("FILL horizontal sizing outputs width: 100%", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "FillH",
          type: "FRAME",
          layoutSizingHorizontal: "FILL",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("width: 100%");
    });

    it("FILL vertical sizing outputs height: 100%", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "FillV",
          type: "FRAME",
          layoutSizingVertical: "FILL",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("height: 100%");
    });
  });

  describe("shadows", () => {
    it("DROP_SHADOW effect outputs as box-shadow", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "ShadowBox",
          type: "FRAME",
          effects: [
            {
              type: "DROP_SHADOW",
              visible: true,
              color: { r: 0, g: 0, b: 0 },
              offset: { x: 2, y: 4 },
              radius: 8,
            },
          ],
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("box-shadow: 2px 4px 8px #000000");
    });

    it("invisible shadow effect is not output", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "NoShadow",
          type: "FRAME",
          effects: [
            {
              type: "DROP_SHADOW",
              visible: false,
              color: { r: 0, g: 0, b: 0 },
              offset: { x: 0, y: 2 },
              radius: 4,
            },
          ],
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("box-shadow:");
    });
  });

  describe("vector SVG inlining", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "design-tree-vector-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("inlines SVG content for VECTOR nodes when vectorDir is provided", () => {
      const vectorDir = join(tempDir, "vectors");
      mkdirSync(vectorDir);
      writeFileSync(join(vectorDir, "1-2.svg"), '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>');

      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Container",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
          children: [
            makeNode({
              id: "1:2",
              name: "Icon",
              type: "VECTOR",
              absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
            }),
          ],
        })
      );

      const output = generateDesignTree(file, { vectorDir });

      expect(output).toContain("svg:");
      expect(output).toContain('<svg viewBox="0 0 24 24">');
    });

    it("does not include svg: when vectorDir is not provided", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Icon",
          type: "VECTOR",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("svg:");
    });

    it("skips SVG when file does not exist for the node ID", () => {
      const vectorDir = join(tempDir, "vectors");
      mkdirSync(vectorDir);
      // No SVG file for node 1:1

      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "MissingIcon",
          type: "VECTOR",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
        })
      );

      const output = generateDesignTree(file, { vectorDir });

      expect(output).not.toContain("svg:");
    });

    it("converts colon in node ID to hyphen for SVG filename", () => {
      const vectorDir = join(tempDir, "vectors");
      mkdirSync(vectorDir);
      // Node ID "10:20" → filename "10-20.svg"
      writeFileSync(join(vectorDir, "10-20.svg"), '<svg><circle r="5"/></svg>');

      const file = makeFile(
        makeNode({
          id: "10:20",
          name: "DotIcon",
          type: "VECTOR",
          absoluteBoundingBox: { x: 0, y: 0, width: 16, height: 16 },
        })
      );

      const output = generateDesignTree(file, { vectorDir });

      expect(output).toContain("svg:");
      expect(output).toContain('<circle r="5"/>');
    });

    it("does not inline SVG for non-VECTOR node types", () => {
      const vectorDir = join(tempDir, "vectors");
      mkdirSync(vectorDir);
      writeFileSync(join(vectorDir, "1-1.svg"), '<svg><rect/></svg>');

      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "NotVector",
          type: "RECTANGLE",
          absoluteBoundingBox: { x: 0, y: 0, width: 24, height: 24 },
        })
      );

      const output = generateDesignTree(file, { vectorDir });

      expect(output).not.toContain("svg:");
    });
  });
});
