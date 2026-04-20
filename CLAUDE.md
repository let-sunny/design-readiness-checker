# CanICode

A CLI tool that analyzes Figma design structures to provide development-friendliness and AI-friendliness scores and reports.

## Core Goal

**Make the Figma file information-complete so `figma-implement-design` produces accurate code with fewer gotchas.**

canicode's role is upstream of code generation: diagnose where design information is missing (`analyze`), elicit the missing answers from the user (`gotcha-survey`), and write those answers back into the Figma design (`canicode-roundtrip`). Once the design re-analyzes clean, the downstream code-generation step runs in Figma's official `figma-implement-design` skill — canicode does not own that step (see ADR-013 for the scope boundary).

The design-tree format used internally by analysis is a curated, CSS-ready representation; ablation experiments use it as a controlled measurement input. The framing **information curation > information abundance** still drives rule design — fewer information gaps in the source design means cleaner downstream code.

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
│   ├── gotcha/               # Gotcha survey question generation, instance-context resolution
│   ├── roundtrip/            # Apply gotcha answers to Figma (Plugin API helpers, annotation upsert)
│   ├── report-html/          # HTML report generation
│   ├── monitoring/           # Telemetry
│   └── ui-helpers.ts / ui-constants.ts   # UI helpers shared with app/
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
│   ├── canicode/             #   CLI wrapper skill
│   ├── canicode-gotchas/     #   Standalone gotcha survey
│   └── canicode-roundtrip/   #   Analyze → gotcha → apply to Figma orchestration
├── agents/                   # Subagents invoked standalone via claude -p
│   ├── calibration/          #   converter, gap-analyzer, critic, arbitrator, runner
│   └── develop/              #   planner, implementer, reviewer, fixer
└── commands/                 # Claude Code commands (calibrate, develop, review-run)

scripts/                      # Orchestration + automation scripts
├── calibrate.ts              # Calibration pipeline orchestrator (ADR-008, single + --all mode)
├── develop.ts                # Development pipeline orchestrator (#247)
├── develop-heartbeat.sh      # PostToolUse hook — heartbeat lines for develop.ts timeout recovery
├── sync-rule-docs.ts         # Auto-generate rule tables in docs/CUSTOMIZATION.md + Wiki Rule-Reference
├── build-web.sh              # Build app/web/ for GitHub Pages
└── build-plugin.sh           # Build app/figma-plugin/
```

## Architecture Decision Records

See `.claude/docs/ADR.md` for all architecture decisions. Read before making any architecture choices. For full history see [GitHub Wiki Decision Log](https://github.com/let-sunny/canicode/wiki/Decision-Log).

## Key References

Detailed documentation lives in `.claude/docs/`. Read when working on related areas:

- **`.claude/docs/ADR.md`** — Architecture Decision Records with Decision/Why/Impact format
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
4. Address review comments immediately as they arrive
5. Never merge without **explicit user approval** — always use squash merge and delete the branch after

## Severity Levels

Rules are classified into 4 severity levels:

- **blocking**: Cannot implement correctly without fixing. Direct impact on screen reproduction.
- **risk**: Implementable now but will break or increase cost later.
- **missing-info**: Information is absent, forcing developers to guess.
- **suggestion**: Not immediately problematic, but improves systemization.

Severity labels describe user impact, while rule purpose may differ (ADR-017): rules perform rule-based best-practice detection, and gotcha is annotation output from that detection pass. Violation rules remain score-primary best-practice checks; info-collection rules are annotation-primary checks for context Figma cannot encode. In practice, info-collection rules should usually stay in low-penalty ranges (commonly `missing-info` or `suggestion` severity, depending on implementation risk).

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 2) — spacing grid unit for irregular-spacing
