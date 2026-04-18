<p align="center">
  <img src="docs/images/logo.png" alt="CanICode" width="80">
</p>

<h1 align="center">CanICode</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/canicode"><img src="https://img.shields.io/npm/v/canicode.svg" alt="npm version"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/ci.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/release.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/release.yml/badge.svg" alt="Release"></a>
</p>

<p align="center"><strong>Stop explaining your designs. Get scored by AI-calibrated rules.</strong></p>

<p align="center">
  <strong><a href="https://let-sunny.github.io/canicode/">Try it in your browser</a></strong> — no install needed.
</p>

<p align="center">
  <img src="docs/images/screenshot.gif" alt="CanICode Report" width="720">
</p>

---

## Why CanICode

AI can turn Figma designs into code — but the quality depends heavily on **how the design is structured**. Missing Auto Layout drops pixel accuracy from 95% to 63% at different viewports. Raw JSON input wastes 5× more tokens for 15%p worse results.

CanICode solves this:

1. **Analyzes** your Figma design for patterns that hurt AI implementation quality
2. **Generates a design-tree** — a curated, CSS-ready representation that AI implements more accurately and efficiently than raw Figma data
3. **Scores** responsive readiness, so you fix the design before generating code

- **16 rules** across 6 categories: Pixel Critical, Responsive Critical, Code Quality, Token Management, Interaction, Semantic
- **Deterministic** — no AI tokens consumed per analysis, runs in milliseconds
- **Validated** — [ablation experiments](https://github.com/let-sunny/canicode/wiki) confirmed design-tree achieves 94% pixel accuracy with 5× fewer tokens than raw JSON

### Scores You Can Trust

Rule scores aren't guesswork. The calibration pipeline converts real Figma designs to HTML, measures pixel-level similarity (via `visual-compare`), and adjusts scores based on actual implementation difficulty.

- Design that's hard to implement accurately → rule score goes **up**
- Design that's easy despite the flag → rule score goes **down**

The pipeline runs on community fixtures, not on every analysis. Strip ablation uses six `DESIGN_TREE_INFO_TYPES` passes (including `size-constraints` for responsive sizing rules — see [`CLAUDE.md`](CLAUDE.md)). See the [Calibration wiki](https://github.com/let-sunny/canicode/wiki/Calibration).

---

## Getting Started

**Quickest way:** **[Open the web app](https://let-sunny.github.io/canicode/)** — paste a Figma URL, get a report.

**For your workflow:**

```bash
# CLI — one command
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"

# MCP Server — works with Claude Code, Cursor, Claude Desktop
claude mcp add canicode -- npx -y -p canicode canicode-mcp
```

<details>
<summary><strong>All channels</strong></summary>

| Channel | Best for |
|---------|----------|
| **[Web App](https://let-sunny.github.io/canicode/)** | Quick check, no install |
| **[Figma Plugin](https://www.figma.com/community/plugin/1617144221046795292/canicode)** | Analyze inside Figma (under review) |
| **MCP Server** | Claude Code / Cursor / Claude Desktop integration |
| **Claude Code Skill** | Lightweight, no MCP install |
| **CLI** | Full control, CI/CD, offline analysis |
| **[GitHub Action](https://github.com/marketplace/actions/canicode-action)** | PR gate with score threshold |

</details>

---

## What It Checks

| Category | Rules | What it measures |
|----------|:-----:|------------------|
| **Pixel Critical** | 3 | Can AI read the layout? (Auto Layout, absolute positioning, groups) |
| **Responsive Critical** | 2 | Will it work at different viewports? (fixed sizing, size constraints) |
| **Code Quality** | 4 | Is the design efficient for AI context? (components, variants, nesting) |
| **Token Management** | 2 | Can AI reproduce exact values? (raw values, spacing grid) |
| **Interaction** | 2 | Can AI know what happens? (state variants, prototypes) |
| **Semantic** | 3 | Can AI infer meaning? (semantic names, conventions) |

Each issue is classified: **Blocking** > **Risk** > **Missing Info** > **Suggestion**.

---

## Installation

<details>
<summary><strong>CLI</strong></summary>

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

Setup: `canicode init --token figd_xxxxxxxxxxxxx` — saves the token AND installs the Claude Code skills (see below).

> **Get your token:** Figma → Settings → Security → Personal access tokens → Generate new token

**Figma API Rate Limits** — Rate limits depend on **where the file lives**, not just your plan.

| Seat | File in Starter plan | File in Pro/Org/Enterprise |
|------|---------------------|---------------------------|
| View, Collab | 6 req/month | 6 req/month |
| Dev, Full | 6 req/month | 10–20 req/min |

Hitting 429 errors? Make sure the file is in a paid workspace. Or save a fixture once and analyze locally. [Full details](https://developers.figma.com/docs/rest-api/rate-limits/)

</details>

<details>
<summary><strong>MCP Server</strong> (Claude Code / Cursor / Claude Desktop)</summary>

```bash
claude mcp add canicode -- npx -y -p canicode canicode-mcp
claude mcp add -s project -t http figma https://mcp.figma.com/mcp
```

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

canicode's rule engine analyzes the design data — the AI assistant just orchestrates the calls.

With a Figma API token:
```bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
```

For Cursor / Claude Desktop config, see [`docs/CUSTOMIZATION.md`](docs/CUSTOMIZATION.md).

</details>


<details>
<summary><strong>Claude Code Skills</strong> (lightweight, no MCP install)</summary>

```bash
canicode init --token figd_xxxxxxxxxxxxx
```

Saves your Figma token AND installs three skills into `./.claude/skills/`:

- **canicode** — lightweight CLI wrapper (use `/canicode <figma-url>`)
- **canicode-gotchas** — standalone gotcha survey (use `/canicode-gotchas <figma-url>`)
- **canicode-roundtrip** — full analyze → gotcha → apply roundtrip (use `/canicode-roundtrip <figma-url>`)

Flags: `--global` installs into `~/.claude/skills/` instead. `--no-skills` skips skill install (token only). `--force` overwrites existing skill files without prompting. Run `canicode docs setup` for the full setup guide.

</details>

<details>
<summary><strong>GitHub Action</strong></summary>

```yaml
- uses: let-sunny/canicode-action@v0.1.0
  with:
    figma_url: 'https://www.figma.com/design/ABC123/MyDesign?node-id=1-234'
    figma_token: ${{ secrets.FIGMA_TOKEN }}
    min_score: 70
```

Posts analysis as a PR comment. Fails if score is below threshold. See [**canicode-action**](https://github.com/marketplace/actions/canicode-action) on Marketplace.

</details>

---

## Customization

| What | How |
|------|-----|
| **Presets** | `--preset relaxed \| dev-friendly \| ai-ready \| strict` |
| **Config overrides** | `--config ./config.json` — adjust scores, severity, exclude nodes |

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

For architecture details, see [`CLAUDE.md`](CLAUDE.md). For calibration pipeline, see the [Calibration wiki](https://github.com/let-sunny/canicode/wiki/Calibration).

## Contributing

**[Share your Figma design](https://github.com/let-sunny/canicode/discussions/new?category=share-your-figma)** to help calibrate scores against real-world designs.

## Support

- **Bugs and questions:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Privacy:** See [PRIVACY.md](PRIVACY.md) for details on data collection and how to opt out

## License

MIT
