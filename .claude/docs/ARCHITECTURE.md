# Architecture

## External (5 User-Facing Channels)

**1. CLI (`canicode analyze`)**
- Data source: Figma REST API (requires FIGMA_TOKEN) or JSON fixture
- Output: HTML report (opens in browser)
- Options: `--preset`, `--token`, `--output`, `--config`
- Component master resolution: fetches `componentDefinitions` for accurate component analysis
- Annotations: NOT available (REST API annotations field is private beta)

**2. MCP Server (`canicode-mcp`)**
- Install: `claude mcp add canicode -- npx -y -p canicode canicode-mcp`
- Tools: `analyze`, `gotcha-survey`, `list-rules`, `visual-compare`, `version`, `docs`
- Data source: Figma REST API via `input` param (Figma URL or fixture path). Requires FIGMA_TOKEN for live URLs.

**3. Claude Code Skill (`/canicode`)**
- Location: `.claude/skills/canicode/SKILL.md` (copy to any project)
- Uses CLI (`canicode analyze`) with FIGMA_TOKEN
- Lightweight alternative to MCP server — no canicode MCP installation needed

**3a. Claude Code Skill (`/canicode-gotchas`)**
- Location: `.claude/skills/canicode-gotchas/SKILL.md` (copy to any project)
- Data source: `gotcha-survey` MCP tool (requires canicode MCP server)
- Workflow: calls gotcha-survey → presents questions to user → collects answers → writes `.claude/skills/canicode-gotchas/SKILL.md` in the user's project
- Output: skill file with design gotcha Q&A pairs (nodeId, ruleId, severity, question, answer)
- **How code generation consumes it**: The output skill file lives in `.claude/skills/` with a description field mentioning "code generation". Claude Code automatically scans skills and loads relevant ones based on description + conversation context. When a user asks "implement this design", the gotcha skill file is auto-loaded — no explicit wiring needed. This is the standard Figma MCP gotcha pattern (ADR-009).

**4. Web App (GitHub Pages)**
- Source: `app/web/src/index.html`
- Build: `pnpm build:web` → `app/web/dist/` (deployed via GitHub Pages)
- Shared UI from `app/shared/` inlined at build time

**5. Figma Plugin**
- Source: `app/figma-plugin/src/`
- Build: `pnpm build:plugin` → `app/figma-plugin/dist/` (gitignored)
- Shared UI from `app/shared/` inlined at build time

### CLI Commands (User-Facing)

Registered in `src/cli/index.ts` (lines 71–77) + docs command (line 101). Internal commands are filtered from `--help` via the `INTERNAL_COMMANDS` array.

| Command | Description |
|---------|-------------|
| `analyze <input>` | Analyze a Figma file or JSON fixture |
| `design-tree <input>` | Generate a DOM-like design tree from a Figma file or fixture |
| `visual-compare <codePath>` | Compare rendered code against Figma screenshot (pixel-level similarity) |
| `init` | Set up canicode with Figma API token |
| `config` | Manage canicode configuration |
| `list-rules` | List all analysis rules with scores and severity |
| `prompt` | Output the standard design-to-code prompt for AI code generation |
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
- JSON handoff chain: `plan.json` (designDecisions) → `implement-log.json` (decisions, knownRisks) → `review.json` (implementIntent, intentConflict) → `fix-log.json` (resolution, skipped reasons)
- Each `claude -p` agent receives previous step JSONs so it understands why, not just what
- See: issue #247

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

**`/review-run`**
- Role: QA review of a completed `/develop` pipeline run — reads all output artifacts and produces a structured assessment
- Input: run directory path (e.g. `logs/develop/253--2026-04-16-0903`)
- Flow: index.json → plan.json → implement-log.json + git diff → test-result.json → review.json → fix-log.json → circuit.json → final verdict

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
  ├── plan.json                             #   Implementation plan (tasks, designDecisions, risks)
  ├── implement-log.json                    #   Decisions + knownRisks (context chain for Review/Fix)
  ├── implement-output.txt                  #   Implementer agent raw output
  ├── test-result.json                      #   Test pass/fail + error details
  ├── review.json                           #   Self-review (implementIntent, intentConflict flags)
  ├── fix-log.json                          #   What was fixed/skipped and why
  └── pr-url.txt                            #   Created PR URL
logs/activity/                              # Nightly orchestration logs
```
