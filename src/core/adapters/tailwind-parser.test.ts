import { describe, it, expect } from "vitest";
import {
  extractStylesFromClasses,
  parseDesignContextCode,
  parseCodeHeader,
  enrichNodeWithStyles,
} from "./tailwind-parser.js";
import type { AnalysisNode } from "../contracts/figma-node.js";

describe("extractStylesFromClasses", () => {
  it("extracts flex direction", () => {
    expect(extractStylesFromClasses("flex flex-col").layoutMode).toBe("VERTICAL");
    expect(extractStylesFromClasses("flex flex-row").layoutMode).toBe("HORIZONTAL");
    expect(extractStylesFromClasses("flex").layoutMode).toBe("HORIZONTAL");
  });

  it("extracts positioning", () => {
    expect(extractStylesFromClasses("absolute").layoutPositioning).toBe("ABSOLUTE");
    expect(extractStylesFromClasses("relative").layoutPositioning).toBe("AUTO");
  });

  it("extracts sizing", () => {
    const styles = extractStylesFromClasses("w-full h-fit");
    expect(styles.layoutSizingHorizontal).toBe("FILL");
    expect(styles.layoutSizingVertical).toBe("HUG");
  });

  it("extracts fixed sizing from arbitrary values", () => {
    const styles = extractStylesFromClasses("w-[905px] h-[680px]");
    expect(styles.layoutSizingHorizontal).toBe("FIXED");
    expect(styles.layoutSizingVertical).toBe("FIXED");
  });

  it("extracts gap as itemSpacing", () => {
    expect(extractStylesFromClasses("gap-4").itemSpacing).toBe(16);
    expect(extractStylesFromClasses("gap-2").itemSpacing).toBe(8);
    expect(extractStylesFromClasses("gap-0").itemSpacing).toBe(0);
    expect(extractStylesFromClasses("gap-[12px]").itemSpacing).toBe(12);
  });

  it("extracts uniform padding", () => {
    const styles = extractStylesFromClasses("p-4");
    expect(styles.paddingLeft).toBe(16);
    expect(styles.paddingRight).toBe(16);
    expect(styles.paddingTop).toBe(16);
    expect(styles.paddingBottom).toBe(16);
  });

  it("extracts axis padding", () => {
    const styles = extractStylesFromClasses("px-3 py-2");
    expect(styles.paddingLeft).toBe(12);
    expect(styles.paddingRight).toBe(12);
    expect(styles.paddingTop).toBe(8);
    expect(styles.paddingBottom).toBe(8);
  });

  it("extracts individual padding", () => {
    const styles = extractStylesFromClasses("pl-4 pr-2 pt-3 pb-1");
    expect(styles.paddingLeft).toBe(16);
    expect(styles.paddingRight).toBe(8);
    expect(styles.paddingTop).toBe(12);
    expect(styles.paddingBottom).toBe(4);
  });

  it("extracts raw hex color fills", () => {
    const styles = extractStylesFromClasses("bg-[#FF0000]");
    expect(styles.fills).toHaveLength(1);
    const fill = styles.fills![0] as Record<string, unknown>;
    expect(fill["type"]).toBe("SOLID");
    const color = fill["color"] as Record<string, number>;
    expect(color["r"]).toBe(1);
    expect(color["g"]).toBe(0);
    expect(color["b"]).toBe(0);
  });

  it("extracts design token color fills", () => {
    const styles = extractStylesFromClasses("bg-[var(--md-sys-color-surface)]");
    expect(styles.fills).toHaveLength(1);
    const fill = styles.fills![0] as Record<string, unknown>;
    expect(fill["boundVariable"]).toBe("var(--md-sys-color-surface)");
  });

  it("extracts shadow effects", () => {
    const styles = extractStylesFromClasses("shadow-lg");
    expect(styles.effects).toHaveLength(1);
    const effect = styles.effects![0] as Record<string, unknown>;
    expect(effect["type"]).toBe("DROP_SHADOW");
  });
});

describe("parseCodeHeader", () => {
  it("parses component with no auto-layout", () => {
    const code = `/* Examples/Detailed view-Web — 905x680 COMPONENT, no auto-layout */`;
    const header = parseCodeHeader(code);
    expect(header.name).toBe("Examples/Detailed view-Web");
    expect(header.width).toBe(905);
    expect(header.height).toBe(680);
    expect(header.type).toBe("COMPONENT");
    expect(header.hasAutoLayout).toBe(false);
  });

  it("parses frame with vertical auto-layout", () => {
    const code = `/* MyFrame — 412x461 FRAME, vertical auto-layout */`;
    const header = parseCodeHeader(code);
    expect(header.name).toBe("MyFrame");
    expect(header.hasAutoLayout).toBe(true);
    expect(header.layoutDirection).toBe("VERTICAL");
  });
});

describe("parseDesignContextCode", () => {
  it("extracts root styles from JSX", () => {
    const code = `export function MyComp() {
  return (
    <div className="flex flex-col gap-4 p-6 bg-[#FFFFFF]">
      <span className="text-lg">Hello</span>
    </div>
  );
}`;
    const styles = parseDesignContextCode(code);
    expect(styles.layoutMode).toBe("VERTICAL");
    expect(styles.itemSpacing).toBe(16);
    expect(styles.paddingLeft).toBe(24);
    expect(styles.fills).toBeDefined();
    expect(styles.fills!.length).toBeGreaterThanOrEqual(1);
  });
});

describe("enrichNodeWithStyles", () => {
  it("only sets missing properties", () => {
    const node: AnalysisNode = {
      id: "1:1",
      name: "Test",
      type: "FRAME",
      visible: true,
      layoutMode: "HORIZONTAL",
    };
    enrichNodeWithStyles(node, {
      layoutMode: "VERTICAL",
      itemSpacing: 16,
    });
    expect(node.layoutMode).toBe("HORIZONTAL"); // not overwritten
    expect(node.itemSpacing).toBe(16); // newly set
  });
});
