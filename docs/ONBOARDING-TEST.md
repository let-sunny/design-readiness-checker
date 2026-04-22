# Onboarding Test Script — GitHub Link → Design-to-Code

A human-run end-to-end test that simulates a fresh user landing on the canicode GitHub URL and going from a Figma design to generated code via `/canicode-roundtrip`. Run this script after any change that touches the onboarding surface (README, `canicode init`, bundled skill files, ADR-012/013/014 prose) to catch drift before external users do.

This is **not** an automated test. It requires a live Figma file, a Figma Full seat, a real FIGMA_TOKEN, and an interactive Claude Code session, none of which can be exercised from CI.

## Who this script is for

The validator role-plays a person who:

- has Claude Code installed,
- has a Figma file they can edit (Full seat),
- has a `FIGMA_TOKEN` (`figd_…`) ready,
- received the canicode GitHub URL from a coworker and knows nothing else about the project,
- wants to *turn this Figma design into code with AI assistance*.

The validator must resist their own prior knowledge of canicode internals — if a sentence in the README or a skill prompt would confuse a fresh reader, that is a ⚠️, not a pass.

## Before you start

1. Open a **fresh empty directory** outside this repository's working tree (or a new `git clone` of an unrelated project). The script's whole point is to observe what a clean environment produces; running inside `canicode/` contaminates the `.claude/skills/` inspection.
2. Have the canicode GitHub URL, a Figma URL you can edit, and your `FIGMA_TOKEN` on hand.
3. Keep a copy of the result table below open — fill in ✅ / ⚠️ / ❌ and notes as you go. Paste the completed table into a comment on issue #322 when finished.

## Status markers

| Marker | Meaning |
|--------|---------|
| ✅ | Worked as written. No follow-up needed. |
| ⚠️ | Worked but with friction — a fresh user could get stuck or confused. Note what. |
| ❌ | Failed — step did not produce the expected outcome. Note what happened and what should change. |
| 📝 | (Inside the roundtrip apply step) canicode annotated the scene node instead of writing the property. This is **expected** under ADR-012, not a failure. |
| 🌐 | (Inside the roundtrip apply step) canicode wrote the definition node — only possible when `allowDefinitionWrite` is opted in. |

## Test procedure

Fill in the Result and Notes columns as you run each step. One row per touchpoint.

