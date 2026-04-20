---
name: canicode-gotchas
description: Gotcha survey workflow plus accumulating per-design answers — one Workflow region on top, numbered sections appended per Figma design
---

# CanICode Gotchas -- Design Gotcha Survey & Skill Writer

Run a gotcha survey on a Figma design to collect implementation context that Figma cannot encode natively, capture developer/designer answers, and upsert them into this skill file so downstream `figma-implement-design` runs have annotation-ready context. In this model, rules do rule-based best-practice detection, and gotcha is the annotation output from that detection. Some gotchas come from violation rules (what is wrong and how to resolve it); others come from info-collection rules (neutral context Figma cannot represent, like interaction intent/state). The file has two regions: the **Workflow** below (installed by `canicode init`, never overwritten) and the **Collected Gotchas** region at the bottom (one numbered section per design, replaced in place on re-runs).

## Prerequisites

- **canicode MCP server** (preferred): `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp` — long-form flags only; the short-form `-y -p` collides with `claude mcp add`'s parser (#366). The MCP server reads `FIGMA_TOKEN` from `~/.canicode/config.json` or the host environment, so do **not** pass `-e FIGMA_TOKEN=…` here (#364).
- **Without canicode MCP** (fallback): the `canicode gotcha-survey --json` CLI produces the same response shape — no MCP installation required.
- **FIGMA_TOKEN** configured for live Figma URLs

## Workflow

### Step 1: Run the gotcha survey

If the `gotcha-survey` MCP tool is available, call it with the user's Figma URL:

```
gotcha-survey({ input: "<figma-url-or-fixture-path>" })
```

**Without canicode MCP** — shell out to the CLI. The `--json` output parses identically:

```bash
npx canicode gotcha-survey "<figma-url-or-fixture-path>" --json
```

Either channel returns:
- `designGrade`: overall grade (S, A+, A, B+, B, C+, C, D, F)
- `isReadyForCodeGen`: whether the design can be implemented without gotchas
- `questions`: array of gotcha questions (may be empty)

### Step 2: Check if survey is needed

If `isReadyForCodeGen` is `true` or `questions` is empty:
- Tell the user: "This design scored **{designGrade}** and is ready for code generation — no gotchas to resolve."
- Do NOT write to the skill file.
- Stop here.

### Step 3: Present questions to the user

The survey response carries a pre-computed `groupedQuestions.groups[].batches[]` shape so the SKILL never has to sort, partition, or maintain a batchable-rule whitelist in prose. The sort key, `_no-source` sentinel, and batchable-rule list all live in `core/gotcha/group-and-batch-questions.ts` with vitest coverage (per ADR-016). Iterate over it:

For every `batch` in `groupedQuestions.groups.flatMap((g) => g.batches)`:

- **Single-question batch (`batch.questions.length === 1`)** — render the standard prompt for `batch.questions[0]`:

  ```
  **[{severity}] {ruleId}** — node: {nodeName}

  {question}

  > Hint: {hint}
  > Example: {example}
  ```

