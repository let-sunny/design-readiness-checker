# AIReady

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
src/
├── core/           # Analysis engine and core logic
├── rules/          # Analysis rule definitions
│   └── custom/     # Custom rule loading and config override
├── contracts/      # Type definitions and Zod schemas
├── cli/            # CLI entry point
├── mcp/            # MCP server for Claude Code integration
├── report-html/    # HTML report generation
├── adapters/       # External service integrations (Figma API, etc.)
└── agents/         # Calibration pipeline
```

## Architecture

### External (User-Facing)

**`aiready analyze`**
- Role: Analyze Figma file structure + generate HTML report
- Input: Figma URL or JSON fixture
- Output: HTML report in `reports/`
- Options:
  - `--preset`: relaxed | dev-friendly | ai-ready | strict
  - `--mcp`: load via MCP Desktop bridge (no REST API needed)
  - `--screenshot`: include screenshot comparison (requires ANTHROPIC_API_KEY, coming soon)
  - `--token`: Figma API token
  - `--output`: custom report path
  - `--custom-rules`: path to custom rules JSON file
  - `--config`: path to config JSON override file
- Each issue includes a Figma deep link (click -> navigate to node in Figma)

**`aiready-mcp`**
- Role: MCP server exposing analyze as a tool
- Install: `claude mcp add --transport stdio aiready npx aiready-mcp`
- Tools: `analyze`, `list-rules`

**`aiready save-fixture`**
- Role: Save Figma file data as JSON fixture for offline analysis
- Input: Figma URL
- Output: JSON file in `fixtures/`

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
reports/            # HTML reports (aiready analyze)
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
1. Run analysis on real Figma files (`aiready calibrate-analyze`)
2. Convert flagged nodes to code via Claude Code subagent with Figma MCP (`get_design_context`)
3. Compare conversion difficulty vs rule scores (`aiready calibrate-evaluate`)
4. Propose adjustments: overscored rules get reduced, underscored rules get increased (Tuning Agent)
5. 4-agent debate loop (`/calibrate-loop`) applies conservative changes automatically

Final score adjustments in `rule-config.ts` are always reviewed by the developer via `CALIBRATION_REPORT.md` or the calibrate-loop's Arbitrator decisions.

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 8) — spacing grid unit for inconsistent-spacing and magic-number-spacing
- `tolerance` (default: 10) — color difference tolerance for multiple-fill-colors
- `no-dev-status` — disabled by default