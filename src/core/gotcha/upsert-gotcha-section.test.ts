import {
  COLLECTED_GOTCHAS_HEADING,
  detectGotchasFileState,
  findOrAppendSection,
  renderUpsertedFile,
} from "./upsert-gotcha-section.js";

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
  COLLECTED_GOTCHAS_HEADING,
  "",
].join("\n");

const FRONTMATTER_NO_HEADING = [
  "---",
  "name: canicode-gotchas",
  "description: Gotcha survey workflow",
  "---",
  "",
  "# CanICode Gotchas",
  "",
  "Workflow prose here…",
  "",
].join("\n");

const CLOBBERED = [
  "# Some pre-#340 single-design content",
  "",
  "- **Design key**: abc#1:1",
  "",
].join("\n");

const SECTION_001 = [
  "## #001 — Login Page — 2026-04-01",
  "",
  "- **Figma URL**: https://figma.com/design/abc/file?node-id=1-1",
  "- **Design key**: abc#1:1",
  "- **Grade**: B+",
  "- **Analyzed at**: 2026-04-01T10:00:00Z",
  "",
  "### Gotchas",
  "",
  "#### no-auto-layout — Card",
  "",
  "- **Severity**: blocking",
  "- **Node ID**: 1:2",
  "- **Question**: Should this use auto-layout?",
  "- **Answer**: Yes, vertical with 8px gap",
  "",
].join("\n");

const SECTION_003 = [
  "## #003 — Dashboard — 2026-04-05",
  "",
  "- **Figma URL**: https://figma.com/design/xyz/file?node-id=3-3",
  "- **Design key**: xyz#3:3",
  "- **Grade**: A",
  "- **Analyzed at**: 2026-04-05T10:00:00Z",
  "",
  "### Gotchas",
  "",
  "#### no-auto-layout — Sidebar",
  "",
  "- **Severity**: blocking",
  "- **Node ID**: 3:4",
  "- **Question**: Should this use auto-layout?",
  "- **Answer**: Yes",
  "",
].join("\n");

const NEW_SECTION = (key: string): string =>
  [
    "## #{{SECTION_NUMBER}} — Settings — 2026-04-20",
    "",
    `- **Figma URL**: https://figma.com/design/new/file?node-id=9-9`,
    `- **Design key**: ${key}`,
    "- **Grade**: B",
    "- **Analyzed at**: 2026-04-20T10:00:00Z",
    "",
    "### Gotchas",
    "",
    "#### no-auto-layout — Settings Card",
    "",
    "- **Severity**: blocking",
    "- **Node ID**: 9:10",
    "- **Question**: Should this use auto-layout?",
    "- **Answer**: Yes, vertical 12px",
    "",
  ].join("\n");

describe("detectGotchasFileState", () => {
  it("returns 'missing' when content is null", () => {
    expect(detectGotchasFileState(null)).toBe("missing");
  });

  it("returns 'valid' when frontmatter and Collected Gotchas heading are both present", () => {
    expect(detectGotchasFileState(FRONTMATTER)).toBe("valid");
  });

  it("returns 'missing-heading' when frontmatter is present but the heading is missing", () => {
    expect(detectGotchasFileState(FRONTMATTER_NO_HEADING)).toBe("missing-heading");
  });

  it("returns 'clobbered' when there is no YAML frontmatter (pre-#340 shape)", () => {
    expect(detectGotchasFileState(CLOBBERED)).toBe("clobbered");
  });

  it("treats a CRLF-line frontmatter as valid", () => {
    const crlf = FRONTMATTER.replace(/\n/g, "\r\n");
    expect(detectGotchasFileState(crlf)).toBe("valid");
  });
});

