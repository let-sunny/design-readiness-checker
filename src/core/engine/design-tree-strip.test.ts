import { stripDesignTree, DESIGN_TREE_INFO_TYPES, ALL_STRIP_TYPES } from "./design-tree-strip.js";

/** Shared test fixture containing all information types. */
const FIXTURE = [
  "# Design Tree",
  "# Root: 375px x 812px",
  "# Each node shows: name (TYPE, WxH) followed by CSS-like styles",
  "",
  "Page (FRAME, 375x812)",
  '  style: display: flex; flex-direction: column; gap: 16px; padding: 20px 20px 20px 20px; background: #FFFFFF /* var:VariableID:3919:36423 */; overflow: hidden',
  "  Header (FRAME, 375x60)",
  '    style: display: flex; flex-direction: row; column-gap: 8px /* var:VariableID:9:11259 */; align-items: center; width: 100%; background: #2C2C2C',
  '    Logo (VECTOR, 40x40)',
  '      style: border: 2px solid #1E1E1E; svg: <svg viewBox="0 0 40 40"><path d="M10 20" fill="#49454F"/></svg>',
  '    Title (TEXT, 200x24)',
  '      style: /* text-style: Heading / Large */; font-family: "Inter"; font-weight: 700; font-size: 24px; line-height: 32px; letter-spacing: -0.5px; text-align: left; color: #FFFFFF /* var:VariableID:3919:36461 */; text: "My Store"',
  "  Card (INSTANCE, 335x200) [component: Product Card]",
  "    component-properties: Size=Large, HasImage=true",
  '    style: display: flex; flex-direction: column; gap: 12px; padding: 16px 16px 16px 16px; background: #F5F5F5; border-radius: 12px; box-shadow: 0px 4px 8px #000000; min-width: 300px',
  "    Image (FRAME, 303x120)",
  "      style: width: 100%; height: 100%; content-image: url(images/product@2x.png); object-fit: cover; border-radius: 8px; opacity: 0.95",
  "    Price (TEXT, 100x20)",
  '      style: font-family: "Inter"; font-weight: 600; font-size: 18px; line-height: 20px; color: rgba(30, 30, 30, 0.8); text: "$29.99"',
  "  Button (INSTANCE, 335x48) [component: Button]",
  "    component-properties: State=Default, Size=Medium",
  '    style: display: flex; flex-direction: row; justify-content: center; align-items: center; padding: 12px 24px 12px 24px; background: #0066CC; border-radius: 8px; flex-grow: 1; align-self: STRETCH',
  '    [hover]: background: #004499',
  "    Label (TEXT, 80x16)",
  '      style: font-family: "Inter"; font-weight: 500; font-size: 16px; line-height: 16px; text-align: center; color: #FFFFFF; text: "Buy Now"',
].join("\n");

