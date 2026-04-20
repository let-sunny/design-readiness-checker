# Architecture

## External (5 User-Facing Channels)

**1. CLI (`canicode analyze`)**
- Data source: Figma REST API (requires FIGMA_TOKEN) or JSON fixture
- Output: HTML report (opens in browser)
- Options: `--preset`, `--token`, `--output`, `--config`
- Component master resolution: fetches `componentDefinitions` for accurate component analysis
- Annotations: NOT available (REST API annotations field is private beta)

**2. MCP Server (`canicode-mcp`)**
- Install: `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp` (long-form flags; short-form `-y -p` collides with `claude mcp add`'s parser, #366)
- Tools: `analyze`, `gotcha-survey`, `list-rules`, `visual-compare`, `version`, `docs`
- Data source: Figma REST API via `input` param (Figma URL or fixture path). Requires FIGMA_TOKEN for live URLs.

**3. Claude Code Skill (`/canicode`)**
- Location: `.claude/skills/canicode/SKILL.md` (copy to any project)
- Uses CLI (`canicode analyze`) with FIGMA_TOKEN
- Lightweight alternative to MCP server — no canicode MCP installation needed

**3a. Claude Code Skill (`/canicode-gotchas`)**
- Location: `.claude/skills/canicode-gotchas/SKILL.md` (copy to any project)
- Data source: `gotcha-survey` MCP tool OR `npx canicode gotcha-survey --json` CLI fallback (canicode MCP server is optional)
- Workflow: calls gotcha-survey → presents questions to user → collects answers → writes `.claude/skills/canicode-gotchas/SKILL.md` in the user's project
- Output: skill file with design gotcha Q&A pairs (nodeId, ruleId, severity, question, answer)
- Purpose: collect implementation context that Figma cannot encode natively and persist it as annotation-ready gotcha answers for downstream `figma-implement-design`
- Trigger model: rules run as rule-based best-practice detection, and gotcha is emitted as annotation output from the same detection pass. Triggering rules may be violation rules (score-primary) or info-collection rules (annotation-primary), per ADR-017
- **Augmentation handoff**: Auto-discovery of a separate skill file cannot reach `figma-implement-design` (Figma skills only support explicit cross-references). The `canicode-roundtrip` orchestration skill (#277) connects analyze → gotcha survey → apply to Figma in a single flow; the user then invokes `figma-implement-design` for code generation (ADR-009, ADR-013).

**3b. Claude Code Skill (`/canicode-roundtrip`)**
- Location: `.claude/skills/canicode-roundtrip/SKILL.md` (copy to any project)
- Data source: `analyze` + `gotcha-survey` MCP tools OR `npx canicode analyze/gotcha-survey --json` CLI fallback (canicode MCP server is optional). Figma MCP (`get_design_context`, `get_screenshot`, `use_figma`) is still REQUIRED — there is no CLI fallback for `use_figma`.
- Workflow: analyze → gate on `isReadyForCodeGen` → gotcha survey (if needed) → **apply fixes to Figma via `use_figma`** → re-analyze → ready for `figma-implement-design`
- Scope note: analysis scope (page/screen vs standalone component) directly changes rule evaluation intent and therefore which gotcha prompts appear; scope-sensitive behavior is architecture-owned (see #404)
- True roundtrip: gotcha answers are applied back to the Figma design (property modification, structural modification with confirmation, or annotations for unfixable issues) so the design itself improves. Code generation is the user-driven downstream step (ADR-013) — canicode hands off once the re-analyze passes.
- Requires Figma Full seat + file edit permission for `use_figma`; falls back to one-way flow (gotcha answers stay as a separate skill file the user can reference) if no edit permission
- See #281, ADR-010

**4. Web App (GitHub Pages)**
- Source: `app/web/src/index.html`
- Build: `pnpm build:web` → `app/web/dist/` (deployed via GitHub Pages)
- Shared UI from `app/shared/` inlined at build time

**5. Figma Plugin**
- Source: `app/figma-plugin/src/`
- Build: `pnpm build:plugin` → `app/figma-plugin/dist/` (gitignored)
- Shared UI from `app/shared/` inlined at build time

### CLI Commands (User-Facing)

Registered in `src/cli/index.ts` (lines 71–79) + docs command (line 102). Internal commands are filtered from `--help` via the `INTERNAL_COMMANDS` array.

User-facing CLI commands mirror the MCP tool surface — call whichever channel is already set up. `analyze` and `gotcha-survey` return the same JSON (with `--json`) as their MCP counterparts.

| Command | Description |
|---------|-------------|
| `analyze <input>` | Analyze a Figma file or JSON fixture |
| `gotcha-survey <input>` | Generate a gotcha survey (same shape as the MCP `gotcha-survey` tool) |
| `design-tree <input>` | Generate a DOM-like design tree from a Figma file or fixture |
| `visual-compare <codePath>` | Compare rendered code against Figma screenshot (pixel-level similarity) |
| `init` | Set up canicode with Figma API token |
| `config` | Manage canicode configuration |
| `list-rules` | List all analysis rules with scores and severity |
| `docs [topic]` | Show documentation (topics: setup, rules, config, visual-compare, design-tree) |

## Internal (Claude Code Only)

### Orchestration Scripts

**`scripts/calibrate.ts`**
- Role: Explicit step-by-step calibration pipeline (ADR-008)
- Input: fixture directory path (e.g. `fixtures/material3-kit`), or `--resume <run-dir>`
- Flow: Analyze → Design Tree → Strip → Convert (7 parallel `claude -p` sessions) → Measure → Gap Analyze → Evaluate → Critic → Arbitrator → Evidence
- Each step tracked in `index.json` for resume-from-failure
- Converter runs 7 parallel sessions: 1 baseline + 6 strip ablation types
- **Strip ablation**: Measures 6 stripped design-trees (`DESIGN_TREE_INFO_TYPES` in `src/core/design-tree/strip.ts`: layout-direction-spacing, size-constraints, component-references, node-names-hierarchy, variable-references, style-references) → similarity delta vs baseline (plus tokens/HTML/CSS/responsive) → objective difficulty per rule category
- Cross-run evidence: Evaluation appends overscored/underscored findings to `data/calibration-evidence.json`
- After Arbitrator applies changes, evidence for applied rules is pruned (`calibrate-prune-evidence`)
- Each run creates a self-contained directory: `logs/calibration/<fixture>--<timestamp>/`

**`scripts/develop.ts`**
- Role: Automated feature development — reads a GitHub issue, plans, implements, tests, reviews, and creates a draft PR
- Input: GitHub issue number (e.g. `247`), or `--resume <run-dir>`
- Flow: Plan (agent) → Implement (agent) → Test (cli, retry loop) → Review (agent) → Fix (agent) → Verify (cli) → PR (cli)
- State tracked in `logs/develop/<issue>--<timestamp>/index.json`
- Test/Verify steps have internal fix retry loops (max 3 retries with fix agent)
- Implementer timeout scales with plan size: `max(600s, files * 120s)` capped at 60 min. Up to 2 attempts; the retry stops if attempt 2 wrote the identical file set as attempt 1 (stuck, not flaky). Each attempt writes `implement-attempts/<n>.json`.
- On Implementer timeout the orchestrator synthesizes a partial `implement-log.json` from the PostToolUse heartbeat (`implement-progress.jsonl`), saves the stderr tail to `implement-err.txt`, and stashes uncommitted work so `--resume --from implement` starts from a clean tree.
- Planner applies five split gates (task count >5, file count ≥12, new-dir + new-bundler, skill/ADR doc + TS code, approach >2500 chars) and sets `splitReason` in `plan.json` when a gate fires. See `.claude/agents/develop/planner.md` §Split gates.
- Sub-agent sessions receive `DEVELOP_SUBAGENT=1` so the `.claude/settings.json` Stop hook short-circuits and doesn't flood the user channel with pnpm lint/build output on every agent stop.
- JSON handoff chain: `plan.json` (designDecisions) → `implement-log.json` (decisions, knownRisks) → `review.json` (implementIntent, intentConflict) → `fix-log.json` (resolution, skipped reasons)
- Each `claude -p` agent receives previous step JSONs so it understands why, not just what
- See: issues #247 and #301

### CLI Commands (Internal)

All 15 internal commands are registered in `src/cli/index.ts` (lines 82–95), hidden from `--help` via the `INTERNAL_COMMANDS` array in `src/cli/internal-commands.ts`. Source files live in `src/cli/commands/internal/`.

**Calibration pipeline** — deterministic steps called by `scripts/calibrate.ts`:

| Command | Description |
|---------|-------------|
| `calibrate-analyze <input>` | Run calibration analysis and output JSON for conversion step |
| `calibrate-run <input>` | Run full calibration pipeline (analysis-only, conversion via /calibrate) |
| `calibrate-evaluate [analysisJson] [conversionJson]` | Evaluate conversion results and generate calibration report |
| `calibrate-gap-report` | Aggregate gap data and calibration runs into a rule review report |
| `calibrate-gather-evidence <runDir>` | Gather structured evidence for Critic from run artifacts + cross-run data |
| `calibrate-finalize-debate <runDir>` | Check early-stop or determine stoppingReason after debate |
| `calibrate-enrich-evidence <runDir>` | Enrich evidence with Critic's pro/con/confidence from debate.json |
| `calibrate-prune-evidence <runDir>` | Prune evidence for rules applied by the Arbitrator in the given run |

**Fixture management** — fixture lifecycle and data preparation:

| Command | Description |
|---------|-------------|
| `calibrate-save-fixture <input>` | Save Figma design as a fixture directory for calibration |
| `calibrate-implement <input>` | Prepare design-to-code package: analysis + design tree + assets + prompt |
| `fixture-list [fixturesDir]` | List active and done fixtures |
| `fixture-done <fixturePath>` | Move a converged fixture to done/ |

**Utility** — standalone processing steps:

| Command | Description |
|---------|-------------|
| `design-tree-strip <input>` | Generate stripped design-tree variants for ablation |
| `html-postprocess <input>` | Sanitize HTML and inject local fonts |
| `code-metrics <input>` | Compute code metrics for an HTML file |

### Claude Code Commands

**`/calibrate`**
- Wrapper: runs `npx tsx scripts/calibrate.ts $ARGUMENTS` and reports results
- Modes: `<fixture-path>` (single), `--all` (all active fixtures), `--resume <run-dir>`
- `--all` mode: discovers active fixtures, runs sequentially, checks convergence via `fixture-done`, runs regression check, generates aggregate report

**`/develop`**
- Wrapper: runs `npx tsx scripts/develop.ts $ARGUMENTS` and reports the resulting `index.json` summary
- Modes: `<issue-number>` (new run), `--resume <run-dir>` (continue), optional `--from <step>` (re-run from plan/implement/test/review/fix/verify/pr)
- Source: `.claude/commands/develop.md` — orchestrates the full Plan → Implement → Test → Review → Fix → Verify → PR pipeline described under `scripts/develop.ts` above

**`/review-run`**
- Role: QA review of a completed `/develop` pipeline run — reads all output artifacts and produces a structured assessment
- Input: run directory path (e.g. `logs/develop/253--2026-04-16-0903`)
- Flow: index.json → plan.json → implement-log.json + git diff → test-result.json → review.json → fix-log.json → circuit.json → final verdict

### Build & Doc Scripts

Non-orchestrator helpers in `scripts/`. Build scripts are wired into `package.json` (`pnpm build:web`, `pnpm build:plugin`); the others run on demand.

| Script | Role |
|---|---|
| `scripts/build-web.sh` | Build `app/web/` for GitHub Pages deployment |
| `scripts/build-plugin.sh` | Build `app/figma-plugin/` (output `app/figma-plugin/dist/`, gitignored) |
| `scripts/develop-heartbeat.sh` | PostToolUse hook for `/develop` Implementer sub-agents — appends a line to `implement-progress.jsonl` so the orchestrator can recover progress on timeout. Guarded by `$DEVELOP_RUN_DIR`; no-op outside `/develop` sessions. |
| `scripts/sync-rule-docs.ts` | Auto-generate rule tables from `rule-config.ts` + rule registry into `docs/CUSTOMIZATION.md` (and the wiki `Rule-Reference.md` page if `/tmp/canicode-wiki/` is cloned). Run after editing rule config or registry. |

## File Output Structure

```text
data/calibration-evidence.json              # Cross-run calibration evidence (overscored/underscored rules)
reports/                                    # HTML reports (canicode analyze)
logs/calibration/                           # Calibration runs (internal)
logs/calibration/<name>--<timestamp>/       # One calibration run = one folder
  ├── index.json                            #   Pipeline state (per-step status, resume point)
  ├── analysis.json                         #   Rule analysis result
  ├── conversion.json                       #   HTML conversion + similarity + stripDeltas
  ├── stripped/                             #   Strip ablation outputs (6 types, see DESIGN_TREE_INFO_TYPES)
  │   ├── <type>.txt                        #   Stripped design-tree
  │   └── <type>.html                       #   HTML from stripped design-tree
  ├── gaps.json                             #   Pixel gap analysis
  ├── debate.json                           #   Critic + Arbitrator decisions
  ├── activity.jsonl                        #   Agent step-by-step timeline
  ├── summary.md                            #   Human-readable summary
  ├── output.html                           #   Generated HTML page
  ├── design-tree.txt                       #   Design tree (structure)
  ├── figma.png                             #   Figma screenshot
  ├── code.png                              #   Code rendering screenshot
  └── diff.png                              #   Pixel diff image
logs/calibration/REPORT.md                  # Cross-run aggregate report
logs/develop/                               # Development pipeline runs
logs/develop/<issue>--<timestamp>/          # One development run = one folder
  ├── index.json                            #   Pipeline state (per-step status, resume point)
  ├── plan.json                             #   Implementation plan (tasks, designDecisions, splitReason)
  ├── implement-log.json                    #   Decisions + knownRisks; status=timeout + completedTasks on timeout
  ├── implement-output.txt                  #   Implementer agent raw output
  ├── implement-progress.jsonl              #   PostToolUse heartbeat (one line per Edit/Write + task-start markers)
  ├── implement-attempts/<n>.json           #   Per-attempt record (status, filesWritten, lastTaskId) — stall detection input
  ├── implement-err.txt                     #   Stderr+stdout tail (last 2KB) on Implementer failure
  ├── test-result.json                      #   Test pass/fail + error details
  ├── review.json                           #   Self-review (implementIntent, intentConflict flags)
  ├── fix-log.json                          #   What was fixed/skipped and why
  ├── circuit.json                          #   Verify retry circuit state (attempt count, error counts)
  └── pr-url.txt                            #   Created PR URL
logs/activity/                              # Nightly orchestration logs
```
