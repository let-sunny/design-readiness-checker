# CanICode

A CLI tool that analyzes Figma design structures to provide development-friendliness and AI-friendliness scores and reports.

## Core Goal

**Can AI implement this Figma design pixel-perfectly?** Everything in this project serves this single question. Every rule, score, category, and pipeline exists to measure and improve how accurately AI can reproduce a Figma design as code. The metric is `visual-compare` similarity (0-100%).

## Target Environment

The primary target is **teams with designers** where developers (+AI) implement large Figma pages:
- **Page scale**: 300+ nodes, full screens, not small component sections
- **Component-heavy**: Design systems with reusable components, variants, tokens
- **AI context budget**: Large pages must fit in AI context windows — componentization reduces token count via deduplication
- **Not the target**: Individual developers generating simple UI with AI — they don't need Figma analysis

This means:
- Component-related rule scores (missing-component, etc.) should NOT be lowered based on small fixture calibration
- Token consumption is a first-class metric — designs that waste tokens on repeated structures are penalized
- Calibration fixtures should include large, complex pages alongside small sections

## Tech Stack

- **Runtime**: Node.js (>=18)
- **Language**: TypeScript (strict mode)
- **Package Manager**: pnpm
- **Validation**: zod
- **Testing**: vitest
- **CLI**: cac
- **Build**: tsup

## Project Structure

```
src/                          # Node.js runtime (tsup build)
├── core/                     # Shared analysis engine
│   ├── engine/               # rule-engine, scoring, loader, config-store
│   ├── rules/                # Rule definitions + config
│   ├── contracts/            # Type definitions + Zod schemas
│   ├── adapters/             # Figma API integrations
│   ├── report-html/          # HTML report generation
│   └── monitoring/           # Telemetry
├── cli/                      # Entrypoint: CLI
├── mcp/                      # Entrypoint: MCP server
└── agents/                   # Internal: Calibration pipeline

app/                          # Browser runtime
├── shared/                   # Common UI (gauge, issue list, styles, constants)
├── web/                      # Entrypoint: Web App (GitHub Pages)
│   ├── src/                  # Source
│   └── dist/                 # Build output (deployed)
├── figma-plugin/             # Entrypoint: Figma Plugin
│   ├── src/                  # Source
│   └── dist/                 # Build output (gitignored)

.claude/skills/canicode/      # Entrypoint: Claude Code skill
```

## Architecture

### External (5 User-Facing Channels)

**1. CLI (`canicode analyze`)**
- Data source: Figma REST API (requires FIGMA_TOKEN) or JSON fixture
- Output: HTML report (opens in browser)
- Options: `--preset`, `--token`, `--output`, `--custom-rules`, `--config`
- Also: `canicode save-fixture` to save Figma data as JSON for offline analysis
- Component master resolution: fetches `componentDefinitions` for accurate component analysis
- Annotations: NOT available (REST API annotations field is private beta)

**2. MCP Server (`canicode-mcp`)**
- Install: `claude mcp add canicode -- npx -y -p canicode canicode-mcp`
- Tools: `analyze`, `list-rules`, `visual-compare`, `version`, `docs`
- Works with Figma MCP: user installs official Figma MCP → Claude Code orchestrates both
  - Figma MCP `get_metadata` → XML (structure) + `get_design_context` → code (styles)
  - canicode MCP `analyze(designData: XML, designContext: code)` — hybrid enrichment
  - No FIGMA_TOKEN needed when using Figma MCP
- Also works standalone with FIGMA_TOKEN (REST API fallback via `input` param)

**CLI vs MCP Feature Comparison**

| Feature | CLI (REST API) | MCP (Figma MCP) |
|---------|:-:|:-:|
| Node structure | ✅ Full tree | ✅ XML metadata |
| Style values | ✅ Raw Figma JSON | ✅ React+Tailwind code |
| Component metadata (name, desc) | ✅ | ❌ |
| Component master trees | ✅ `componentDefinitions` | ❌ |
| Annotations (dev mode) | ❌ private beta | ✅ `data-annotations` |
| Screenshots | ✅ via API | ✅ `get_screenshot` |
| FIGMA_TOKEN required | ✅ | ❌ |

