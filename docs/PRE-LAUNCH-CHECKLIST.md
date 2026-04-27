# Pre-Launch Smoke Checklist

A human-run smoke pass covering every user-facing surface (CLI, MCP, Skills, Web App, Figma Plugin, package metadata, docs, regression, telemetry) before cutting the next npm release. Catches regressions that the pipeline's lint + test + build cannot — UI rendering, MCP wiring, Plugin runtime, README link rot, package metadata.

This is **not** an automated test. It runs against built artifacts, a freshly packed tarball, live browsers, and the Figma desktop app, none of which can be exercised from CI.

## Scope

This checklist is **surface-level smoke** — does every channel boot, render, and respond without crashing. The granular end-to-end onboarding walkthrough (install → gotcha survey → apply → re-analyze → handoff) lives in issue #332 / `docs/ONBOARDING-TEST.md` and is **not** duplicated here. Section E below only asserts skill presence and slash-command discoverability; the full walkthrough is deferred to #332.

## Why this is separate from #332

- **This checklist** = maintainer's pre-tag smoke pass. Fast, surface-level, release-gating.
- **#332** = fresh-user onboarding E2E. Slow, deep, product-quality gating.

A green smoke pass does **not** imply a green onboarding E2E, and vice versa. Keep them separate so a release is not silently blocked by onboarding drift, and onboarding drift is not silently masked by a green smoke pass.

## Status markers

| Marker | Meaning |
|--------|---------|
| ✅ | Worked as written. No follow-up needed. |
| ⚠️ | Worked but with friction — flag the rough edge; maintainer decides whether to block. Note what. |
| ❌ | Failed — step did not produce the expected outcome. Note what happened and what should change. |

## How to run

1. Run **A** + **B** in this repo (CI + local).
2. Run **C–E** in a **fresh empty directory** outside this repository with a `pnpm pack` tarball linked locally (simulates the published install before pushing the tag).
3. Run **F–G** by serving the built artifacts (`app/web/dist/` in a browser, `app/figma-plugin/dist/` loaded into Figma desktop).
4. **H–J** are read-only audits — do them last.
5. Any ❌: open a **separate fix issue**, do not patch silently inside this checklist or its PR. Mark the row, link the fix issue.
6. When all green → cut version + push tag → CI publishes → unblock #332.

## A. Build & CI sanity

- [ ] `pnpm lint` green
- [ ] `pnpm test:run` green
- [ ] `pnpm build` produces `dist/cli/index.js`, `dist/mcp/index.js`
- [ ] `scripts/build-web.sh` produces `app/web/dist/`
- [ ] `scripts/build-plugin.sh` produces `app/figma-plugin/dist/`
- [ ] No new TypeScript warnings introduced since last release

## B. Package metadata (`package.json`)

- [ ] `version` bumped to intended release
- [ ] `bin` entries resolve (`canicode`, `canicode-mcp`)
- [ ] `files` array includes `dist/` + `skills/` (npm pack dry-run)
- [ ] `npm pack --dry-run` tarball lists every bundled SKILL.md + `helpers.js`
- [ ] `README.md` rendered on npmjs.com preview has no broken images/links

## C. CLI smoke (in fresh dir, against published-ish tarball or `pnpm link`)

- [ ] `canicode --version` matches `package.json`
- [ ] `canicode --help` lists all commands
- [ ] `canicode init --token figd_xxx` prints expected counter lines (4 installed on fresh) — see #332 row 3
- [ ] `canicode init` (no flags, in a TTY) prompts for the token and proceeds (#505)
- [ ] `canicode init` (no flags, non-TTY) prints the setup guide and does **not** hang (#505)
- [ ] `canicode config show` prints masked token + paths (#505)
- [ ] `canicode config path` prints absolute config path on a single line (#505)
- [ ] `canicode config set-token --token figd_xxx` rotates the token without re-copying skills (#505)
- [ ] `canicode docs setup` topic renders
- [ ] `canicode docs <other-topics>` no broken topics
- [ ] `canicode analyze <figma-url>` against real token completes without crash, writes report
- [ ] Missing FIGMA_TOKEN → clear error message (not a stack trace)

## D. MCP server smoke

- [ ] `canicode-mcp` boots via stdio
- [ ] `analyze` tool callable from Claude Desktop / test harness
- [ ] `gotcha-survey` tool callable
- [ ] stderr clean (no unexpected warnings/errors at boot)

## E. Skills (Claude Code) — light pass; full E2E in #332

- [ ] After `canicode init`, `.claude/skills/` has 3 dirs (canicode, canicode-gotchas, canicode-roundtrip) + `canicode-roundtrip/helpers.js`
- [ ] All 3 SKILL.md frontmatter valid (description, allowed-tools)
- [ ] `/canicode` slash discoverable in Claude Code
- [ ] `/canicode-gotchas` slash discoverable
- [ ] `/canicode-roundtrip` slash discoverable
- [ ] (Full E2E walkthrough → tracked in #332)

## F. Web App (GitHub Pages) — `app/web/dist/`

- [ ] Loads in browser without console errors
- [ ] Paste a Figma URL → analyze → report renders
- [ ] Gauge displays the correct grade
- [ ] Issue list / tab UI navigable
- [ ] Responsive viewport switch (1920 / 768) renders both
- [ ] Empty state (no token / invalid URL) shows clear message

## G. Figma Plugin — `app/figma-plugin/dist/`

- [ ] Loads in Figma desktop without console errors
- [ ] Analyze button on a selected node returns a report
- [ ] Survey UI renders questions one-at-a-time, persists answers
- [ ] Apply step runs without crash; summary block shows ✅ / 📝 / 🌐 markers per ADR-012
- [ ] Re-analyze button works and re-renders the new grade

## H. Documentation drift

- [ ] `docs/CUSTOMIZATION.md` rule table matches current rule set (`pnpm tsx scripts/sync-rule-docs.ts` no diff)
- [ ] README links all resolve (no 404s)
- [ ] All ADR file references in README / SKILL.md still exist
- [ ] Wiki Decision Log up-to-date with merged decisions since last release

## I. Regression check (since last release)

- [ ] List merged PRs since last `v0.x.x` tag (`git log --oneline v0.x.x..main`)
- [ ] For each user-facing change, re-verify the flow it modified
- [ ] No silent dependency upgrades (`pnpm-lock.yaml` diff explainable)

## J. Telemetry / observability

- [ ] `canicode init` telemetry events fire (per ADR-012)
- [ ] `canicode config set-token` emits the `cli_config_set_token` event (#505)
- [ ] No PII (tokens, file content) in logged events

## After the run

1. For every row marked ⚠️ or ❌:
   - Open a **separate fix issue** describing the failure — concrete reproduction steps, the expected outcome from this checklist, and the actual outcome you observed. Do **not** attempt to silently fix the problem inside the release PR.
   - Mark the row in your local copy of this checklist and link the fix issue there.
2. Do not cut the tag until every ❌ row has a merged fix. ⚠️ rows may block or not at the maintainer's discretion — record that call in the follow-up issue rather than here.
3. When all green → cut version + push tag → CI publishes → unblock #332.

## Out of scope

- The actual end-to-end execution of the onboarding script (covered by #332)
- Calibration runs (separate process, not blocking release)
- Performance benchmarks (not currently tracked)