| # | Step | What to do | Expected outcome | Result (✅ / ⚠️ / ❌) | Notes |
|---|------|------------|------------------|----------------------|-------|
| 1 | Land on README | Open the canicode GitHub URL the coworker sent. Read only the top of the README (above the fold — logo, tagline, first 1-2 paragraphs). | The tagline and first paragraphs make it clear that canicode is part of a **design-to-code** flow — not only a scoring/analysis tool. A fresh reader should be able to answer "will this help me turn a Figma design into code?" with yes without scrolling. | | |
| 2 | Find install instruction | Scroll to the `## Installation` section of the README. Note which install command appears **first**. | The first command a fresh user encounters for the design-to-code story is `npx canicode init --token figd_xxx` — the one that installs the skills. If a different command (e.g. `npx canicode analyze`) appears first and leads the reader down the analyze-only path, flag as ⚠️ and record what they see. | | |
| 3 | Run install | In your fresh empty directory, run `npx canicode init --token figd_xxxxxxxxxxxxx` with your real token. | Stdout includes `Config saved:` (with a path), `Reports will be saved to:` (with a path), `Skills installed to: …/.claude/skills/`, and three counter lines (`installed:`, `overwritten:`, `skipped:`); on a fresh install the `installed` count equals the number of bundled skill files (currently 4 — three `SKILL.md` files plus `canicode-roundtrip/helpers.js`) and `overwritten` / `skipped` are both 0. Afterwards, `ls .claude/skills/` lists **three** directories (`canicode`, `canicode-gotchas`, `canicode-roundtrip`), and `ls .claude/skills/canicode-roundtrip/` lists **both** `SKILL.md` and `helpers.js`. Afterwards the command prints a `Next:` checklist: (1) `claude mcp add -s project -t http figma https://mcp.figma.com/mcp`, (2) `Restart Claude Code (so the new skills + Figma MCP tools both load)`, (3) `Run /canicode-roundtrip <figma-url>`. If the fresh directory already has a `.mcp.json` registering a `figma` entry, step (1) is omitted and step (2) mentions skills only. Mark ⚠️ if the checklist or the Figma MCP install command is missing, not if the 2-step variant appears. | | |
| 4 | Set up Figma MCP | Re-read the README to figure out how to install the Figma MCP server (separate prerequisite — canicode does not install it for you). Run that command. | The README clearly states Figma MCP is a **separate** prerequisite from `canicode init`, provides the literal `claude mcp add … figma …` command, and makes the separation discoverable from the Skills section (not only from the MCP-server channel section). A fresh user invoking `/canicode-roundtrip` without the Figma MCP installed will hit a dead end at Step 4 of the skill, so this prerequisite must be conspicuous. If the Skills section does not surface the Figma MCP requirement, flag as ⚠️. | | |
| 4b | Set up canicode MCP (optional speed path) | From the README MCP section, run `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp`. **Restart Claude Code** (full restart — same as row 3’s Figma MCP note). In a new session run `claude mcp list` (or the host’s MCP status UI) and confirm **canicode** is connected / tools include `mcp__canicode__analyze` (or equivalent). | Without restart, the entry may exist in `.mcp.json` while tools stay unloaded — the live smoke failure in #433. Mark ❌ if the README never tells you to restart after adding canicode MCP. | | |
| 5 | Invoke the roundtrip skill | Open Claude Code in the same directory and type `/canicode-roundtrip <your-figma-url>`. | Claude Code resolves `/canicode-roundtrip` against the `.claude/skills/canicode-roundtrip/SKILL.md` file installed in row 3 (slash-command discovery against `.claude/skills/`), acknowledges the skill, and begins the Step 1 analyze call. Optional: with canicode MCP loaded (row 4b), Step 1 should use the MCP tool path rather than spawning `npx canicode analyze` in the transcript. | | |
| 6 | Walk through the gotcha survey | Answer each question the skill asks. Try answering one directly, say `skip` on one, say `n/a` on one. | Questions are presented **one at a time** (not a wall of them), each with its severity, ruleId, node name, question body, Hint, and Example. After the last question, the skill writes `.claude/skills/canicode-gotchas/SKILL.md` in your working directory. Open that file and verify every answered question appears with `Question:` and `Answer:` fields, and skipped/n/a questions appear under **`#### Skipped (N)`** with per-`ruleId` counts (not inline `_(skipped)_` on each row). | | |
| 7 | Apply step | Let the skill run `use_figma` to apply your answers to the Figma design. Watch the final summary block. | The summary block lists each applied change with a marker. **Under ADR-012's default (annotate-by-default, definition write opt-in)**, seeing a lot of 📝 markers on instance children is **correct behavior, not a failure** — canicode deliberately annotates the scene node instead of propagating to every instance of the source component. ✅ means the scene / instance-child write succeeded; 🌐 means a definition-level write propagated (only possible if the skill explicitly collected your opt-in confirmation up front). Any other marker (⏭️ for user-declined, 🔧 for auto-fix renames, 🔗 for variable-bound writes) matches the report format in `canicode-roundtrip/SKILL.md`. Mark ⚠️ only if the summary block is missing, markers are undocumented, or the skill wrote definition nodes without asking you first. | | |
| 8 | Re-analyze | Let the skill run the re-analyze step and report the new grade. | Re-analyze runs **in the same session** immediately after apply (#440) — not on a later user prompt. The skill's headline is the **issues-delta breakdown** — a tally of what the roundtrip addressed (✅ resolved, 📝 annotated on Figma, 🌐 definition writes propagated, ⏭️ skipped) plus a `V issues remaining` line. Under ADR-012 most gotcha answers land as 📝 annotations and do **not** move the grade, so a flat `{oldGrade} → {newGrade}` footnote is expected (not a failure). Grade still appears as a secondary footnote line — and **must not regress**; if it does, note which rules newly fired after the apply pass (a structural change may have surfaced new issues, per the "Re-analyze shows new issues" edge case in `canicode-roundtrip/SKILL.md`). If all gotchas resolved, the skill announces readiness for code generation; if some remain, the skill asks whether to proceed with remaining context. | | |
| 9 | Handoff to `figma-implement-design` | Read how the skill tells you to generate code. | **Per ADR-013**, canicode's scope ends at Figma augmentation — code generation belongs to Figma's official `figma-implement-design` skill. The roundtrip skill should hand you off to `figma-implement-design` explicitly, not attempt to package code generation itself. If the skill ends at "ready for code generation" without naming the downstream skill, flag as ⚠️ — a fresh user won't know what to invoke next. | | |

## After the run

1. Copy the filled-in table above (with your ✅ / ⚠️ / ❌ and notes) into a comment on issue #322.
2. For every row marked ⚠️ or ❌:
   - Open a **separate follow-up issue** describing the friction — concrete reproduction steps, the expected outcome from the table, and the actual outcome you observed. Do **not** attempt to silently fix the problem inside issue #322 or inside the PR that added this script.
   - Link each follow-up issue back from your comment on #322 so the chain is discoverable.
3. Leave issue #322 **open** until every ❌ row has a merged fix. ⚠️ rows may block or not at the maintainer's discretion — record that call in the follow-up issue rather than here.

## Why the ADR references matter

Two places in the script (rows 7 and 9) rely on ADR knowledge the validator might not have:

- **Row 7** — ADR-012 made scene annotation the default failure mode for instance-child writes. Without knowing this, a validator reading a summary full of 📝 markers would incorrectly mark the apply step as ❌.
- **Row 9** — ADR-013 drew the scope boundary between canicode (Figma augmentation) and `figma-implement-design` (code generation). Without knowing this, a validator might expect canicode itself to generate code and mark the handoff as ❌.

If either ADR changes, this script needs to change with it.
