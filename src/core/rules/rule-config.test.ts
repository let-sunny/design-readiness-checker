import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_CONFIGS, getAnnotationProperties } from "./rule-config.js";
import { ruleRegistry } from "./rule-registry.js";
import type { RuleId } from "../contracts/rule.js";

// Import all rules to populate registry
import "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOMIZATION_PATH = resolve(__dirname, "../../../docs/CUSTOMIZATION.md");

describe("rule-config sync", () => {
  describe("CUSTOMIZATION.md matches rule-config.ts", () => {
    const content = readFileSync(CUSTOMIZATION_PATH, "utf-8");

    // Parse only the auto-generated rule table block between markers
    const tableStart = content.indexOf("<!-- RULE_TABLE_START");
    const tableEnd = content.indexOf("<!-- RULE_TABLE_END -->");
    if (tableStart === -1 || tableEnd === -1 || tableEnd <= tableStart) {
      throw new Error("CUSTOMIZATION.md rule table markers are missing or misordered");
    }
    const tableContent = content.slice(tableStart, tableEnd);

    const tableRows = [...tableContent.matchAll(/\| `([^`]+)`[^|]* \| (-?\d+) \| ([a-z-]+) \|/g)];
    const docRules = new Map(
      tableRows
        .filter((m) => m[1] !== undefined && m[2] !== undefined && m[3] !== undefined)
        .map((m) => [m[1], { score: Number(m[2]), severity: m[3] }])
    );

    for (const [id, config] of Object.entries(RULE_CONFIGS)) {
      it(`${id}: score matches`, () => {
        const doc = docRules.get(id);
        expect(doc).toBeDefined();
        expect(doc!.score).toBe(config.score);
      });

      it(`${id}: severity matches`, () => {
        const doc = docRules.get(id);
        expect(doc).toBeDefined();
        expect(doc!.severity).toBe(config.severity);
      });
    }

    it("CUSTOMIZATION.md has no extra rules beyond rule-config.ts", () => {
      const configIds = new Set(Object.keys(RULE_CONFIGS));
      for (const docId of docRules.keys()) {
        expect(configIds.has(docId)).toBe(true);
      }
    });

    it("CUSTOMIZATION.md has all rules from rule-config.ts", () => {
      for (const id of Object.keys(RULE_CONFIGS)) {
        expect(docRules.has(id)).toBe(true);
      }
    });
  });

  describe("rule registry covers all rule-config.ts entries", () => {
    it("every RULE_CONFIGS entry has a registered rule", () => {
      for (const id of Object.keys(RULE_CONFIGS)) {
        expect(ruleRegistry.has(id as RuleId)).toBe(true);
      }
    });

    it("every registered rule has a RULE_CONFIGS entry", () => {
      for (const rule of ruleRegistry.getAll()) {
        expect(RULE_CONFIGS[rule.definition.id as RuleId]).toBeDefined();
      }
    });
  });

  describe("getAnnotationProperties", () => {
    it("returns bySubType match when present", () => {
      expect(getAnnotationProperties("irregular-spacing", "gap")).toEqual([
        { type: "itemSpacing" },
      ]);
      expect(getAnnotationProperties("irregular-spacing", "padding")).toEqual([
        { type: "padding" },
      ]);
    });

    it("falls back to default when subType has no bySubType entry", () => {
      // missing-size-constraint has only a default — any subType resolves to it.
      expect(
        getAnnotationProperties("missing-size-constraint", "wrap")
      ).toEqual([{ type: "width" }, { type: "height" }]);
      expect(
        getAnnotationProperties("missing-size-constraint")
      ).toEqual([{ type: "width" }, { type: "height" }]);
    });

    it("returns undefined when subType does not match bySubType and no default exists", () => {
      // irregular-spacing has no default — an unknown subType must return undefined.
      expect(
        getAnnotationProperties("irregular-spacing", "unknown")
      ).toBeUndefined();
    });

    it("returns undefined for rules with no mapping", () => {
      expect(getAnnotationProperties("deep-nesting")).toBeUndefined();
      expect(getAnnotationProperties("non-semantic-name")).toBeUndefined();
    });

    it("raw-value subTypes: color → fills, font → font fields, spacing → itemSpacing+padding", () => {
      expect(getAnnotationProperties("raw-value", "color")).toEqual([
        { type: "fills" },
      ]);
      expect(getAnnotationProperties("raw-value", "font")).toEqual([
        { type: "fontSize" },
        { type: "fontFamily" },
        { type: "fontWeight" },
        { type: "lineHeight" },
      ]);
      expect(getAnnotationProperties("raw-value", "spacing")).toEqual([
        { type: "itemSpacing" },
        { type: "padding" },
      ]);
    });

    it("absolute-position-in-auto-layout → layoutMode", () => {
      expect(
        getAnnotationProperties("absolute-position-in-auto-layout")
      ).toEqual([{ type: "layoutMode" }]);
    });

    it("fixed-size-in-auto-layout → width, height, layoutMode", () => {
      expect(
        getAnnotationProperties("fixed-size-in-auto-layout", "horizontal")
      ).toEqual([{ type: "width" }, { type: "height" }, { type: "layoutMode" }]);
    });
  });

  describe("rules/index.ts has no stale count comments", () => {
    const indexContent = readFileSync(
      resolve(import.meta.dirname, "./index.ts"),
      "utf-8"
    );

    it("no hardcoded rule count comments exist", () => {
      const countPattern = /rules.*\(\d+\)/i;
      expect(countPattern.test(indexContent)).toBe(false);
    });
  });
});
