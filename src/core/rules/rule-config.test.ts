import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_CONFIGS } from "./rule-config.js";
import { ruleRegistry } from "./rule-registry.js";
import type { RuleId } from "../contracts/rule.js";

// Import all rules to populate registry
import "./index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REFERENCE_PATH = resolve(__dirname, "../../../docs/REFERENCE.md");

describe("rule-config sync", () => {
  describe("REFERENCE.md matches rule-config.ts", () => {
    const content = readFileSync(REFERENCE_PATH, "utf-8");

    // Parse only the auto-generated rule table block between markers
    const tableStart = content.indexOf("<!-- RULE_TABLE_START");
    const tableEnd = content.indexOf("<!-- RULE_TABLE_END -->");
    if (tableStart === -1 || tableEnd === -1 || tableEnd <= tableStart) {
      throw new Error("REFERENCE.md rule table markers are missing or misordered");
    }
    const tableContent = content.slice(tableStart, tableEnd);

    const tableRows = [...tableContent.matchAll(/\| `([^`]+)` \| (-?\d+) \| ([a-z-]+) \|/g)];
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

    it("REFERENCE.md has no extra rules beyond rule-config.ts", () => {
      const configIds = new Set(Object.keys(RULE_CONFIGS));
      for (const docId of docRules.keys()) {
        expect(configIds.has(docId)).toBe(true);
      }
    });

    it("REFERENCE.md has all rules from rule-config.ts", () => {
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