**When to use which:**
- Accurate component analysis (style overrides, missing-component) → **CLI with FIGMA_TOKEN**
- Quick structure/style check, annotation-aware workflows → **MCP**
- Offline/CI analysis → **CLI with saved fixtures**

**3. Claude Code Skill (`/canicode`)**
- Location: `.claude/skills/canicode/SKILL.md` (copy to any project)
- Requires: Official Figma MCP (`https://mcp.figma.com/mcp`) at project level
- Flow: Figma MCP `get_metadata` (structure) + `get_design_context` (styles) → enriched fixture JSON → `canicode analyze`
- Lightweight alternative to MCP server — no canicode MCP installation needed

**4. Web App (GitHub Pages)**
- Source: `app/web/src/index.html`
- Build: `pnpm build:web` → `app/web/dist/` (deployed via GitHub Pages)
- Shared UI from `app/shared/` inlined at build time

**5. Figma Plugin**
- Source: `app/figma-plugin/src/`
- Build: `pnpm build:plugin` → `app/figma-plugin/dist/` (gitignored)
- Shared UI from `app/shared/` inlined at build time

### Internal (Claude Code Only)

Calibration commands are NOT exposed as CLI commands. They run exclusively inside Claude Code via subagents.

**`/calibrate-loop` (Claude Code command)**
- Role: Autonomous rule-config.ts improvement via fixture-based calibration
- Input: fixture directory path (e.g. `fixtures/material3-kit`)
- Flow: Analysis → Converter (entire design → HTML + visual-compare) → Gap Analyzer → Evaluation → Critic → Arbitrator → Prune Evidence
- Converter implements the full scoped design as one HTML page, runs `visual-compare` for pixel-level similarity
- Gap Analyzer examines the diff image, categorizes pixel differences, saves to run directory
- Cross-run evidence: Evaluation appends overscored/underscored findings to `data/calibration-evidence.json`; Gap Analyzer appends uncovered gaps to `data/discovery-evidence.json` (environment/tooling noise is auto-filtered)
- After Arbitrator applies changes, evidence for applied rules is pruned (`calibrate-prune-evidence`)
- Each run creates a self-contained directory: `logs/calibration/<fixture>--<timestamp>/`
- No Figma MCP or API keys needed — works fully offline
- Auto-commits agreed score changes

**`/calibrate-loop-deep` (Claude Code command)**
- Role: Deep calibration using Figma MCP for precise design context
- Input: Figma URL (e.g. `https://www.figma.com/design/ABC123/MyDesign?node-id=1-234`)
- Flow: Same as `/calibrate-loop` but Converter uses Figma MCP `get_design_context` for richer style data

**`/calibrate-night` (Claude Code command)**
- Role: Run calibration on multiple fixtures sequentially, then generate aggregate report
- Input: fixture directory path (e.g. `fixtures/my-designs`) — auto-discovers active fixtures
- Flow: `fixture-list` → sequential `/calibrate-loop` per fixture → `fixture-done` (converged) → `calibrate-gap-report` → `logs/calibration/REPORT.md`

**`/add-rule` (Claude Code command)**
- Role: Research, design, implement, and evaluate new analysis rules
- Input: concept + fixture path (e.g. `"component description" fixtures/material3-kit`)
- Flow: Researcher → Designer → Implementer → A/B Visual Validation → Evaluator → Critic
- Researcher reads accumulated discovery evidence from `data/discovery-evidence.json` to find recurring patterns
- After KEEP/ADJUST, discovery evidence for the rule's category is pruned (`discovery-prune-evidence`)
- Each run creates a directory: `logs/rule-discovery/<concept>--<date>/`
- A/B Validation: implements entire design with/without the rule's data, compares similarity
- Critic decides KEEP / ADJUST / DROP

### File Output Structure

