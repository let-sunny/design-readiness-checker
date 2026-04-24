import { describe, expect, it } from "vitest";
import { conventionalizeTitle } from "./conventional-title.js";

describe("conventionalizeTitle", () => {
  describe("acceptance criteria — pass through conventional prefixes", () => {
    it("passes through scoped fix(cli): unchanged", () => {
      expect(conventionalizeTitle("fix(cli): analyze --api is a no-op")).toBe(
        "fix(cli): analyze --api is a no-op",
      );
    });

    it("passes through scoped docs(roundtrip): unchanged", () => {
      expect(
        conventionalizeTitle("docs(roundtrip): Make helpers.js prepending unavoidable"),
      ).toBe("docs(roundtrip): Make helpers.js prepending unavoidable");
    });

    it("passes through bare feat: unchanged", () => {
      expect(conventionalizeTitle("feat: add X")).toBe("feat: add X");
    });

    it("prepends feat: to titles with no conventional prefix", () => {
      expect(conventionalizeTitle("add X")).toBe("feat: add X");
    });

    it("passes through feat!: breaking change (bang marker)", () => {
      expect(conventionalizeTitle("feat!: breaking change")).toBe(
        "feat!: breaking change",
      );
    });

    it("passes through fix(api)!: breaking fix (scope + bang)", () => {
      expect(conventionalizeTitle("fix(api)!: breaking fix")).toBe(
        "fix(api)!: breaking fix",
      );
    });
  });

  describe("guardrails", () => {
    it("anchors matching to the start of the string", () => {
      expect(conventionalizeTitle("refactor(core): ok")).toBe(
        "refactor(core): ok",
      );
      expect(conventionalizeTitle("some refactor(core): prefix")).toBe(
        "feat: some refactor(core): prefix",
      );
    });

    it("does not pass through unknown types (wip:)", () => {
      expect(conventionalizeTitle("wip: foo")).toBe("feat: wip: foo");
    });

    it("requires a space after the colon", () => {
      expect(conventionalizeTitle("fix:no-space")).toBe("feat: fix:no-space");
    });

    it("rejects empty scope parens (docs(): x)", () => {
      // [^)]+ is non-empty — empty parens do NOT match, so the prefix is added.
      // Pinning this behavior so a future `[^)]*` tweak is a deliberate choice.
      expect(conventionalizeTitle("docs(): x")).toBe("feat: docs(): x");
    });
  });
});
