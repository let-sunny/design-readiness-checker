<p align="center">
  <img src="docs/logo.png" alt="CanICode" width="80">
</p>

<h1 align="center">CanICode</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/canicode"><img src="https://img.shields.io/npm/v/canicode.svg" alt="npm version"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/ci.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/release.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://let-sunny.github.io/canicode/"><img src="https://img.shields.io/badge/Try_it-GitHub_Pages-blue" alt="GitHub Pages"></a>
  <a href="https://www.figma.com/community/plugin/1617144221046795292/canicode"><img src="https://img.shields.io/badge/Figma_Plugin-under_review-orange" alt="Figma Plugin"></a>
  <a href="https://github.com/let-sunny/canicode#mcp-server-claude-code--cursor--claude-desktop"><img src="https://img.shields.io/badge/MCP_Registry-published-green" alt="MCP Registry"></a>
</p>

<p align="center">Analyze Figma designs. Score how dev-friendly and AI-friendly they are. Get actionable issues before writing code.</p>

<p align="center"><strong><a href="https://github.com/let-sunny/canicode/discussions/new?category=share-your-figma">Share your Figma design</a></strong> to help improve scoring accuracy.</p>

<p align="center"><strong><a href="https://let-sunny.github.io/canicode/">Try it in your browser</a></strong> — no install needed.</p>

<p align="center">
  <img src="docs/screenshot.png" alt="CanICode Report" width="720">
</p>

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

Scores use density + diversity weighting per category, combined into an overall grade (S/A+/A/B+/B/C+/C/D/F). Rule scores are calibrated against actual code conversion difficulty — see [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

---

## Getting Started

Five ways to use CanICode. Pick one.

### 1. CLI

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

Setup:
```bash
canicode init --token figd_xxxxxxxxxxxxx
```

> **Get your token:** Figma → Settings → Security → Personal access tokens → Generate new token

### 2. MCP Server (Claude Code / Cursor / Claude Desktop)

**Claude Code (recommended — with official Figma MCP, no token needed):**
```bash
claude mcp add canicode -- npx -y -p canicode canicode-mcp
claude mcp add -s project -t http figma https://mcp.figma.com/mcp
```

**Claude Code (with Figma API token):**
```bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
```

For Cursor / Claude Desktop config, see [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md).

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

> **Note:** MCP/Skill path extracts style data from Figma MCP's generated code (React + Tailwind), not raw Figma node properties. For the most accurate analysis, use the CLI with a Figma API token.

### 3. Web (no install)

Go to **[let-sunny.github.io/canicode](https://let-sunny.github.io/canicode/)**, paste a Figma URL, and get results instantly in your browser.

### 4. Figma Plugin (under review)

Install from **[Figma Community](https://www.figma.com/community/plugin/1617144221046795292/canicode)** — analyze directly inside Figma. No tokens needed.

---

## Customization

| What | How |
|------|-----|
| **Presets** | `--preset relaxed \| dev-friendly \| ai-ready \| strict` |
| **Config overrides** | `--config ./config.json` — adjust scores, severity, exclude nodes |
| **Custom rules** | `--custom-rules ./rules.json` — add project-specific checks |

> Ask any LLM *"Write a canicode custom rule that checks X"* — it can generate the JSON for you.

See [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md) for the full guide, examples, and all available options.

---

## Development

```bash
git clone https://github.com/let-sunny/canicode.git && cd canicode
pnpm install && pnpm build
```

```bash
pnpm dev        # watch mode
pnpm test       # run tests
pnpm lint       # type check
```

For architecture details, see [`CLAUDE.md`](CLAUDE.md). For calibration pipeline, see [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

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
