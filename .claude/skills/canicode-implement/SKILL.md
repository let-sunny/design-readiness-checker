---
name: canicode-implement
description: Prepare a design-to-code implementation package from a Figma URL or fixture
---

# CanICode Implement -- Design-to-Code Package

Prepare everything an AI needs to implement a Figma design as code: analysis report, design tree with image assets, and a code generation prompt.

This skill does NOT auto-generate code. It assembles a package that you then feed to an AI coding assistant.

## Prerequisites

One of:
- **FIGMA_TOKEN** environment variable for REST API access
- **Local fixture** directory (no token needed)

## Usage

### From a local fixture (simplest)

```bash
npx canicode calibrate-implement ./fixtures/my-design
```

### From a Figma URL

```bash
npx canicode calibrate-implement "https://www.figma.com/design/ABC/File?node-id=1-234"
```

### With a custom prompt (for your stack)

```bash
npx canicode calibrate-implement ./fixtures/my-design --prompt ./my-react-prompt.md
```

The default prompt generates HTML+CSS. Write your own prompt for React, Vue, or any other stack.

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--prompt <path>` | Custom prompt file for your stack | Built-in HTML+CSS |
| `--output <dir>` | Output directory | `./canicode-implement/` |
| `--token <token>` | Figma API token | `FIGMA_TOKEN` env var |
| `--image-scale <n>` | Image export scale (1-4) | `2` (PC), use `3` for mobile |

## Output Structure

```text
canicode-implement/
  analysis.json      # Full analysis with issues and scores
  design-tree.txt    # DOM-like tree with styles, structure, embedded SVGs
  PROMPT.md          # Code generation prompt (default or custom)
  screenshot.png     # Figma screenshot (if available)
  vectors/           # SVG assets for VECTOR nodes
  images/            # PNG assets for IMAGE fill nodes (hero-banner@2x.png)
```

## Next Steps

After running `canicode calibrate-implement`:

1. Open `design-tree.txt` -- this is the primary input for the AI
2. Open `PROMPT.md` -- this contains the coding conventions
3. Feed both to your AI coding assistant along with any images from `images/` and `vectors/`
4. Review `analysis.json` for known design issues that may affect implementation