- **Batch of N ≥ 2 with `batch.batchable === true`** (#369) — render one shared prompt covering every member:

  ```
  **[{severity}] {ruleId}** — {batch.questions.length} instances:
    - {nodeName₁}
    - {nodeName₂}
    - …

  {sharedQuestionPrompt}

  Reply with one answer to apply to all {batch.questions.length}, or **split** to answer each individually.

  > Hint: {hint}
  > Example: {example}
  ```

  Where `sharedQuestionPrompt` reuses the rule's `question` text with the per-node noun replaced by the rule's plural noun (e.g. "These layers all use FILL sizing without min/max constraints. What size boundaries should they share?" instead of repeating the singular phrasing N times).

- **Any batch with `batch.batchable === false`** is always rendered as a single-question prompt — the helper guarantees `questions.length === 1` for those (identity-typed answers like `non-semantic-name`, structural-mod rules).

Wait for the user's answer before moving to the next batch. The user may:
- Answer the question / batch directly
- Say **split** (batch only) to fall back to per-question prompting for that batch
- Say **skip** to skip the question / the entire batch
- Say **n/a** if the question / the entire batch is not applicable

When applying the batched answer, expand back to per-question records in Step 4 — the gotcha section format stores one record per `nodeId`.

> The `groupedQuestions.groups[].instanceContext` field exists for the `canicode-roundtrip` SKILL's "Instance note" hoist (#370). This skill ignores it — every record gets its own `Instance context` bullet in Step 4 anyway.

### Step 4: Upsert the gotcha section

After collecting all answers, **upsert** this design's section into the `# Collected Gotchas` region at the bottom of this file:

```
.claude/skills/canicode-gotchas/SKILL.md
```

This file goes in the **user's project** (current working directory), NOT in the canicode repo. The Workflow region above **must never be modified** — only the `# Collected Gotchas` region below is touched.

#### Step 4a: Use the `designKey` from the survey response

`designKey` uniquely identifies the design so re-running on the same URL replaces the existing section in place. The survey response carries it on `survey.designKey` — read it directly. Do **not** parse the input URL in prose.

The `core/contracts/design-key.ts` helper (`computeDesignKey`) handles every shape with vitest coverage so the SKILL stays ADR-016-compliant:

- **Figma URL** → `<fileKey>#<nodeId>` with `-` → `:` normalization on the nodeId. Example: `https://figma.com/design/abc123XYZ/My-File?node-id=42-100&t=ref` → `designKey = "abc123XYZ#42:100"`. Trailing query parameters (`?t=...`, `?mode=...`) are dropped.
- **Figma URL without `node-id`** → just `<fileKey>` (file-level key).
- **Fixture path / JSON file** → absolute path.

#### Step 4b: Upsert via the canicode CLI

File-state detection (4-way: missing / valid / missing-heading / clobbered) and section walking (find existing `## #NNN — ...` by `Design key` substring, otherwise compute the next monotonic zero-padded NNN) are deterministic markdown operations and live in `core/gotcha/upsert-gotcha-section.ts` with vitest coverage — the SKILL never re-implements them in prose (per ADR-016).

Render the per-design section markdown using the **Output Template** below with the literal string `{{SECTION_NUMBER}}` in the header (the CLI substitutes the right NNN for you — preserves it on replace, computes the next monotonic value on append). Then invoke:

```bash
npx canicode upsert-gotcha-section \
  --file .claude/skills/canicode-gotchas/SKILL.md \
  --design-key "<designKey from Step 4a>" \
  --section -   # then pipe the rendered section markdown through stdin
```

The CLI prints a JSON result `{ state, action, sectionNumber, wrote, userMessage }`:

- `wrote: true` → success. `action` is `"replace"` (preserved `sectionNumber`) or `"append"` (next monotonic `sectionNumber`).
- `wrote: false` with `state: "missing"` → tell the user: *"Your gotchas SKILL.md is not installed yet. Run `canicode init` first, then re-invoke this skill."* Stop here.
- `wrote: false` with `state: "clobbered"` → tell the user: *"Your gotchas SKILL.md is missing the canicode YAML frontmatter (pre-#340 single-design clobber). Run `canicode init --force` to restore the workflow, then re-run this survey — your answers will land in a clean numbered section."* Stop here.
- `wrote: true` with `state: "missing-heading"` → silent recovery. The CLI injected the `# Collected Gotchas` heading and appended the section; the workflow region above is untouched.

The Workflow region above must never be touched. Do NOT copy Workflow prose into the per-design section; the section only carries metadata + gotcha answers.

## Output Template

Each per-design section in the `# Collected Gotchas` region has this exact shape:

````markdown
## #NNN — {designName} — {YYYY-MM-DD}

- **Figma URL**: {figmaUrl}
- **Design key**: {designKey}
- **Grade**: {designGrade}
- **Analyzed at**: {analyzedAt}

### Gotchas

#### {ruleId} — {nodeName}

- **Severity**: {severity}
- **Node ID**: {nodeId}
- **Instance context** (omit this bullet if `instanceContext` was not in the survey question): parent instance `parentInstanceNodeId`, source node `sourceNodeId`, component `sourceComponentName` / `sourceComponentId` when present — roundtrip apply uses this to write on the source definition when instance overrides fail.
- **Question**: {question}
- **Answer**: {userAnswer}

(repeat for each question)
````

### Field mapping

| Field | Source |
|-------|--------|
| `NNN` | `sectionNumber` — zero-padded three-digit index. Preserved on re-run, incremented on append. |
| `designName` | Figma file name or fixture name from the input |
| `YYYY-MM-DD` | Today's date (the day you are running the survey) |
| `figmaUrl` | The input URL or fixture path provided by the user |
| `designKey` | `survey.designKey` from the gotcha-survey response (see Step 4a) |
| `designGrade` | `designGrade` from gotcha-survey response |
| `analyzedAt` | Current timestamp (ISO 8601) |
| `ruleId` | `ruleId` from each question |
| `nodeName` | `nodeName` from each question |
| `severity` | `severity` from each question (blocking / risk) |
| `nodeId` | `nodeId` from each question |
| `instanceContext` | When present on the question, copy `parentInstanceNodeId`, `sourceNodeId`, `sourceComponentId`, `sourceComponentName` into the bullet above (roundtrip / Plugin apply) |
| `question` | `question` from each question |
| `userAnswer` | The answer collected from the user in Step 3 |

### Skipped questions

If the user skipped a question or said "n/a", still include it in the section with:

```markdown
- **Answer**: _(skipped)_
```

This ensures the code generation agent knows the gotcha exists even if no answer was provided.

## Edge Cases

- **No questions returned**: The design is ready for code generation. Inform the user and stop (Step 2). Do not touch the file.
- **Re-run on the same design**: Replace that design's section in place (matched by `Design key`) — preserve the original `#NNN` number. Do NOT append a duplicate.
- **Re-run on a different design**: Append a new section with the next `#NNN`. Prior designs' sections are untouched.
- **Workflow region**: Never modified. If you notice the Workflow region has been edited by the user, leave their edits alone — only the `# Collected Gotchas` region is under skill control.
- **Pre-#340 clobbered file** (the YAML frontmatter was rewritten to a per-design variant, so the canonical `canicode-gotchas` frontmatter is missing): tell the user to run `canicode init --force` to restore the workflow, then re-run the survey. The prior single-design content cannot be automatically migrated into a `## #001` section — the user re-runs and gets a clean section.
- **MCP tool not available**: Fall back to `npx canicode gotcha-survey <input> --json` — the CLI returns the same `GotchaSurvey` shape. If the CLI is also unavailable (e.g. no node runtime), tell the user to install the canicode MCP server or the `canicode` npm package (see Prerequisites).
- **Partial answers**: If the user stops mid-survey, upsert the section with answers collected so far. Mark remaining questions as _(skipped)_.
- **Manual section deletion**: If the user deletes a middle section by hand, do not renumber existing sections. The next new section still gets `(highest existing number) + 1`; numeric gaps are acceptable (same pattern as `.claude/docs/ADR.md`).

# Collected Gotchas
