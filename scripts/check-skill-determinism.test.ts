import { describe, expect, it } from "vitest";
import {
  CODE_BLOCK_PATTERNS,
  PROSE_PATTERNS,
  SKILL_FILES,
  scan,
} from "./check-skill-determinism.js";

const FILE = "skills/test/SKILL.md";

const wrap = (lines: string[]): string => lines.join("\n");

describe("check-skill-determinism", () => {
  describe("regression suite — historical violations are caught", () => {
    it("flags an inline `for` loop in a JS code block (Strategy D auto-fix loop, #386)", () => {
      const md = wrap([
        "```javascript",
        "for (const issue of analyzeResult.issues) {",
        "  doSomething(issue);",
        "}",
        "```",
      ]);
      const findings = scan(FILE, md);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("code:for-loop");
      expect(findings[0]?.line).toBe(2);
    });

    it("flags an inline `.filter(` array transform in a JS code block (Step 5 cleanup filter, #387 audit C)", () => {
      const md = wrap([
        "```javascript",
        "const cleaned = annotations.filter(a => !a.categoryId);",
        "```",
      ]);
      const findings = scan(FILE, md);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("code:array-transform");
    });

    it("flags an inline `<count of ...>` template (Step 5 tally, #383)", () => {
      const md = wrap([
        "Tally inputs:",
        "- X = <count of ✅ markers>",
        "- Y = <count of 📝 markers>",
      ]);
      const findings = scan(FILE, md);
      expect(findings.length).toBeGreaterThanOrEqual(2);
      expect(findings.map((f) => f.rule)).toContain("prose:count-of-template");
    });

    it("flags imperative URL-parsing prose (designKey, #384, and dead fileKey, #387 audit B)", () => {
      const md = wrap([
        "Extract the `fileKey` from the Figma URL (format: `figma.com/design/:fileKey/...`).",
      ]);
      const findings = scan(FILE, md);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("prose:url-parse");
    });

    it("flags `.split(` and `.match(` parsing in code blocks", () => {
      const md = wrap([
        "```javascript",
        'const fileKey = url.split("/")[3];',
        "const m = url.match(/node-id=([^&]+)/);",
        "```",
      ]);
      const findings = scan(FILE, md);
      expect(findings.map((f) => f.rule)).toEqual([
        "code:string-split",
        "code:string-match",
      ]);
    });

    it("flags `new Set(` and `parseInt(` in code blocks", () => {
      const md = wrap([
        "```javascript",
        "const ids = new Set(items.map(i => i.id));",
        "const n = parseInt(answer, 10);",
        "```",
      ]);
      const findings = scan(FILE, md);
      // `.map(` is intentionally NOT flagged — too noisy (every API extraction
      // pattern uses it). The collection construction and numeric parse are
      // the actually-distinctive deterministic markers on this input.
      expect(findings.map((f) => f.rule).sort()).toEqual([
        "code:collection-construct",
        "code:numeric-parse",
      ]);
    });
  });

  describe("acceptable patterns — must NOT be flagged", () => {
    it("does not flag plain helper / SDK invocations", () => {
      const md = wrap([
        "```javascript",
        "await CanICodeRoundtrip.applyPropertyMod(question, value, { categories });",
        "const node = await figma.getNodeByIdAsync(id);",
        "node.itemSpacing = 16;",
        "```",
      ]);
      expect(scan(FILE, md)).toEqual([]);
    });

    it("does not flag prose lines that mention 'count' but not in the imperative-template shape", () => {
      const md = wrap([
        "The replicaNodeIds field carries the count of replica instances detected upstream.",
        "Each scene gets its own per-node failure routing.",
      ]);
      expect(scan(FILE, md)).toEqual([]);
    });

    it("does not flag fenced code blocks in non-JS languages (e.g. shell, json, markdown templates)", () => {
      const md = wrap([
        "```bash",
        "for i in 1 2 3; do echo $i; done",
        "```",
        "",
        "```json",
        '{ "for": "config" }',
        "```",
      ]);
      expect(scan(FILE, md)).toEqual([]);
    });

    it("does not flag a code block immediately preceded by an `<!-- adr-016-ack: ... -->` marker", () => {
      const md = wrap([
        "<!-- adr-016-ack: fan-out over an explicit small array; deterministic work lives in the helper -->",
        "```javascript",
        "for (const nodeId of targets) {",
        "  await CanICodeRoundtrip.applyPropertyMod({ ...question, nodeId }, answerValue, { categories });",
        "}",
        "```",
      ]);
      expect(scan(FILE, md)).toEqual([]);
    });

    it("does not flag prose with an inline `<!-- adr-016-ack: ... -->` marker on the same line", () => {
      const md = "Extract the `fileKey` from the Figma URL. <!-- adr-016-ack: legacy doc, removal tracked elsewhere -->";
      expect(scan(FILE, md)).toEqual([]);
    });

    it("does not flag a single line inside a code block that carries `// adr-016-ack:`", () => {
      const md = wrap([
        "```javascript",
        "for (const id of nodeIds) { // adr-016-ack: fan-out, helper does the work",
        "  await figma.getNodeByIdAsync(id);",
        "}",
        "```",
      ]);
      expect(scan(FILE, md)).toEqual([]);
    });
  });

  describe("ACK marker grammar", () => {
    it("does not exempt a code block when the ACK marker is two lines above (only the immediately preceding line counts)", () => {
      const md = wrap([
        "<!-- adr-016-ack: too far away -->",
        "Some intervening prose.",
        "```javascript",
        "for (const x of xs) {}",
        "```",
      ]);
      const findings = scan(FILE, md);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.rule).toBe("code:for-loop");
    });

    it("does not silently accept an ACK marker without a reason payload", () => {
      const md = wrap([
        "<!-- adr-016-ack: -->",
        "```javascript",
        "for (const x of xs) {}",
        "```",
      ]);
      const findings = scan(FILE, md);
      // Empty reason means the regex group fails to capture and the marker is
      // treated as absent — the offending line is still flagged.
      expect(findings).toHaveLength(1);
    });
  });

  describe("module surface", () => {
    it("exports a stable list of files in scope", () => {
      expect(SKILL_FILES).toEqual([
        ".claude/skills/canicode-roundtrip/SKILL.md",
        ".claude/skills/canicode-gotchas/SKILL.md",
        ".claude/skills/canicode/SKILL.md",
      ]);
    });

    it("exports the pattern arrays for downstream introspection", () => {
      expect(CODE_BLOCK_PATTERNS.length).toBeGreaterThan(0);
      expect(PROSE_PATTERNS.length).toBeGreaterThan(0);
      for (const { re, rule } of [...CODE_BLOCK_PATTERNS, ...PROSE_PATTERNS]) {
        expect(re).toBeInstanceOf(RegExp);
        expect(rule).toMatch(/^(code|prose):/);
      }
    });
  });
});
