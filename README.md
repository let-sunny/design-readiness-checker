<p align="center">
  <img src="docs/logo.png" alt="CanICode" width="80">
</p>

<h1 align="center">CanICode</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/canicode"><img src="https://img.shields.io/npm/v/canicode.svg" alt="npm version"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/ci.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/release.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://let-sunny.github.io/canicode/"><img src="https://img.shields.io/badge/Try_it-GitHub_Pages-blue" alt="GitHub Pages"></a>
</p>

<p align="center">Analyze Figma designs. Score how dev-friendly and AI-friendly they are. Get actionable issues before writing code.</p>

<p align="center"><strong><a href="https://let-sunny.github.io/canicode/">Try it in your browser</a></strong> — no install needed.</p>

<p align="center">
  <img src="docs/screenshot.png" alt="CanICode Report" width="720">
</p>

```bash
npm install -g canicode
canicode init --token YOUR_FIGMA_TOKEN
canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

> Run `canicode docs setup` for the full setup guide — CLI, MCP Server, Claude Skills, and all options.

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

Scores use density + diversity weighting per category, combined into an overall grade (S/A+/A/B+/B/C+/C/D/F). Rule scores are calibrated against actual code conversion difficulty — see [Calibration](docs/CALIBRATION.md) for how scores are validated.

---

## Everything is Configurable

| What | How | Example |
|------|-----|---------|
| **Presets** | Built-in score profiles | `canicode analyze <url> --preset strict` |
| **Config overrides** | Adjust scores, severity, exclude nodes | `canicode analyze <url> --config ./config.json` |
| **Custom rules** | Add your own checks with pattern matching | `canicode analyze <url> --custom-rules ./rules.json` |
| **Combine** | Use all together | `canicode analyze <url> --preset ai-ready --config ./config.json --custom-rules ./rules.json` |

| Preset | What it does |
|--------|-------------|
| `relaxed` | Downgrades blocking → risk, scores −50% |
| `dev-friendly` | Layout and handoff rules only |
| `ai-ready` | Structure and naming weights +150% |
| `strict` | All rules enabled, scores +150% |

> **Custom rules tip:** Ask any LLM *"Write a canicode custom rule that checks X"* — it can generate the JSON for you. See [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md) for the full guide.

---

## Getting Started

Four ways to use CanICode. Pick one.

### Web (no install)

Go to **[let-sunny.github.io/canicode](https://let-sunny.github.io/canicode/)**, paste a Figma URL, and get results instantly in your browser.

### CLI (standalone)

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"

# Or install globally
npm install -g canicode
canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

To enable "Comment on Figma" buttons in reports, set your Figma token:
```bash
canicode init --token figd_xxxxxxxxxxxxx
```

> **Get your token:** Figma → Settings → Security → Personal access tokens → Generate new token

### MCP Server (Claude Code / Cursor / Claude Desktop)

**Claude Code:**
```bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y canicode canicode-mcp
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "canicode": {
      "command": "npx",
      "args": ["-y", "canicode", "canicode-mcp"],
      "env": {
        "FIGMA_TOKEN": "figd_xxxxxxxxxxxxx"
      }
    }
  }
}
```

**Claude Desktop** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "canicode": {
      "command": "npx",
      "args": ["-y", "canicode", "canicode-mcp"],
      "env": {
        "FIGMA_TOKEN": "figd_xxxxxxxxxxxxx"
      }
    }
  }
}
```

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

