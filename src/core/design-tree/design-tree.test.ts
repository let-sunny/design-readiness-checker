import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { generateDesignTree, generateDesignTreeWithStats } from "./design-tree.js";
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

describe("generateDesignTreeWithStats", () => {
  it("returns tree string, estimatedTokens, and bytes", () => {
    const file = makeFile(
      makeNode({
        id: "1:1",
        name: "Frame",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
        children: [
          makeNode({ id: "1:2", name: "Child", type: "TEXT", characters: "Hello", absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 } }),
        ],
      })
    );

    const stats = generateDesignTreeWithStats(file);

    expect(stats.tree).toContain("# Design Tree");
    expect(stats.tree).toContain("Frame (FRAME, 400x300)");
    expect(stats.bytes).toBeGreaterThan(0);
    expect(stats.estimatedTokens).toBeGreaterThan(0);
    expect(stats.estimatedTokens).toBe(Math.ceil(stats.tree.length / 4));
  });

  it("tree output matches generateDesignTree", () => {
    const file = makeFile(
      makeNode({ id: "1:1", name: "Root", type: "FRAME" })
    );

    const tree = generateDesignTree(file);
    const stats = generateDesignTreeWithStats(file);

    expect(stats.tree).toBe(tree);
  });
});

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

  describe("INSTANCE component annotation", () => {
    it("annotates INSTANCE nodes with component name when available", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Container",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
          children: [
            makeNode({
              id: "1:2",
              name: "MyButton",
              type: "INSTANCE",
              componentId: "comp:1",
              absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
            }),
          ],
        })
      );
      file.components = {
        "comp:1": { key: "abc", name: "Button", description: "" },
      };

      const output = generateDesignTree(file);

      expect(output).toContain("MyButton (INSTANCE, 120x40) [component: Button]");
    });

    it("does not annotate INSTANCE when componentId has no match", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "MyButton",
          type: "INSTANCE",
          componentId: "comp:999",
          absoluteBoundingBox: { x: 0, y: 0, width: 120, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("MyButton (INSTANCE, 120x40)");
      expect(output).not.toContain("[component:");
    });

    it("does not annotate non-INSTANCE nodes", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Card",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("[component:");
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

    it("TEXT nodes escape quotes and backslashes in characters", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Quote",
          type: "TEXT",
          characters: 'She said "hello"',
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain('text: "She said \\"hello\\""');
    });

    it("TEXT nodes escape backslashes in characters", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Path",
          type: "TEXT",
          characters: "C:\\Users\\file.txt",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 30 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain('text: "C:\\\\Users\\\\file.txt"');
    });

    it("TEXT nodes escape newlines in characters", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Multiline",
          type: "TEXT",
          characters: "Line 1\nLine 2\nLine 3",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
        })
      );

      const output = generateDesignTree(file);

      // Newlines should be escaped so text stays on one line
      expect(output).toContain('text: "Line 1\\nLine 2\\nLine 3"');
      // Should NOT split across lines
      const lines = output.split("\n");
      const textLine = lines.find((l) => l.includes("text:"));
      expect(textLine).toContain("Line 1\\nLine 2\\nLine 3");
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

    it("TEXT nodes include textDecoration when set", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Link",
          type: "TEXT",
          characters: "Read our T&Cs",
          style: { fontFamily: "Inter", textDecoration: "UNDERLINE" },
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-decoration: underline");
    });

    it("TEXT nodes skip textDecoration: NONE", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Normal",
          type: "TEXT",
          characters: "Normal text",
          style: { fontFamily: "Inter", textDecoration: "NONE" },
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("text-decoration");
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
    it("stroke outputs as border with strokeWeight and hex color", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "BorderedBox",
          type: "RECTANGLE",
          strokes: [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }],
          strokeWeight: 2,
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("border: 2px solid #FF0000");
    });

    it("defaults to 1px when strokeWeight is not set", () => {
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

    it("individualStrokeWeights outputs per-side borders", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "BottomBorder",
          type: "FRAME",
          strokes: [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }],
          individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 50 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("border-bottom: 1px solid");
      expect(output).not.toContain("border-top:");
      expect(output).not.toContain("border-right:");
      expect(output).not.toContain("border-left:");
      expect(output).not.toContain("border: ");
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

    it("skips fills with visible: false", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "InvisibleFill",
          type: "FRAME",
          fills: [{ type: "SOLID", visible: false, color: { r: 1, g: 1, b: 1 } }],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("background:");
    });

    it("IMAGE fill on leaf node outputs content-image: [IMAGE]", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "ImageFrame",
          type: "FRAME",
          fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("content-image: [IMAGE]");
    });

    it("IMAGE fill on node with children outputs background-image: [IMAGE]", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "HeroSection",
          type: "FRAME",
          fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
          absoluteBoundingBox: { x: 0, y: 0, width: 1200, height: 500 },
          children: [
            makeNode({ id: "1:2", name: "Title", type: "TEXT", absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 40 } }),
          ],
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("background-image: [IMAGE]");
      expect(output).not.toContain("content-image:");
    });

    it("shows both background and content-image when both fill types exist on leaf", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "MixedFill",
          type: "FRAME",
          fills: [
            { type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.95 } },
            { type: "IMAGE", scaleMode: "FILL", imageRef: "xyz" },
          ],
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("background: #");
      expect(output).toContain("content-image: [IMAGE]");
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

  describe("IMAGE fill with imageDir mapping", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "design-tree-image-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("IMAGE fill with imageDir and mapping outputs url(images/...)", () => {
      const imageDir = join(tempDir, "images");
      mkdirSync(imageDir);
      writeFileSync(
        join(imageDir, "mapping.json"),
        JSON.stringify({ "1:2": "hero-banner@2x.png" })
      );

      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Container",
          type: "FRAME",
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 300 },
          children: [
            makeNode({
              id: "1:2",
              name: "HeroBanner",
              type: "FRAME",
              fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
              absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
            }),
          ],
        })
      );

      const output = generateDesignTree(file, { imageDir });

      expect(output).toContain("content-image: url(images/hero-banner@2x.png)");
      expect(output).not.toContain("content-image: [IMAGE]");
    });

    it("IMAGE fill without imageDir on leaf outputs content-image: [IMAGE]", () => {
      const file = makeFile(
        makeNode({
          id: "1:2",
          name: "HeroBanner",
          type: "FRAME",
          fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("content-image: [IMAGE]");
      expect(output).not.toContain("url(images/");
    });

    it("IMAGE fill with imageDir but no mapping entry on leaf outputs content-image: [IMAGE]", () => {
      const imageDir = join(tempDir, "images");
      mkdirSync(imageDir);
      writeFileSync(
        join(imageDir, "mapping.json"),
        JSON.stringify({ "99:99": "other-image@2x.png" })
      );

      const file = makeFile(
        makeNode({
          id: "1:2",
          name: "HeroBanner",
          type: "FRAME",
          fills: [{ type: "IMAGE", scaleMode: "FILL", imageRef: "abc123" }],
          absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 200 },
        })
      );

      const output = generateDesignTree(file, { imageDir });

      expect(output).toContain("content-image: [IMAGE]");
      expect(output).not.toContain("url(images/");
    });
  });

  describe("text auto-resize and truncation", () => {
    it("emits text-resize: auto for WIDTH_AND_HEIGHT", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Title",
          type: "TEXT",
          characters: "Hello",
          style: { fontFamily: "Inter", textAutoResize: "WIDTH_AND_HEIGHT" },
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-resize: auto");
    });

    it("emits text-resize: fixed-height for HEIGHT", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Body",
          type: "TEXT",
          characters: "Wrapped text",
          style: { fontFamily: "Inter", textAutoResize: "HEIGHT" },
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 48 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-resize: fixed-height");
    });

    it("emits text-resize: truncate with max-lines for TRUNCATE", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Truncated",
          type: "TEXT",
          characters: "Long text that gets cut off",
          style: { fontFamily: "Inter", textAutoResize: "TRUNCATE" },
          maxLines: 2,
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-resize: truncate");
      expect(output).toContain("text-overflow: ellipsis");
      expect(output).toContain("max-lines: 2");
    });

    it("emits text-overflow: ellipsis when textTruncation is ENDING", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Ellipsis",
          type: "TEXT",
          characters: "Truncated text",
          style: { fontFamily: "Inter", textAutoResize: "HEIGHT" },
          textTruncation: "ENDING",
          maxLines: 3,
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 60 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-overflow: ellipsis");
      expect(output).toContain("max-lines: 3");
    });

    it("emits paragraph-spacing when set", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Paragraphs",
          type: "TEXT",
          characters: "First paragraph\n\nSecond paragraph",
          style: { fontFamily: "Inter", paragraphSpacing: 16 },
          absoluteBoundingBox: { x: 0, y: 0, width: 300, height: 100 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("paragraph-spacing: 16px");
    });

    it("emits text-resize: truncate without max-lines when maxLines is not set", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "TruncateNoMax",
          type: "TEXT",
          characters: "Truncated",
          style: { fontFamily: "Inter", textAutoResize: "TRUNCATE" },
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).toContain("text-resize: truncate");
      expect(output).toContain("text-overflow: ellipsis");
      expect(output).not.toContain("max-lines:");
    });

    it("does not emit text-overflow for textTruncation: DISABLED", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "NoTruncation",
          type: "TEXT",
          characters: "Normal text",
          style: { fontFamily: "Inter", textAutoResize: "HEIGHT" },
          textTruncation: "DISABLED",
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("text-overflow:");
    });

    it("does not emit paragraph-spacing for 0", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "ZeroSpacing",
          type: "TEXT",
          characters: "Text",
          style: { fontFamily: "Inter", paragraphSpacing: 0 },
          absoluteBoundingBox: { x: 0, y: 0, width: 200, height: 40 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("paragraph-spacing:");
    });

    it("does not emit text-resize for NONE or missing textAutoResize", () => {
      const file = makeFile(
        makeNode({
          id: "1:1",
          name: "Plain",
          type: "TEXT",
          characters: "No resize",
          style: { fontFamily: "Inter" },
          absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 20 },
        })
      );

      const output = generateDesignTree(file);

      expect(output).not.toContain("text-resize:");
    });
  });
});