```
data/calibration-evidence.json              # Cross-run calibration evidence (overscored/underscored rules)
data/discovery-evidence.json                # Cross-run discovery evidence (uncovered gaps for /add-rule)
reports/                                    # HTML reports (canicode analyze)
logs/calibration/                           # Calibration runs (internal)
logs/calibration/<name>--<timestamp>/       # One calibration run = one folder
  ├── analysis.json                         #   Rule analysis result
  ├── conversion.json                       #   HTML conversion + similarity
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
logs/rule-discovery/                        # Rule discovery runs (internal)
logs/rule-discovery/<concept>--<date>/      # One rule discovery = one folder
logs/activity/                              # Nightly orchestration logs
```

## Analysis Scope Policy

- Analysis unit: section or page level (`node-id` required in URL)
- Full-file analysis is discouraged — too many nodes, noisy results
- If no `node-id` is provided, CLI prints a warning
- Recommended scope: one screen or a related component group

## Dev Commands

```bash
pnpm build          # Production build
pnpm dev            # Development mode (watch)
pnpm test           # Run tests (watch)
pnpm test:run       # Run tests (single run)
pnpm lint           # Type check
```

## Conventions

### Language

- All code, comments, and documentation must be written in English
- This is a global project targeting international users

### Code Style

- Use ESM modules (`import`/`export`)
- Use `.js` extension for relative imports
- Use `@/*` path alias to reference `src/`

### TypeScript

- strict mode enabled
- `noUncheckedIndexedAccess` enabled - must check for undefined when accessing arrays/objects
- `exactOptionalPropertyTypes` enabled - no explicit undefined assignment to optional properties

### Zod

- Validate all external inputs with Zod schemas
- Schema definitions go in `contracts/` directory
- Infer TypeScript types from schemas: `z.infer<typeof Schema>`

### Testing

- Test files are co-located with source files as `*.test.ts`
- describe/it/expect are globally available (vitest globals)

### Naming

- Files: kebab-case (`my-component.ts`)
- Types/Interfaces: PascalCase (`MyInterface`)
- Functions/Variables: camelCase (`myFunction`)
- Constants: SCREAMING_SNAKE_CASE (`MY_CONSTANT`)

### Git

- Commit messages: conventional commits (feat, fix, docs, refactor, test, chore)

## Severity Levels

Rules are classified into 4 severity levels:

- **blocking**: Cannot implement correctly without fixing. Direct impact on screen reproduction.
- **risk**: Implementable now but will break or increase cost later.
- **missing-info**: Information is absent, forcing developers to guess.
- **suggestion**: Not immediately problematic, but improves systemization.

## Score Calibration

Rule scores started as intuition-based estimates. The calibration pipeline validates them against actual code conversion difficulty measured by pixel-level visual comparison.

Process:
1. Run analysis on real Figma files (`canicode calibrate-analyze`)
2. Implement the entire scoped design as one HTML page (`Converter`)
3. Run `canicode visual-compare` — pixel-level comparison against Figma screenshot
4. Analyze the diff image to categorize pixel gaps (`Gap Analyzer`)
5. Compare conversion difficulty vs rule scores (`canicode calibrate-evaluate`)
6. 6-agent debate loop (`/calibrate-loop`): Analysis → Converter → Gap Analyzer → Evaluation → Critic → Arbitrator

**Cross-run evidence** accumulates across sessions in `data/`:
- `calibration-evidence.json` — overscored/underscored rules (fed to Runner for stronger proposals)
- `discovery-evidence.json` — uncovered gaps not covered by existing rules (fed to `/add-rule` Researcher)
- Discovery evidence is filtered to exclude environment/tooling noise (font CDN, retina/DPI, network, CI constraints)
- Evidence is pruned after rules are applied (calibration) or new rules are created (discovery)

Final score adjustments in `rule-config.ts` are always reviewed by the developer via the Arbitrator's decisions.

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 4) — spacing grid unit for inconsistent-spacing and magic-number-spacing
- `tolerance` (default: 10) — color difference tolerance for multiple-fill-colors
- `no-dev-status` — disabled by default