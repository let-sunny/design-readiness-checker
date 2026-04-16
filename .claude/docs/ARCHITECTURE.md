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
- Tools: `analyze`, `list-rules`, `visual-compare`, `version`, `docs`
- Data source: Figma REST API via `input` param (Figma URL or fixture path). Requires FIGMA_TOKEN for live URLs.

**3. Claude Code Skill (`/canicode`)**
- Location: `.claude/skills/canicode/SKILL.md` (copy to any project)
- Uses CLI (`canicode analyze`) with FIGMA_TOKEN
- Lightweight alternative to MCP server — no canicode MCP installation needed

**4. Web App (GitHub Pages)**
- Source: `app/web/src/index.html`
- Build: `pnpm build:web` → `app/web/dist/` (deployed via GitHub Pages)
- Shared UI from `app/shared/` inlined at build time

**5. Figma Plugin**
- Source: `app/figma-plugin/src/`
- Build: `pnpm build:plugin` → `app/figma-plugin/dist/` (gitignored)
- Shared UI from `app/shared/` inlined at build time

## Internal (Claude Code Only)

Calibration is orchestrated by `scripts/calibrate.ts` (ADR-008). CLI for deterministic steps, `claude -p` for judgment steps.

**`scripts/calibrate.ts` (orchestration script)**
- Role: Explicit step-by-step calibration pipeline
- Input: fixture directory path (e.g. `fixtures/material3-kit`), or `--resume <run-dir>`
- Flow: Analyze → Design Tree → Strip → Convert (7 parallel `claude -p` sessions) → Measure → Gap Analyze → Evaluate → Critic → Arbitrator → Evidence
- Each step tracked in `index.json` for resume-from-failure
- Converter runs 7 parallel sessions: 1 baseline + 6 strip ablation types
- **Strip ablation**: Measures 6 stripped design-trees (`DESIGN_TREE_INFO_TYPES` in `src/core/design-tree/strip.ts`: layout-direction-spacing, size-constraints, component-references, node-names-hierarchy, variable-references, style-references) → similarity delta vs baseline (plus tokens/HTML/CSS/responsive) → objective difficulty per rule category
- Cross-run evidence: Evaluation appends overscored/underscored findings to `data/calibration-evidence.json`
- After Arbitrator applies changes, evidence for applied rules is pruned (`calibrate-prune-evidence`)
- Each run creates a self-contained directory: `logs/calibration/<fixture>--<timestamp>/`

**`canicode calibrate-save-fixture`**
- Role: Save Figma design as a fixture directory for calibration (internal command)
- Input: Figma URL with node-id
- Output: fixture directory with data.json, screenshot.png, vectors/, images/

**`canicode calibrate-implement`**
- Role: Prepare design-to-code package for calibration (analysis + design tree + assets + prompt)
- Input: Figma URL or fixture directory
- Output: canicode-implement/ directory with analysis.json, design-tree.txt, PROMPT.md, assets

**`/calibrate` (Claude Code command)**
- Wrapper: runs `npx tsx scripts/calibrate.ts $ARGUMENTS` and reports results
- Modes: `<fixture-path>` (single), `--all` (all active fixtures), `--resume <run-dir>`
- `--all` mode: discovers active fixtures, runs sequentially, checks convergence via `fixture-done`, runs regression check, generates aggregate report

**`scripts/develop.ts` (development pipeline)**
- Role: Automated feature development — reads a GitHub issue, plans, implements, tests, reviews, and creates a draft PR
- Input: GitHub issue number (e.g. `247`), or `--resume <run-dir>`
- Flow: Plan (agent) → Implement (agent) → Test (cli, retry loop) → Review (agent) → Fix (agent) → Verify (cli) → PR (cli)
- State tracked in `logs/develop/<issue>--<timestamp>/index.json`
- Test/Verify steps have internal fix retry loops (max 3 retries with fix agent)
- JSON handoff chain: `plan.json` (designDecisions) → `implement-log.json` (decisions, knownRisks) → `review.json` (implementIntent, intentConflict) → `fix-log.json` (resolution, skipped reasons)
- Each `claude -p` agent receives previous step JSONs so it understands "why", not just "what"
- See: issue #247

**`/review-run` (Claude Code command)**
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
