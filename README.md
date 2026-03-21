# AIReady

Analyze Figma designs. Score how dev-friendly and AI-friendly they are. Get actionable issues before writing code.

```bash
npm install -g aiready
aiready init --token YOUR_FIGMA_TOKEN
aiready analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

> Run `aiready docs setup` for the full setup guide — CLI, MCP Server, Claude Skills, and all options.

---

## How It Works

39 rules across 6 categories check every node in the Figma tree:

| Category | Rules | What it checks |
|----------|-------|----------------|
| Layout | 11 | Auto-layout usage, responsive behavior, nesting depth |
| Design Token | 7 | Color/font/shadow tokenization, spacing consistency |
| Component | 6 | Component reuse, detached instances, variant coverage |
| Naming | 5 | Semantic names, default names, naming conventions |
| AI Readability | 5 | Structure clarity, z-index reliance, empty frames |
| Handoff Risk | 5 | Hardcoded values, truncation handling, placeholder images |

Each issue is classified: **Blocking** > **Risk** > **Missing Info** > **Suggestion**.

Scores use density + diversity weighting per category, combined into an overall grade (A/B/C/D/F).

---

## Getting Started

Three ways to use AIReady. Pick one.

### CLI (standalone)

```bash
npx fig-aiready analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"

# Or install globally
npm install -g fig-aiready
aiready analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

### MCP Server (Claude Code / Cursor / Claude Desktop)

**Claude Code:**
```bash
claude mcp add aiready -- npx -y fig-aiready aiready-mcp
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "aiready": {
      "command": "npx",
      "args": ["-y", "fig-aiready", "aiready-mcp"]
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "aiready": {
      "command": "npx",
      "args": ["-y", "fig-aiready", "aiready-mcp"]
    }
  }
}
```

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

---

<details>
<summary><strong>Data Sources</strong></summary>

| Flag | Source | Token required |
|------|--------|----------------|
| (none) | Auto-detect: MCP first, then REST API | For API fallback |
| `--mcp` | Figma MCP via Claude Code | None |
| `--api` | Figma REST API | Yes |

Token priority:
1. `--token` flag (one-time override)
2. `FIGMA_TOKEN` env var (CI/CD)
3. `~/.aiready/config.json` (`aiready init`)

</details>

<details>
<summary><strong>Presets</strong></summary>

| Preset | Behavior |
|--------|----------|
| `relaxed` | Downgrades blocking to risk, reduces scores by 50% |
| `dev-friendly` | Focuses on layout and handoff rules only |
| `ai-ready` | Boosts structure and naming rule weights by 150% |
| `strict` | Enables all rules, increases all scores by 150% |

```bash
aiready analyze <url> --preset strict
```

</details>

<details>
<summary><strong>Custom Rules</strong></summary>

Add project-specific checks via a JSON file:

```bash
aiready analyze <url> --custom-rules ./my-rules.json
```

```json
[
  {
    "id": "icon-missing-component",
    "category": "component",
    "severity": "blocking",
    "score": -10,
    "prompt": "Check if this node is an icon and is not a component.",
    "why": "Icons that are not components cannot be reused.",
    "impact": "Developers will hardcode icons.",
    "fix": "Convert to a component and publish to the library."
  }
]
```

See [`examples/custom-rules.json`](examples/custom-rules.json) | Run `aiready docs rules`

</details>

<details>
<summary><strong>Config Overrides</strong></summary>

Override built-in rule scores, severity, and global settings:

```bash
aiready analyze <url> --config ./my-config.json
```

```json
{
  "gridBase": 4,
  "colorTolerance": 5,
  "rules": {
    "no-auto-layout": { "score": -15, "severity": "blocking" },
    "default-name": { "enabled": false }
  }
}
```

| Option | Description |
|--------|-------------|
| `gridBase` | Spacing grid unit (default: 8) |
| `colorTolerance` | Color difference tolerance (default: 10) |
| `excludeNodeTypes` | Node types to skip |
| `excludeNodeNames` | Node name patterns to skip |
| `rules.<id>.score` | Override rule score |
| `rules.<id>.severity` | Override rule severity |
| `rules.<id>.enabled` | Enable/disable a rule |

See [`examples/config.json`](examples/config.json) | Run `aiready docs config`

</details>

<details>
<summary><strong>Scoring Algorithm</strong></summary>

```
Final Score = (Density Score × 0.7) + (Diversity Score × 0.3)

Density Score  = 100 - (weighted issue count / node count) × 100
Diversity Score = (1 - unique violated rules / total rules in category) × 100
```

Severity weights issues — a single blocking issue counts 3x more than a suggestion. Scores are calculated per category and combined into an overall grade (A/B/C/D/F).

</details>

<details>
<summary><strong>MCP Server Details</strong></summary>

The `aiready-mcp` server exposes two tools: `analyze` and `list-rules`.

**Route A — Figma MCP relay (no token):**

```
Claude Code → Figma MCP get_metadata → XML node tree
Claude Code → aiready MCP analyze(designData: XML) → result
```

**Route B — REST API direct (token):**

```
Claude Code → aiready MCP analyze(input: URL) → internal fetch → result
```

Route A requires two MCP servers (figma + aiready). Route B requires one + a saved token.

The `analyze` tool accepts `designData` (XML/JSON from Figma MCP) or `input` (Figma URL / fixture path). When both are provided, `designData` takes priority.

</details>

<details>
<summary><strong>Save Fixture</strong></summary>

Save Figma file data as JSON for offline analysis:

```bash
aiready save-fixture https://www.figma.com/design/ABC123/MyDesign
aiready save-fixture https://www.figma.com/design/ABC123/MyDesign --mcp
```

</details>

---

<details>
<summary><strong>Tech Stack</strong></summary>

| Layer | Tool |
|-------|------|
| Runtime | Node.js (>= 18) |
| Language | TypeScript (strict mode) |
| Package Manager | pnpm |
| Validation | Zod |
| Testing | Vitest |
| CLI | cac |
| Build | tsup |

</details>

<details>
<summary><strong>Calibration (Internal)</strong></summary>

Rule scores are validated against actual code conversion difficulty via a calibration pipeline. This runs inside Claude Code using `/calibrate-loop` — not exposed as a CLI command.

The pipeline uses 4 subagents:
1. **Runner** — Analyzes a fixture and extracts issue data
2. **Converter** — Converts flagged Figma nodes to code via Figma MCP
3. **Critic** — Reviews proposed score adjustments
4. **Arbitrator** — Makes final decisions and commits changes

</details>

<details>
<summary><strong>Development</strong></summary>

```bash
git clone https://github.com/let-sunny/aiready.git
cd aiready
pnpm install
pnpm build
```

```bash
pnpm dev        # watch mode
pnpm test       # run tests
pnpm lint       # type check
```

</details>

## Roadmap

- [x] **Phase 1** — 39 rules, density-based scoring, HTML reports, presets, scoped analysis
- [x] **Phase 2** — 4-agent calibration pipeline, `/calibrate-loop` debate loop
- [x] **Phase 3** — Custom rules, config overrides, MCP server, Claude Skills
- [ ] **Phase 4** — Figma comment integration (`--comment`: post blocking issues as comments on Figma nodes)
- [ ] **Phase 5** — Screenshot comparison (Figma vs AI-generated code, visual diff)

## License

MIT
