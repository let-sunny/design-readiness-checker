# CanICode

A CLI tool that analyzes Figma design structures to provide development-friendliness and AI-friendliness scores and reports.

## Core Goal

**Help teams implement Figma designs exactly as designed, with zero unnecessary AI token cost.**

The design-tree format converts Figma data into a curated, CSS-ready representation that AI can implement directly. Early ablation experiments suggest design-tree produces higher pixel accuracy with significantly fewer tokens than raw Figma JSON. The key insight: **information curation > information abundance** — AI works better with focused, noise-free input.

See [Experiment Wiki](https://github.com/let-sunny/canicode/wiki) for detailed data and methodology.

## Target Environment

The primary target is **teams with designers** where developers (+AI) implement large Figma pages:
- **Page scale**: 300+ nodes, full screens, not small component sections
- **Component-heavy**: Design systems with reusable components, variants, tokens
- **AI context budget**: Large pages must fit in AI context windows — componentization reduces token count via deduplication
- **Not the target**: Individual developers generating simple UI with AI — they don't need Figma analysis

This means:
- Component-related rule scores (missing-component, etc.) should NOT be lowered based on small fixture calibration
- Token consumption is a first-class metric — designs that waste tokens on repeated structures are penalized
- Calibration fixtures must be large-scale (270+ nodes) — experiments showed small fixtures (50-100 nodes) produce misleading results
- `no-auto-layout` is the single highest-impact rule (score -10) — empirically validated via ablation experiments

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
│   ├── design-tree/          # Design tree generation, stripping, delta mapping
│   ├── engine/               # rule-engine, scoring, loader
│   ├── comparison/           # visual-compare, html-utils
│   ├── utils/                # fixture-helpers
│   ├── rules/                # Rule definitions + config
│   ├── contracts/            # Type definitions + Zod schemas
│   ├── adapters/             # Figma API integrations
│   ├── report-html/          # HTML report generation
│   └── monitoring/           # Telemetry
├── cli/                      # Entrypoint: CLI
├── mcp/                      # Entrypoint: MCP server
├── agents/                   # Internal: Calibration pipeline (deterministic)
└── experiments/              # Independent experiment scripts (API calls, manual run)
    └── ablation/             # Strip experiments, condition experiments

app/                          # Browser runtime
├── shared/                   # Common UI (gauge, issue list, styles, constants)
├── web/                      # Entrypoint: Web App (GitHub Pages)
│   ├── src/                  # Source
│   └── dist/                 # Build output (deployed)
├── figma-plugin/             # Entrypoint: Figma Plugin
│   ├── src/                  # Source
│   └── dist/                 # Build output (gitignored)

.claude/                      # Claude Code harness
├── docs/                     # Internal reference (read when working on related areas)
│   ├── ADR.md                # Architecture Decision Records (detailed version)
│   ├── ARCHITECTURE.md       # Channels, internal commands, file output structure
│   ├── DESIGN-TREE.md        # Design tree format spec, annotations, conversion examples
│   └── CALIBRATION.md        # Score calibration process, ablation experiments
├── skills/                   # Claude Code skills
├── agents/                   # Calibration subagents (standalone via claude -p)
└── commands/                 # Claude Code commands (calibrate-loop, calibrate-night)

scripts/                        # Orchestration scripts (run with tsx)
└── calibrate.ts              # Calibration pipeline orchestrator (ADR-008)
```

## Architecture Decision Records

Core decisions that shape every session. For full history see [GitHub Wiki Decision Log](https://github.com/let-sunny/canicode/wiki/Decision-Log).

- **ADR-001: design-tree > raw Figma JSON** — Use curated design-tree for AI/codegen inputs, never raw JSON. Ingestion pipelines transform raw JSON into design-tree. 94% vs 79% accuracy, 5x fewer tokens.
- **ADR-002: Ablation + visual-compare, not LLM self-report** — Measure rule impact by stripping + pixel comparison. LLM self-assessment is unreliable (self-attribution bias, weak counterfactual reasoning).
- **ADR-003: No custom rules** — Removed `--custom-rules` entirely. We provide the perfect set. Do not add extensibility points.
- **ADR-004: Score = gotcha burden prediction** — Score predicts how many gotchas a design needs. S-grade = none, D-grade = many. See [Round-Trip wiki](https://github.com/let-sunny/canicode/wiki/Round-Trip-Integration).
- **ADR-005: Platform standards cover web + app** — Rules accept CSS, Material Design, and UIKit interaction state names equally.
- **ADR-006: Large fixtures (270+) only for calibration** — Small fixtures produce misleading results. Never lower scores based on small fixture calibration.
- **ADR-007: npm publish is CI only** — Never manual. Tags trigger GitHub Actions. Local `npm publish` blocked by safety hooks.
- **ADR-008: Calibration pipeline — explicit claude -p orchestration** — TypeScript script calls CLI for deterministic steps, `claude -p` for judgment steps (converter, gap-analyzer, critic, arbitrator). Strip ablation runs 7 parallel sessions. Replaces delegated single-session orchestrator (#245).

## Key References

Detailed documentation lives in `.claude/docs/`. Read when working on related areas:

- **`.claude/docs/ADR.md`** — Detailed ADR with Decision/Why/Impact format (the section above is the summary)
- **`.claude/docs/ARCHITECTURE.md`** — 5 user-facing channels, internal calibration commands, file output structure
- **`.claude/docs/DESIGN-TREE.md`** — Design tree format spec, node annotations, Figma-to-CSS conversion examples
- **`.claude/docs/CALIBRATION.md`** — Score calibration process, strip ablation, experiment scripts, parallel execution

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

## Deployment

npm publishing is handled by GitHub CI — **do not run `npm publish` manually**.

1. Update version in `package.json`
2. Merge the approved PR to main (do not bypass the PR workflow)
3. Tag the merged commit on main: `git tag v0.x.x && git push origin v0.x.x`
4. GitHub Actions CI automatically publishes to npm on tag push

## Conventions

### Language

- All code, comments, documentation, and **GitHub Wiki** must be written in English
- This is a global project targeting international users

### Code Style

- Use ESM modules (`import`/`export`)
- Use `.js` extension for relative imports
- Use relative paths for imports (not `@/*` alias)

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

### PR Workflow

1. Always create PRs as **draft** first — wait for user approval before marking ready
2. When changes are needed, convert back to **draft** — mark ready again when done
3. After creating a PR, **subscribe** with `subscribe_pr_activity` to monitor reviews and CI in real-time
4. After each push, watch for CodeRabbit's first comment — if it contains a rate limit message, wait the specified duration then push an empty commit (`git commit --allow-empty -m "chore: re-trigger review"`) to re-trigger
5. Address review comments immediately as they arrive
6. Never merge without **explicit user approval** — always use squash merge and delete the branch after

## Severity Levels

Rules are classified into 4 severity levels:

- **blocking**: Cannot implement correctly without fixing. Direct impact on screen reproduction.
- **risk**: Implementable now but will break or increase cost later.
- **missing-info**: Information is absent, forcing developers to guess.
- **suggestion**: Not immediately problematic, but improves systemization.

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 2) — spacing grid unit for irregular-spacing
