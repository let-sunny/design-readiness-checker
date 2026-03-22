<p align="center">
  <img src="docs/images/logo.png" alt="CanICode" width="80">
</p>

<h1 align="center">CanICode</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/canicode"><img src="https://img.shields.io/npm/v/canicode.svg" alt="npm version"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/ci.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/release.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/release.yml/badge.svg" alt="Release"></a>
  <a href="https://let-sunny.github.io/canicode/"><img src="https://img.shields.io/badge/Try_it-GitHub_Pages-blue" alt="GitHub Pages"></a>
  <a href="https://www.figma.com/community/plugin/1617144221046795292/canicode"><img src="https://img.shields.io/badge/Figma_Plugin-under_review-orange" alt="Figma Plugin"></a>
  <a href="https://github.com/let-sunny/canicode#mcp-server-claude-code--cursor--claude-desktop"><img src="https://img.shields.io/badge/MCP_Registry-published-green" alt="MCP Registry"></a>
  <a href="https://github.com/marketplace/actions/canicode-action"><img src="https://img.shields.io/badge/GitHub_Action-Marketplace-2088FF" alt="GitHub Action"></a>
</p>

<p align="center">The design linter that scores how easily your Figma design can be implemented by AI or developers — before a single line of code is written.</p>

<p align="center">AI-powered insights. Zero tokens per analysis — rules run deterministically, not through AI calls.</p>

<p align="center"><strong><a href="https://github.com/let-sunny/canicode/discussions/new?category=share-your-figma">Share your Figma design</a></strong> to help improve scoring accuracy.</p>

<p align="center"><strong><a href="https://let-sunny.github.io/canicode/">Try it in your browser</a></strong> — no install needed.</p>

<p align="center">
  <img src="docs/images/screenshot.png" alt="CanICode Report" width="720">
</p>

---

## How It Works

39 rules. 6 categories. Every node in the Figma tree.

| Category | Rules | What it checks |
|----------|-------|----------------|
| Layout | 11 | Auto-layout usage, responsive behavior, nesting depth |
| Design Token | 7 | Color/font/shadow tokenization, spacing consistency |
| Component | 6 | Component reuse, detached instances, variant coverage |
| Naming | 5 | Semantic names, default names, naming conventions |
| AI Readability | 5 | Structure clarity, z-index reliance, empty frames |
| Handoff Risk | 5 | Hardcoded values, truncation handling, placeholder images |

Each issue is classified: **Blocking** > **Risk** > **Missing Info** > **Suggestion**.

### Rule Scores Validated by AI

Rule scores aren't guesswork. They're validated through a 4-agent debate pipeline that converts real Figma nodes to code and measures actual implementation difficulty.

1. **Runner** analyzes the design and flags issues
2. **Converter** converts the flagged nodes to actual code
3. **Critic** challenges whether the scores match the real difficulty
4. **Arbitrator** makes the final call — adjust or keep

- A node that's hard to implement → rule score goes up
- A node that's easy to implement despite the flag → rule score goes down

The rules themselves run deterministically on every analysis. No tokens consumed per run. The AI debate only validated whether each rule's score reflects real difficulty — once, not on every run. See [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

---

## Getting Started

| If you want to... | Use |
|---|---|
| Just try it | **[Web App](https://let-sunny.github.io/canicode/)** — paste a URL, no install |
| Analyze inside Figma | **[Figma Plugin](https://www.figma.com/community/plugin/1617144221046795292/canicode)** (under review) |
| Use with Claude Code / Cursor | **MCP Server** or **Skill** — see below |
| Add to CI/CD | **[GitHub Action](https://github.com/marketplace/actions/canicode-action)** |
| Full control | **CLI** |

### CLI

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

Setup: `canicode init --token figd_xxxxxxxxxxxxx`

> **Get your token:** Figma → Settings → Security → Personal access tokens → Generate new token

### MCP Server (Claude Code / Cursor / Claude Desktop)

```bash
claude mcp add canicode -- npx -y -p canicode canicode-mcp
claude mcp add -s project -t http figma https://mcp.figma.com/mcp
```

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

canicode's rule engine analyzes the design data — Claude Code orchestrates the calls.

Or with a Figma API token (no Figma MCP needed):
```bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
```

For Cursor / Claude Desktop config, see [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md).

### Claude Code Skill (lightweight, no MCP install)

```bash
cp -r .claude/skills/canicode /your-project/.claude/skills/
```

Requires the official Figma MCP. Then use `/canicode` with a Figma URL.

### GitHub Action

```yaml
- uses: let-sunny/canicode-action@v0.1.0
  with:
    figma_url: 'https://www.figma.com/design/ABC123/MyDesign?node-id=1-234'
    figma_token: ${{ secrets.FIGMA_TOKEN }}
    min_score: 70
```

Posts analysis as a PR comment. Fails if score is below threshold. See [Marketplace](https://github.com/marketplace/actions/canicode-action).

See [**canicode-action**](https://github.com/marketplace/actions/canicode-action) on GitHub Marketplace.

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

- **Bugs and questions:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Privacy:** See [PRIVACY.md](PRIVACY.md) for details on data collection and how to opt out

## License

MIT