> With `FIGMA_TOKEN` set, the HTML report includes "Comment on Figma" buttons that post analysis findings directly to Figma nodes.

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
3. `~/.canicode/config.json` (`canicode init`)

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
canicode analyze <url> --preset strict
```

</details>


<details>
<summary><strong>Config Overrides</strong></summary>

Override rule scores, severity, node exclusions, and global settings:

```bash
canicode analyze <url> --config ./my-config.json
```

```json
{
  "excludeNodeNames": ["chatbot", "ad-banner", "wip"],
  "gridBase": 4,
  "rules": {
    "no-auto-layout": { "score": -15, "severity": "blocking" },
    "default-name": { "enabled": false }
  }
}
```

| Option | Description |
|--------|-------------|
| `gridBase` | Spacing grid unit (default: 4) |
| `colorTolerance` | Color difference tolerance (default: 10) |
| `excludeNodeTypes` | Node types to skip |
| `excludeNodeNames` | Node name patterns to skip |
| `rules.<id>.score` | Override rule score |
| `rules.<id>.severity` | Override rule severity |
| `rules.<id>.enabled` | Enable/disable a rule |

See [`examples/config.json`](examples/config.json) | [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md) | Run `canicode docs config`

</details>

<details>
<summary><strong>Custom Rules</strong></summary>

Add project-specific checks with declarative pattern matching:

```bash
canicode analyze <url> --custom-rules ./my-rules.json
```

```json
[
  {
    "id": "icon-not-component",
    "category": "component",
    "severity": "blocking",
    "score": -10,
    "match": {
      "type": ["FRAME", "GROUP"],
      "maxWidth": 48,
      "maxHeight": 48,
      "hasChildren": true,
      "nameContains": "icon"
    },
    "message": "\"{name}\" is an icon but not a component",
    "why": "Icons that are not components cannot be reused consistently.",
    "impact": "Developers will hardcode icon SVGs instead of using a shared component.",
    "fix": "Convert this icon to a component and publish it to the design system library."
  }
]
```

Conditions use AND logic — all must match for the rule to fire. Available conditions: `type`, `notType`, `nameContains`, `nameNotContains`, `namePattern`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `hasAutoLayout`, `hasChildren`, `minChildren`, `maxChildren`, `isComponent`, `isInstance`, `hasComponentId`, `isVisible`, `hasFills`, `hasStrokes`, `hasEffects`, `minDepth`, `maxDepth`.

Combine with config overrides:
```bash
canicode analyze <url> --config ./config.json --custom-rules ./rules.json
```

> **Tip:** Ask any LLM *"Write a canicode custom rule that checks X"* with the conditions above — it can generate the JSON for you.

See [`examples/custom-rules.json`](examples/custom-rules.json) | [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md)

</details>

<details>
<summary><strong>Scoring Algorithm</strong></summary>

```
Final Score = (Density Score × 0.7) + (Diversity Score × 0.3)

Density Score  = 100 - (weighted issue count / node count) × 100
Diversity Score = (1 - unique violated rules / total rules in category) × 100
```

Severity weights issues — a single blocking issue counts 3x more than a suggestion. Scores are calculated per category and combined into an overall grade (S/A+/A/B+/B/C+/C/D/F).

> Weights and rule scores are validated through a 4-agent calibration pipeline. See [docs/CALIBRATION.md](docs/CALIBRATION.md) for details.

</details>

<details>
<summary><strong>MCP Server Details</strong></summary>

The `canicode-mcp` server exposes two tools: `analyze` and `list-rules`.

**Route A — Figma MCP relay (no token):**

```
Claude Code → Figma MCP get_metadata → XML node tree
Claude Code → canicode MCP analyze(designData: XML) → result
```

**Route B — REST API direct (token):**

```
Claude Code → canicode MCP analyze(input: URL) → internal fetch → result
```

Route A requires two MCP servers (figma + canicode). Route B requires one + a saved token.

The `analyze` tool accepts `designData` (XML/JSON from Figma MCP) or `input` (Figma URL / fixture path). When both are provided, `designData` takes priority.

</details>

<details>
<summary><strong>Save Fixture</strong></summary>

Save Figma file data as JSON for offline analysis:

```bash
canicode save-fixture https://www.figma.com/design/ABC123/MyDesign
canicode save-fixture https://www.figma.com/design/ABC123/MyDesign --mcp
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
git clone https://github.com/let-sunny/canicode.git
cd canicode
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
- [x] **Phase 3** — Config overrides, MCP server, Claude Skills
- [x] **Phase 4** — Figma comment from report (per-issue "Comment" button in HTML report, posts to Figma node via API)
- [x] **Phase 5** — Custom rules with pattern matching (node name/type/attribute conditions)
- [ ] **Phase 6** — Screenshot comparison (Figma vs AI-generated code, visual diff)

## Support

- **Bug reports:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Questions and discussions:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Privacy:** See [PRIVACY.md](PRIVACY.md) for details on data collection and how to opt out

## License

MIT
