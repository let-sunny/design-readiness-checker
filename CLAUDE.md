# Design Readiness Checker

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
├── contracts/      # Type definitions and Zod schemas
├── cli/            # CLI entry point
├── report-html/    # HTML report generation
└── adapters/       # External service integrations (Figma API, etc.)
```

## Commands

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

Current rule scores are intuition-based and require validation.

Planned calibration process:
1. Connect Figma MCP + Claude after MVP completion
2. Run analysis on real Figma files
3. Claude attempts to convert nodes to actual CSS/components
4. Collect mismatch cases:
   - Conversion failed or required guessing → increase rule score
   - Conversion was easy but got penalized → decrease rule score
5. Repeat until scores reflect actual implementation difficulty

Long-term: Automate calibration using a multi-agent architecture.

```
Orchestrator Agent
├── Analysis Agent     → runs design-readiness-checker, outputs scores
├── Conversion Agent   → reads nodes via Figma MCP, attempts CSS/component conversion
├── Evaluation Agent   → measures conversion difficulty, detects score mismatches
└── Tuning Agent       → proposes rule-config.ts adjustments as a PR
```

Final score adjustments are reviewed and merged by the developer.

## Adjustable Rule Config

All rule scores, severity, and thresholds are managed in `rules/rule-config.ts`.
Rule logic and score config are intentionally separated so scores can be tuned without touching rule logic.

Configurable thresholds:
- `gridBase` (default: 8) — spacing grid unit for inconsistent-spacing and magic-number-spacing
- `tolerance` (default: 10) — color difference tolerance for multiple-fill-colors
- `no-dev-status` — disabled by default