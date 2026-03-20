# AIReady

A CLI tool that analyzes Figma design files and scores how development-friendly and AI-friendly they are.

> **Note:** This project was previously named `design-readiness-checker`. The GitHub repository is planned to be renamed from `let-sunny/design-readiness-checker` to `let-sunny/aiready`.

## Problem

Designers hand off Figma files. Developers open them and immediately start guessing — is this auto-layout or absolute? Are these colors from a token system or hardcoded hex values? Will this layout break on different screen sizes?

These questions slow down implementation, produce inconsistent code, and make AI-assisted code generation unreliable. The gap between "looks right in Figma" and "actually implementable" is real, but invisible until someone tries to write the code.

AIReady makes that gap measurable. It scans a Figma file's structure and produces a concrete score with specific, actionable issues — before any code is written.

## How It Works

### 39 Rules, 4 Severity Levels

Every node in the Figma tree is checked against 39 rules across 6 categories:

| Category | Rules | What it checks |
|----------|-------|----------------|
| Layout | 11 | Auto-layout usage, responsive behavior, nesting depth |
| Design Token | 7 | Color/font/shadow tokenization, spacing consistency |
| Component | 6 | Component reuse, detached instances, variant coverage |
| Naming | 5 | Semantic names, default names, naming conventions |
| AI Readability | 5 | Structure clarity, z-index reliance, empty frames |
| Handoff Risk | 5 | Hardcoded values, truncation handling, placeholder images |

Each issue is classified by severity:

- **Blocking** — Cannot implement correctly without fixing. Direct impact on screen reproduction.
- **Risk** — Implementable now, but will break or increase cost later.
- **Missing Info** — Information is absent, forcing developers to guess.
- **Suggestion** — Not immediately problematic, but improves systemization.

### Density-Based Scoring

The score is not a simple issue count. It uses a density + diversity algorithm:

```
Final Score = (Density Score × 0.7) + (Diversity Score × 0.3)

Density Score  = 100 - (weighted issue count / node count) × 100
Diversity Score = (1 - unique violated rules / total rules in category) × 100
```

Severity weights issues — a single blocking issue counts 3× more than a suggestion. Scores are calculated per category and combined into an overall grade (A/B/C/D/F).

### Scoped Analysis

Pass a Figma URL with a `node-id` parameter to analyze a specific frame or component instead of the entire file. Useful for focusing on a single screen or section.

## Installation

```bash
git clone https://github.com/let-sunny/aiready.git
cd aiready
pnpm install
pnpm build
```

Requires Node.js >= 18 and pnpm.

## Usage

```bash
# Auto-detect: tries MCP first, falls back to REST API
aiready analyze https://www.figma.com/design/ABC123/MyDesign

# Explicit MCP mode (no FIGMA_TOKEN needed, requires Claude Code with Figma MCP)
aiready analyze https://www.figma.com/design/ABC123/MyDesign --mcp

# Explicit REST API mode (requires FIGMA_TOKEN)
aiready analyze https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN

# Scoped to a specific node
aiready analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"

# From a JSON fixture
aiready analyze ./fixtures/design.json --output report.html

# With a preset
aiready analyze https://www.figma.com/design/ABC123/MyDesign --preset strict

# With screenshot comparison (coming soon, requires ANTHROPIC_API_KEY)
aiready analyze https://www.figma.com/design/ABC123/MyDesign --screenshot
```

Reports are saved to `reports/YYYY-MM-DD-HH-mm-<filekey>.html`.

### Data Source

| Flag | Source | Token required |
|------|--------|----------------|
| (none) | Auto-detect: MCP first, then REST API | FIGMA_TOKEN for fallback |
| `--mcp` | Figma MCP via Claude Code | None |
| `--api` | Figma REST API | FIGMA_TOKEN |

### Save Fixture

Save Figma file data as a JSON fixture for offline analysis:

