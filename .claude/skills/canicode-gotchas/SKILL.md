---
name: canicode-gotchas
description: Gotcha survey workflow plus accumulating per-design answers — one Workflow region on top, numbered sections appended per Figma design
---

# CanICode Gotchas -- Design Gotcha Survey & Skill Writer

Run a gotcha survey on a Figma design to identify implementation pitfalls, collect developer answers, and upsert them into this skill file so code generation agents can reference them automatically. The file has two regions: the **Workflow** below (installed by `canicode init`, never overwritten) and the **Collected Gotchas** region at the bottom (one numbered section per design, replaced in place on re-runs).

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

For each question in the `questions` array, present it to the user one at a time:

```
**[{severity}] {ruleId}** — node: {nodeName}

{question}

> Hint: {hint}
> Example: {example}
```

Wait for the user's answer before moving to the next question. The user may:
- Answer the question directly
- Say "skip" to skip a question
- Say "n/a" if the question is not applicable

### Step 4: Upsert the gotcha section

After collecting all answers, **upsert** this design's section into the `# Collected Gotchas` region at the bottom of this file:

```
.claude/skills/canicode-gotchas/SKILL.md
```

This file goes in the **user's project** (current working directory), NOT in the canicode repo. The Workflow region above **must never be modified** — only the `# Collected Gotchas` region below is touched.

#### Step 4a: Compute `designKey`

`designKey` uniquely identifies the design so re-running on the same URL replaces the existing section in place. Parse it from the survey input:

- **Figma URL** — extract `fileKey` and `nodeId` from the URL and join them as `<fileKey>#<nodeId>`. Example: `https://figma.com/design/abc123XYZ/My-File?node-id=42-100` → `designKey = "abc123XYZ#42:100"` (convert `-` to `:` in nodeId, the same normalization the Figma MCP uses). Drop any other query-string parameters — only `node-id` matters for the key.
- **Fixture path** — use the absolute path, e.g. `/Users/me/project/fixtures/simple.json`.

Do **not** use the raw survey input URL as the key: trailing query parameters (`?t=...`, `?mode=...`) break string matching on re-runs.

#### Step 4b: Read the existing file and locate the target section

1. Read `.claude/skills/canicode-gotchas/SKILL.md` if it exists.
2. Detect the file's state using the two structural markers that uniquely identify each case — the YAML frontmatter (present on every `canicode init` install) and the `# Collected Gotchas` heading (present on every post-#340 install):
   - **File missing** → tell the user to run `canicode init` first, then re-invoke this skill. Stop here.
   - **File has YAML frontmatter AND a `# Collected Gotchas` heading** (the default shipped shape since #340) → proceed to step 3 below.
   - **File has YAML frontmatter but no `# Collected Gotchas` heading** (an older workflow install, or a user-edited workflow that dropped the trailing heading) → preserve everything above unchanged and append a new `# Collected Gotchas` heading at the bottom, then proceed to step 3.
   - **File missing the YAML frontmatter** (a pre-#340 single-design clobber — the old overwrite rewrote the frontmatter's `description` to the per-design variant, so a well-formed canicode frontmatter is the cleanest discriminator) → **do not attempt to reconstruct the workflow inline**. Tell the user: "Your gotchas SKILL.md looks like the pre-#340 single-design format. Run `canicode init --force` to restore the workflow, then re-run this survey — your answers will land in a clean numbered section." Stop here.
3. Walk the existing `## #NNN — ...` sections under `# Collected Gotchas` and look for one whose `- **Design key**:` bullet matches the `designKey` from Step 4a. Substring match against the bullet value is sufficient.
   - **Found** → replace that section in place. **Preserve its `#NNN` number** so external references (downstream skills, user notes) remain stable.
   - **Not found** → append a new section at the bottom of the region. `#NNN = (highest existing number) + 1`, zero-padded to three digits. Never reuse a number that appeared earlier and was deleted; numbering is monotonic.

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
| `designKey` | `<fileKey>#<nodeId>` for Figma URLs, absolute path for fixtures (see Step 4a) |
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