describe("findOrAppendSection", () => {
  it("returns append #001 on a clean Collected Gotchas region", () => {
    const plan = findOrAppendSection(FRONTMATTER, "new-key");
    expect(plan).toEqual({ action: "append", sectionNumber: "001" });
  });

  it("returns append #004 after an existing #003", () => {
    const content = `${FRONTMATTER}${SECTION_001}\n${SECTION_003}`;
    const plan = findOrAppendSection(content, "new-key");
    expect(plan).toEqual({ action: "append", sectionNumber: "004" });
  });

  it("keeps numbering monotonic across deleted middle sections (gap → next is max+1)", () => {
    // User manually deletes #002 — only #001 and #003 remain.
    // Next must be #004, never #002.
    const content = `${FRONTMATTER}${SECTION_001}\n${SECTION_003}`;
    const plan = findOrAppendSection(content, "unseen-key");
    expect(plan).toEqual({ action: "append", sectionNumber: "004" });
  });

  it("returns replace when an existing section's Design key bullet matches", () => {
    const content = `${FRONTMATTER}${SECTION_001}\n${SECTION_003}`;
    const plan = findOrAppendSection(content, "xyz#3:3");
    expect(plan.action).toBe("replace");
    if (plan.action === "replace") {
      expect(plan.sectionNumber).toBe("003");
      const [start, end] = plan.replaceRange;
      expect(content.slice(start, end)).toContain("## #003 — Dashboard");
      expect(content.slice(start, end)).toContain("- **Design key**: xyz#3:3");
      // Replace range stops before the next section header (which would be
      // EOF here) — just make sure it doesn't bleed into #001's territory.
      expect(content.slice(start, end)).not.toContain("## #001");
    }
  });

  it("substring-matches the Design key bullet (URL-fragment subset still matches)", () => {
    const content = `${FRONTMATTER}${SECTION_001}`;
    // `abc#1:1` is the full key; `abc#1` is a prefix substring of the bullet
    // value — still matches per SKILL prose.
    const plan = findOrAppendSection(content, "abc#1");
    expect(plan.action).toBe("replace");
    if (plan.action === "replace") {
      expect(plan.sectionNumber).toBe("001");
    }
  });

  it("does not match Design key occurrences in the workflow region above", () => {
    // Put the same `abc#1:1` substring in the workflow region — must NOT
    // produce a false replace because scanning is region-anchored.
    const workflowMention = FRONTMATTER.replace(
      "Workflow prose here…",
      "Example Design key in docs: abc#1:1",
    );
    const plan = findOrAppendSection(workflowMention, "abc#1:1");
    expect(plan).toEqual({ action: "append", sectionNumber: "001" });
  });

  it("preserves the captured NNN verbatim (does not re-pad)", () => {
    // 4-digit historical NNN — preserve, do not truncate.
    const oversized = `${FRONTMATTER}## #1024 — Old — 2026-04-01\n\n- **Design key**: legacy\n\n`;
    const plan = findOrAppendSection(oversized, "legacy");
    if (plan.action !== "replace") throw new Error("expected replace");
    expect(plan.sectionNumber).toBe("1024");
  });
});

describe("renderUpsertedFile", () => {
  it("returns null content for 'missing' state (caller surfaces user message)", () => {
    const result = renderUpsertedFile({
      currentContent: null,
      designKey: "any",
      sectionMarkdown: NEW_SECTION("any"),
    });
    expect(result.state).toBe("missing");
    expect(result.newContent).toBeNull();
  });

  it("returns null content for 'clobbered' state (caller surfaces canicode init --force)", () => {
    const result = renderUpsertedFile({
      currentContent: CLOBBERED,
      designKey: "abc#1:1",
      sectionMarkdown: NEW_SECTION("abc#1:1"),
    });
    expect(result.state).toBe("clobbered");
    expect(result.newContent).toBeNull();
  });

  it("appends #001 on a fresh valid file", () => {
    const result = renderUpsertedFile({
      currentContent: FRONTMATTER,
      designKey: "new-key",
      sectionMarkdown: NEW_SECTION("new-key"),
    });
    expect(result.state).toBe("valid");
    expect(result.plan).toEqual({ action: "append", sectionNumber: "001" });
    expect(result.newContent).toContain("## #001 — Settings");
    // Workflow region untouched.
    expect(result.newContent).toContain("Workflow prose here…");
  });

  it("injects the Collected Gotchas heading then appends when state is missing-heading", () => {
    const result = renderUpsertedFile({
      currentContent: FRONTMATTER_NO_HEADING,
      designKey: "new-key",
      sectionMarkdown: NEW_SECTION("new-key"),
    });
    expect(result.state).toBe("missing-heading");
    expect(result.newContent).toContain(COLLECTED_GOTCHAS_HEADING);
    expect(result.newContent).toContain("## #001 — Settings");
    // Original workflow content preserved verbatim.
    expect(result.newContent).toContain("Workflow prose here…");
    // Heading appears exactly once.
    const headingCount = result.newContent!.match(
      /^# Collected Gotchas$/gm,
    )?.length;
    expect(headingCount).toBe(1);
  });

  it("replaces in place when Design key matches an existing section (preserves NNN)", () => {
    const content = `${FRONTMATTER}${SECTION_001}\n${SECTION_003}`;
    const result = renderUpsertedFile({
      currentContent: content,
      designKey: "xyz#3:3",
      // Reuse {{SECTION_NUMBER}} placeholder so we can prove preservation.
      sectionMarkdown: NEW_SECTION("xyz#3:3"),
    });
    expect(result.state).toBe("valid");
    expect(result.plan?.action).toBe("replace");
    expect(result.plan?.sectionNumber).toBe("003");
    // The new file still contains #001 (untouched) and #003 (replaced
    // with NEW_SECTION's body, which mentions "Settings").
    expect(result.newContent).toContain("## #001 — Login Page");
    expect(result.newContent).toContain("## #003 — Settings");
    // Old #003 ("Dashboard") is gone.
    expect(result.newContent).not.toContain("## #003 — Dashboard");
  });

  it("appends #004 when an existing #003 is present and the design key is new", () => {
    const content = `${FRONTMATTER}${SECTION_001}\n${SECTION_003}`;
    const result = renderUpsertedFile({
      currentContent: content,
      designKey: "brand-new-key",
      sectionMarkdown: NEW_SECTION("brand-new-key"),
    });
    expect(result.plan).toEqual({ action: "append", sectionNumber: "004" });
    expect(result.newContent).toContain("## #001 — Login Page");
    expect(result.newContent).toContain("## #003 — Dashboard");
    expect(result.newContent).toContain("## #004 — Settings");
  });
});
