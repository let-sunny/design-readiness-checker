<p align="center">
  <img src="docs/images/logo.png" alt="CanICode" width="80">
</p>

<h1 align="center">CanICode</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/canicode"><img src="https://img.shields.io/npm/v/canicode.svg" alt="npm version"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/ci.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/let-sunny/canicode/actions/workflows/release.yml"><img src="https://github.com/let-sunny/canicode/actions/workflows/release.yml/badge.svg" alt="Release"></a>
</p>

<p align="center"><strong>Predicts where your Figma design will break when AI implements it — scored against real code conversion difficulty.</strong></p>

<p align="center">
  <strong><a href="https://let-sunny.github.io/canicode/">Try it in your browser</a></strong> — no install needed.
</p>

<p align="center">
  <img src="docs/images/screenshot.gif" alt="CanICode Report" width="720">
</p>

---

## Why CanICode

AI code generators (Claude, Cursor, GPT) can turn a Figma design into working code — but they fail predictably on certain patterns: missing Auto Layout, raw color values, unnamed layers, ambiguous nesting.

CanICode finds these patterns **before** you generate code, so you can fix the design instead of debugging the output.

- **29 rules** across 5 dimensions: Structure, Token, Component, Naming, Behavior
- **Deterministic** — no AI tokens consumed per analysis, runs in milliseconds
- **Calibrated** — scores validated by converting real designs to code and measuring pixel-level accuracy

### Scores You Can Trust

Rule scores aren't guesswork. A 6-agent calibration pipeline converts real Figma designs to HTML, measures pixel-level similarity (via `visual-compare`), and adjusts scores based on actual implementation difficulty.

- Design that's hard to implement accurately → rule score goes **up**
- Design that's easy despite the flag → rule score goes **down**

The pipeline runs on community fixtures, not on every analysis. See [`docs/CALIBRATION.md`](docs/CALIBRATION.md).

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
| **`canicode implement`** | Generate code-ready package (analysis + assets + prompt) |
| **[GitHub Action](https://github.com/marketplace/actions/canicode-action)** | PR gate with score threshold |

</details>

---

## What It Checks

| Category | Rules | What it measures |
|----------|:-----:|------------------|
| **Structure** | 9 | Can AI read the layout? (Auto Layout, nesting, positioning, responsive) |
| **Token** | 7 | Can AI reproduce exact values? (colors, fonts, shadows, spacing) |
| **Component** | 4 | Is the design efficient for AI context? (reuse, variants, descriptions) |
| **Naming** | 5 | Can AI infer meaning? (semantic names, conventions) |
| **Behavior** | 4 | Can AI know what happens? (overflow, truncation, wrap, interactions) |

Each issue is classified: **Blocking** > **Risk** > **Missing Info** > **Suggestion**.

---

## Installation

<details>
<summary><strong>CLI</strong></summary>

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

Setup: `canicode init --token figd_xxxxxxxxxxxxx`

> **Get your token:** Figma → Settings → Security → Personal access tokens → Generate new token

**Figma API Rate Limits** — Rate limits depend on **where the file lives**, not just your plan.

| Seat | File in Starter plan | File in Pro/Org/Enterprise |
|------|---------------------|---------------------------|
| View, Collab | 6 req/month | 6 req/month |
| Dev, Full | 6 req/month | 10–20 req/min |

Hitting 429 errors? Make sure the file is in a paid workspace. Or use MCP (no token, separate rate limit pool). Or `save-fixture` once and analyze locally. [Full details](https://developers.figma.com/docs/rest-api/rate-limits/)

</details>

<details>
<summary><strong>MCP Server</strong> (Claude Code / Cursor / Claude Desktop)</summary>

```bash
claude mcp add canicode -- npx -y -p canicode canicode-mcp
claude mcp add -s project -t http figma https://mcp.figma.com/mcp
```

Then ask: *"Analyze this Figma design: https://www.figma.com/design/..."*

canicode's rule engine analyzes the design data — the AI assistant just orchestrates the calls.

Or with a Figma API token (no Figma MCP needed):
```bash
claude mcp add canicode -e FIGMA_TOKEN=figd_xxxxxxxxxxxxx -- npx -y -p canicode canicode-mcp
```

For Cursor / Claude Desktop config, see [`docs/REFERENCE.md`](docs/REFERENCE.md).

**Figma MCP Rate Limits**

| Plan | Limit |
|------|-------|
| Starter | 6 tool calls/month |
| Pro / Org — Full or Dev seat | 200 tool calls/day |
| Enterprise — Full or Dev seat | 600 tool calls/day |

MCP and CLI use separate rate limit pools — switching to MCP won't affect your CLI quota. [Full details](https://developers.figma.com/docs/figma-mcp-server/plans-access-and-permissions/)

</details>

<details>
<summary><strong>CLI vs MCP</strong> (feature comparison)</summary>

| Feature | CLI (REST API) | MCP (Figma MCP) |
|---------|:-:|:-:|
| Node structure | Full tree | XML metadata |
| Style values | Raw Figma JSON | React+Tailwind code |
| Component metadata (name, desc) | Yes | No |
| Component master trees | Yes | No |
| Annotations (dev mode) | No (private beta) | Yes |
| Screenshots | Yes | Yes |
| FIGMA_TOKEN required | Yes | No |

**When to use which:**
- Accurate component analysis → **CLI with FIGMA_TOKEN**
- Quick checks or annotation-aware flows → **MCP**
- Offline/CI → **CLI with saved fixtures** (`save-fixture`)

</details>

<details>
<summary><strong>Design to Code</strong> (prepare implementation package)</summary>

```bash
canicode implement ./fixtures/my-design
canicode implement "https://www.figma.com/design/ABC/File?node-id=1-234" --prompt ./my-react-prompt.md --image-scale 3
```

Outputs a ready-to-use package for AI code generation:
- `analysis.json` — issues + scores
- `design-tree.txt` — DOM-like tree with CSS styles + token estimate
- `images/` — PNG assets with human-readable names (`hero-banner@2x.png`)
- `vectors/` — SVG assets
- `PROMPT.md` — code generation prompt (default: HTML+CSS, or your custom prompt)

| Option | Default | Description |
|--------|---------|-------------|
| `--prompt` | built-in HTML+CSS | Path to your custom prompt file for any stack |
| `--image-scale` | `2` | Image export scale: `2` for PC, `3` for mobile |
| `--output` | `./canicode-implement/` | Output directory |

Feed `design-tree.txt` + `PROMPT.md` to your AI assistant (Claude, Cursor, etc.) to generate code.

</details>

<details>
<summary><strong>Claude Code Skill</strong> (lightweight, no MCP install)</summary>

```bash
cp -r .claude/skills/canicode /your-project/.claude/skills/
```

Requires the official Figma MCP. Then use `/canicode` with a Figma URL.

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
| **Custom rules** | `--custom-rules ./rules.json` — add project-specific checks |

> Ask any LLM *"Write a canicode custom rule that checks X"* — it can generate the JSON for you.

See [`docs/REFERENCE.md`](docs/REFERENCE.md) for the full guide, examples, and all available options.

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

## Contributing

**[Share your Figma design](https://github.com/let-sunny/canicode/discussions/new?category=share-your-figma)** to help calibrate scores against real-world designs.

## Support

- **Bugs and questions:** [GitHub Issues](https://github.com/let-sunny/canicode/issues)
- **Privacy:** See [PRIVACY.md](PRIVACY.md) for details on data collection and how to opt out

## License

MIT