```bash
aiready save-fixture https://www.figma.com/design/ABC123/MyDesign
aiready save-fixture https://www.figma.com/design/ABC123/MyDesign --mcp
aiready save-fixture https://www.figma.com/design/ABC123/MyDesign --api --token YOUR_TOKEN
```

### Presets

| Preset | Behavior |
|--------|----------|
| `relaxed` | Downgrades blocking to risk, reduces scores by 50% |
| `dev-friendly` | Focuses on layout and handoff rules only |
| `ai-ready` | Boosts structure and naming rule weights by 150% |
| `strict` | Enables all rules, increases all scores by 150% |

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FIGMA_TOKEN` | For Figma URLs | Figma personal access token |
| `ANTHROPIC_API_KEY` | For `--screenshot` | Anthropic API key for screenshot comparison |

## Distribution

### CLI

```bash
npm install -g aiready
aiready analyze https://www.figma.com/design/ABC123/MyDesign
```

### MCP Server

Add AIReady as an MCP server in Claude Code:

```bash
claude mcp add --transport stdio aiready npx aiready-mcp
```

Once added, Claude Code can use the `analyze` and `list-rules` tools to analyze Figma designs.

### Claude Skills

Copy the `.claude/skills/aiready/` directory from this repository into your project's `.claude/skills/` directory:

```bash
cp -r path/to/aiready/.claude/skills/aiready .claude/skills/
```

## Extensibility

### Custom Rules

Add new analysis rules via a JSON file. Each rule defines what to check, why it matters, and how to fix it.

```bash
aiready analyze ./fixtures/design.json --custom-rules ./my-rules.json
```

See [`examples/custom-rules.json`](examples/custom-rules.json) for the format.

### Config Overrides

Override built-in rule scores, severity levels, and global settings without modifying source code.

```bash
aiready analyze ./fixtures/design.json --config ./my-config.json
```

See [`examples/config.json`](examples/config.json) for the format.

Config options:
| Option | Description |
|--------|-------------|
| `gridBase` | Spacing grid unit (default: 8) |
| `colorTolerance` | Color difference tolerance (default: 10) |
| `excludeNodeTypes` | Node types to skip during analysis |
| `excludeNodeNames` | Node name patterns to skip |
| `rules.<id>.score` | Override rule score |
| `rules.<id>.severity` | Override rule severity |
| `rules.<id>.enabled` | Enable/disable a rule |

## Calibration (Internal)

Rule scores are validated against actual code conversion difficulty via a calibration pipeline. This runs inside Claude Code using the `/calibrate-loop` command — it is not exposed as a CLI command.

The pipeline uses 4 subagents:
1. **Runner** — Analyzes a fixture and extracts issue data
2. **Converter** — Converts flagged Figma nodes to code via Figma MCP
3. **Critic** — Reviews proposed score adjustments
4. **Arbitrator** — Makes final decisions and commits changes

## Tech Stack

| Layer | Tool |
|-------|------|
| Runtime | Node.js (>= 18) |
| Language | TypeScript (strict mode) |
| Package Manager | pnpm |
| Validation | Zod |
| Testing | Vitest |
| CLI | cac |
| Build | tsup |

## Roadmap

### Phase 1 — Core Analysis (done)

39 rules, density-based scoring, HTML reports, Figma API integration, presets, scoped analysis.

### Phase 2 — Calibration Pipeline (done)

4-agent calibration system, automated score tuning via Claude Code subagents with Figma MCP, `/calibrate-loop` autonomous debate loop.

### Phase 3 — Screenshot Comparison

`--screenshot` flag: Figma original screenshot next to AI-generated code rendered via Playwright, per node. Visual diff in the HTML report.

### Phase 4 — Ecosystem (in progress)

Plugin system for custom rules. MCP server for Claude Code integration. Claude Skills. Figma plugin for in-editor feedback. Integration with design system documentation tools.

## License

MIT
