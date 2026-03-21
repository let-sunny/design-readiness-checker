---
name: canicode
description: Analyze Figma designs for development-friendliness and AI-friendliness scores
---

# CanICode -- Figma Design Analysis

Analyze Figma design files to score how development-friendly and AI-friendly they are. Produces actionable reports with specific issues and fix suggestions.

## Setup

```bash
# Set Figma API token (one-time)
npx canicode init --token YOUR_FIGMA_TOKEN
```

## Usage

### Analyze a Figma URL
```bash
# REST API mode (needs FIGMA_TOKEN)
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234" --api

# MCP bridge mode (Claude Code only, no token needed)
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234" --mcp

# Auto-detect: try MCP first, fallback to API
npx canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
```

### With presets
- `--preset relaxed` -- Downgrades blocking to risk, reduces scores by 50%
- `--preset dev-friendly` -- Focuses on layout and handoff rules only
- `--preset ai-ready` -- Boosts structure and naming rule weights by 150%
- `--preset strict` -- Enables all rules, increases all scores by 150%

### With custom rules
```bash
npx canicode analyze <url> --custom-rules ./my-rules.json
```

### With config overrides
```bash
npx canicode analyze <url> --config ./my-config.json
```

## What It Reports

39 rules across 6 categories: Layout, Design Token, Component, Naming, AI Readability, Handoff Risk.

Each issue includes:
- Rule ID and severity (blocking / risk / missing-info / suggestion)
- Affected node with Figma deep link
- Why it matters, impact, and how to fix

## Custom Rules

Create a JSON file with custom rules:

```json
[
  {
    "id": "my-custom-rule",
    "category": "component",
    "severity": "blocking",
    "score": -10,
    "prompt": "Description of what to check",
    "why": "Why this matters",
    "impact": "What happens if not fixed",
    "fix": "How to fix it"
  }
]
```

## Config Overrides

Create a JSON config file to override rule scores and settings:

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
