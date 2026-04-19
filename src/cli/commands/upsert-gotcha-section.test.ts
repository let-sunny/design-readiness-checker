import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runUpsertGotchaSection } from "./upsert-gotcha-section.js";

let tempRoot: string;

const FRONTMATTER = [
  "---",
  "name: canicode-gotchas",
  "description: Gotcha survey workflow",
  "---",
  "",
  "# CanICode Gotchas",
  "",
  "Workflow prose here…",
  "",
  "# Collected Gotchas",
  "",
].join("\n");

const SECTION_TEMPLATE = (key: string): string =>
  [
    "## #{{SECTION_NUMBER}} — Settings — 2026-04-20",
    "",
    `- **Design key**: ${key}`,
    "- **Grade**: B",
    "",
  ].join("\n");

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "canicode-upsert-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("runUpsertGotchaSection", () => {
  it("appends a new section and writes the file when state is valid", async () => {
    const file = join(tempRoot, "SKILL.md");
    writeFileSync(file, FRONTMATTER, "utf-8");

    const result = await runUpsertGotchaSection({
      file,
      designKey: "abc#1:1",
      section: SECTION_TEMPLATE("abc#1:1"),
    });

    expect(result.wrote).toBe(true);
    expect(result.action).toBe("append");
    expect(result.sectionNumber).toBe("001");
    expect(result.userMessage).toBeNull();

    const onDisk = readFileSync(file, "utf-8");
    expect(onDisk).toContain("## #001 — Settings");
    // Workflow region preserved.
    expect(onDisk).toContain("Workflow prose here…");
  });

  it("returns missing state without writing when the file does not exist", async () => {
    const file = join(tempRoot, "missing.md");
    const result = await runUpsertGotchaSection({
      file,
      designKey: "any",
      section: SECTION_TEMPLATE("any"),
    });

    expect(result.wrote).toBe(false);
    expect(result.state).toBe("missing");
    expect(result.action).toBeNull();
    expect(result.userMessage).toContain("canicode init");
  });

  it("returns clobbered state without writing when frontmatter is missing", async () => {
    const file = join(tempRoot, "SKILL.md");
    writeFileSync(file, "# Single-design content\n\n- **Design key**: x\n", "utf-8");

    const result = await runUpsertGotchaSection({
      file,
      designKey: "x",
      section: SECTION_TEMPLATE("x"),
    });

    expect(result.wrote).toBe(false);
    expect(result.state).toBe("clobbered");
    expect(result.userMessage).toContain("canicode init --force");

    // File untouched.
    expect(readFileSync(file, "utf-8")).toBe(
      "# Single-design content\n\n- **Design key**: x\n",
    );
  });

  it("preserves NNN on replace by Design key match", async () => {
    const file = join(tempRoot, "SKILL.md");
    const seeded =
      FRONTMATTER +
      "## #003 — Old Title — 2026-04-01\n\n- **Design key**: keep-me\n\n";
    writeFileSync(file, seeded, "utf-8");

    const result = await runUpsertGotchaSection({
      file,
      designKey: "keep-me",
      section: SECTION_TEMPLATE("keep-me"),
    });

    expect(result.wrote).toBe(true);
    expect(result.action).toBe("replace");
    expect(result.sectionNumber).toBe("003");

    const onDisk = readFileSync(file, "utf-8");
    expect(onDisk).toContain("## #003 — Settings");
    expect(onDisk).not.toContain("Old Title");
  });
});
