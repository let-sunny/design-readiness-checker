# CanICode

A CLI tool that analyzes Figma design structures to provide development-friendliness and AI-friendliness scores and reports.

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

**2. MCP Server (`canicode-mcp`)**
- Install: `claude mcp add canicode -- npx -y -p canicode canicode-mcp`
- Tools: `analyze`, `list-rules`, `docs`
- Works with Figma MCP: user installs official Figma MCP → Claude Code orchestrates both
  - Figma MCP `get_metadata` → XML (structure) + `get_design_context` → code (styles)
  - canicode MCP `analyze(designData: XML, designContext: code)` — hybrid enrichment
  - No FIGMA_TOKEN needed when using Figma MCP
- Also works standalone with FIGMA_TOKEN (REST API fallback via `input` param)

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
- Input: fixture JSON path (e.g. `fixtures/material3-kit.json`)
- Flow: CLI analysis → Converter (reads fixture JSON directly) → CLI evaluation → Critic → Arbitrator
- No Figma MCP or API keys needed — works fully offline
- Auto-commits agreed score changes
- Used by `calibrate-night.sh` for automated nightly runs

**`/calibrate-loop-deep` (Claude Code command)**
- Role: Deep calibration using Figma MCP for precise design context
- Input: Figma URL (e.g. `https://www.figma.com/design/ABC123/MyDesign?node-id=1-234`)
- Flow: CLI analysis → Converter (Figma MCP `get_design_context`) → CLI evaluation → Critic → Arbitrator
- Used for high-fidelity validation against live Figma data

### File Output Structure

```
reports/            # HTML reports (canicode analyze)
logs/calibration/   # Calibration analysis results (internal)
logs/activity/      # Agent activity logs (internal)
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

Rule scores started as intuition-based estimates. The calibration pipeline validates them against actual code conversion difficulty.

Process:
1. Run analysis on real Figma files (`canicode calibrate-analyze`)
2. Convert flagged nodes to code via Claude Code subagent with Figma MCP (`get_design_context`)
3. Compare conversion difficulty vs rule scores (`canicode calibrate-evaluate`)
4. Propose adjustments: overscored rules get reduced, underscored rules get increased (Tuning Agent)
5. 4-agent debate loop (`/calibrate-loop`) applies conservative changes automatically

Final score adjustments in `rule-config.ts` are always reviewed by the developer via `CALIBRATION_REPORT.md` or the calibrate-loop's Arbitrator decisions.

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 4) — spacing grid unit for inconsistent-spacing and magic-number-spacing
- `tolerance` (default: 10) — color difference tolerance for multiple-fill-colors
- `no-dev-status` — disabled by default