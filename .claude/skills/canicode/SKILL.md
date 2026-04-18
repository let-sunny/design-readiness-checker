---
name: canicode
description: Analyze Figma designs for development-friendliness and AI-friendliness scores
---

# CanICode -- Figma Design Analysis

Analyze Figma design files to score how development-friendly and AI-friendly they are. Produces actionable reports with specific issues and fix suggestions.

## Prerequisites

This skill works with either channel — the CLI or the canicode MCP server. Both return the same analysis; pick whichever is already set up. Requires either:
- A **saved fixture** (from `canicode calibrate-save-fixture`)
- A **FIGMA_TOKEN** for live Figma URLs

## How to Analyze

### From a Figma URL

```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234" --token YOUR_TOKEN
```

Or if FIGMA_TOKEN is set in environment:
```bash
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

### From a saved fixture

```bash
npx canicode analyze fixtures/my-design
```

### Save a fixture for offline analysis

```bash
npx canicode calibrate-save-fixture "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234" --output fixtures/my-design
```

## Analysis Options

### Presets
- `--preset relaxed` — Downgrades blocking to risk, reduces scores by 50%
- `--preset dev-friendly` — Enables only pixel-critical and responsive-critical rules, disables the rest
- `--preset ai-ready` — Sets pixel-critical and token-management rule scores to 150% of defaults
- `--preset strict` — Increases all scores by 150%

### Config overrides
```bash
npx canicode analyze <input> --config ./my-config.json
```

### JSON output
```bash
npx canicode analyze <input> --json
```

### Via MCP (when `canicode-mcp` is installed)

If the user has the canicode MCP server installed, prefer the MCP tool — it avoids the `npx` spawn overhead and reuses a warm Figma client:

```
analyze({ input: "<figma-url-or-fixture-path>" })
```

Options mirror the CLI: `preset`, `token`, `config`, `targetNodeId`, `json`. The `json` response field matches `npx canicode analyze --json` byte-for-byte, so downstream code can parse either source.

## What It Reports

16 rules across 6 categories: Pixel Critical, Responsive Critical, Code Quality, Token Management, Interaction, Semantic.

Each issue includes:
- Rule ID and severity (blocking / risk / missing-info / suggestion)
- Affected node with Figma deep link
- Why it matters, impact, and how to fix