describe("stripDesignTree", () => {
  describe("layout-direction-spacing", () => {
    const result = stripDesignTree(FIXTURE, "layout-direction-spacing");

    it("removes display, flex-direction, gap, padding, align-items, justify-content", () => {
      expect(result).not.toContain("display: flex");
      expect(result).not.toContain("flex-direction:");
      expect(result).not.toContain("gap:");
      expect(result).not.toContain("column-gap:");
      expect(result).not.toContain("row-gap:");
      expect(result).not.toContain("padding:");
      expect(result).not.toContain("justify-content:");
      expect(result).not.toContain("align-items:");
      expect(result).not.toContain("align-self:");
    });

    it("preserves colors, typography, and other properties", () => {
      expect(result).toContain("#FFFFFF");
      expect(result).toContain('font-family: "Inter"');
      expect(result).toContain("border-radius: 12px");
      expect(result).toContain("box-shadow:");
    });

    it("preserves text content", () => {
      expect(result).toContain('text: "My Store"');
      expect(result).toContain('text: "$29.99"');
    });

    it("preserves node headers", () => {
      expect(result).toContain("Page (FRAME, 375x812)");
      expect(result).toContain("Card (INSTANCE, 335x200) [component: Product Card]");
    });
  });

  describe("size-constraints", () => {
    const result = stripDesignTree(FIXTURE, "size-constraints");

    it("removes width: 100%, height: 100%, min-width, flex-grow", () => {
      expect(result).not.toContain("width: 100%");
      expect(result).not.toContain("height: 100%");
      expect(result).not.toContain("min-width:");
      expect(result).not.toContain("flex-grow:");
    });

    it("preserves layout and colors", () => {
      expect(result).toContain("display: flex");
      expect(result).toContain("#FFFFFF");
    });
  });

  describe("color-values", () => {
    const result = stripDesignTree(FIXTURE, "color-values");

    it("replaces hex colors with [COLOR]", () => {
      expect(result).not.toMatch(/#[0-9A-Fa-f]{6}/);
      expect(result).toContain("background: [COLOR]");
      expect(result).toContain("color: [COLOR]");
    });

    it("replaces rgba colors with [COLOR]", () => {
      expect(result).not.toContain("rgba(");
    });

    it("replaces colors in border and box-shadow", () => {
      expect(result).toContain("border: 2px solid [COLOR]");
      expect(result).toContain("box-shadow: 0px 4px 8px [COLOR]");
    });

    it("replaces colors in SVG fill/stroke", () => {
      expect(result).toContain('fill="[COLOR]"');
    });

    it("replaces colors in [hover] lines", () => {
      expect(result).toContain("[hover]: background: [COLOR]");
    });

    it("preserves text content", () => {
      expect(result).toContain('text: "$29.99"');
      expect(result).toContain('text: "My Store"');
    });

    it("preserves content-image", () => {
      expect(result).toContain("content-image: url(images/product@2x.png)");
    });
  });

  describe("typography", () => {
    const result = stripDesignTree(FIXTURE, "typography");

    it("removes font properties and text-style comments", () => {
      expect(result).not.toContain("font-family:");
      expect(result).not.toContain("font-weight:");
      expect(result).not.toContain("font-size:");
      expect(result).not.toContain("line-height:");
      expect(result).not.toContain("letter-spacing:");
      expect(result).not.toContain("text-align:");
      expect(result).not.toContain("text-style:");
    });

    it("preserves text content and colors", () => {
      expect(result).toContain('text: "My Store"');
      expect(result).toContain("#FFFFFF");
    });
  });

  describe("shadows-effects", () => {
    const result = stripDesignTree(FIXTURE, "shadows-effects");

    it("removes box-shadow and opacity", () => {
      expect(result).not.toContain("box-shadow:");
      expect(result).not.toContain("opacity:");
    });

    it("preserves everything else", () => {
      expect(result).toContain("display: flex");
      expect(result).toContain("border-radius: 12px");
    });
  });

  describe("component-references", () => {
    const result = stripDesignTree(FIXTURE, "component-references");

    it("removes [component: ...] from headers", () => {
      expect(result).not.toContain("[component:");
      expect(result).toContain("Card (INSTANCE, 335x200)");
      expect(result).toContain("Button (INSTANCE, 335x48)");
    });

    it("removes component-properties lines", () => {
      expect(result).not.toContain("component-properties:");
    });

    it("preserves styles and text", () => {
      expect(result).toContain("display: flex");
      expect(result).toContain('text: "Buy Now"');
    });
  });

  describe("component-descriptions", () => {
    it("returns tree unchanged (no-op)", () => {
      expect(stripDesignTree(FIXTURE, "component-descriptions")).toBe(FIXTURE);
    });
  });

  describe("node-names-hierarchy", () => {
    const result = stripDesignTree(FIXTURE, "node-names-hierarchy");

    it("replaces node names with Node1, Node2, etc", () => {
      expect(result).toContain("Node1 (FRAME, 375x812)");
      expect(result).toContain("Node2 (FRAME, 375x60)");
      expect(result).not.toContain("Page (FRAME");
      expect(result).not.toContain("Header (FRAME");
    });

    it("preserves comment headers and component annotations", () => {
      expect(result).toContain("# Design Tree");
      expect(result).toContain("[component: Product Card]");
    });
  });

  describe("overflow-text-behavior", () => {
    const result = stripDesignTree(FIXTURE, "overflow-text-behavior");

    it("removes overflow: hidden", () => {
      expect(result).not.toContain("overflow:");
    });

    it("preserves everything else", () => {
      expect(result).toContain("display: flex");
      expect(result).toContain("#FFFFFF");
    });
  });

  describe("hover-interaction-states", () => {
    const result = stripDesignTree(FIXTURE, "hover-interaction-states");

    it("removes [hover] lines", () => {
      expect(result).not.toContain("[hover]:");
    });

    it("preserves all other lines", () => {
      expect(result).toContain("Button (INSTANCE, 335x48) [component: Button]");
      expect(result).toContain("background: #0066CC");
    });
  });

  describe("variable-references", () => {
    const result = stripDesignTree(FIXTURE, "variable-references");

    it("removes /* var:... */ comments", () => {
      expect(result).not.toContain("/* var:");
    });

    it("preserves /* text-style:... */ comments", () => {
      expect(result).toContain("/* text-style: Heading / Large */");
    });

    it("preserves the actual values", () => {
      expect(result).toContain("background: #FFFFFF");
      expect(result).toContain("column-gap: 8px");
    });
  });

  describe("style-references", () => {
    const result = stripDesignTree(FIXTURE, "style-references");

    it("removes /* text-style:... */ comments", () => {
      expect(result).not.toContain("/* text-style:");
    });

    it("preserves /* var:... */ comments", () => {
      expect(result).toContain("/* var:");
    });

    it("preserves the actual font values", () => {
      expect(result).toContain('font-family: "Inter"');
      expect(result).toContain("font-weight: 700");
    });
  });

  describe("position-stacking", () => {
    it("returns tree unchanged (no-op)", () => {
      expect(stripDesignTree(FIXTURE, "position-stacking")).toBe(FIXTURE);
    });
  });

  describe("general properties", () => {
    it("exports the exact 5 strip experiment types in order", () => {
      expect(DESIGN_TREE_INFO_TYPES).toEqual([
        "layout-direction-spacing",
        "component-references",
        "node-names-hierarchy",
        "variable-references",
        "style-references",
      ]);
    });

    it("is idempotent — applying same strip twice gives same result", () => {
      for (const type of ALL_STRIP_TYPES) {
        const once = stripDesignTree(FIXTURE, type);
        const twice = stripDesignTree(once, type);
        expect(twice).toBe(once);
      }
    });

    it("never removes comment headers", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(FIXTURE, type);
        expect(result).toContain("# Design Tree");
        expect(result).toContain("# Root: 375px x 812px");
      }
    });

    it("never removes text content", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(FIXTURE, type);
        expect(result).toContain('text: "My Store"');
        expect(result).toContain('text: "$29.99"');
        expect(result).toContain('text: "Buy Now"');
      }
    });

    it("never produces empty output", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(FIXTURE, type);
        expect(result.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("adversarial text content", () => {
    const ADVERSARIAL = [
      "# Design Tree",
      "",
      "Page (FRAME, 375x100)",
      '  style: display: flex; color: #1E1E1E; text: "A; background: #FFFFFF; display: flex"',
      "  Info (TEXT, 200x20)",
      '    style: font-size: 16px; text: "svg: <path d=\\"M0 0\\"/>"',
      "  Note (TEXT, 200x20)",
      '    style: font-size: 14px; text: "[component: Button] (FRAME, 1x1) /* var:demo */"',
    ].join("\n");

    it("preserves text with semicolons and CSS-like content", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(ADVERSARIAL, type);
        expect(result).toContain('text: "A; background: #FFFFFF; display: flex"');
      }
    });

    it("preserves text with SVG-like content", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(ADVERSARIAL, type);
        expect(result).toContain('text: "svg: <path d=\\"M0 0\\"/>"');
      }
    });

    it("preserves text with component/frame/var-like content", () => {
      for (const type of ALL_STRIP_TYPES) {
        const result = stripDesignTree(ADVERSARIAL, type);
        expect(result).toContain('text: "[component: Button] (FRAME, 1x1) /* var:demo */"');
      }
    });
  });
});
