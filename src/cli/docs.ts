/**
 * Built-in documentation for canicode CLI
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

/** Print the docs index with available topics. */
export function printDocsIndex(): void {
  console.log(`
CANICODE DOCUMENTATION (v${pkg.version})

  canicode docs setup      Full setup guide (CLI, MCP, Skills)
  canicode docs config     Config override guide + example
  canicode docs scoring    Scoring model explanation

Full documentation: github.com/let-sunny/canicode#readme
`.trimStart());
}

/** Print the setup guide (CLI, MCP, Skills). */
export function printDocsSetup(): void {
  console.log(`
CANICODE SETUP GUIDE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 1. CLI (REST API)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Install:
    npm install -g canicode

  Setup:
    canicode init --token figd_xxxxxxxxxxxxx
    (saves token + installs skills — see section 2 for --no-skills)

  Use:
    canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
    (opens report in browser automatically, use --no-open to disable)

  Options:
    --preset strict|relaxed|dev-friendly|ai-ready
    --config ./my-config.json
    --no-open   Don't open report in browser

  Output:
    ~/.canicode/reports/report-YYYY-MM-DD-HH-mm-<filekey>.html

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 2. CLAUDE CODE SKILLS (requires FIGMA_TOKEN)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Setup:
    canicode init --token figd_xxxxxxxxxxxxx
    (installs three skills into ./.claude/skills/ alongside the token)

  Installed skills:
    canicode             Lightweight CLI wrapper
    canicode-gotchas     Standalone gotcha survey
    canicode-roundtrip   Full analyze -> gotcha -> apply roundtrip

  Flags:
    --global      Install to ~/.claude/skills/ instead of ./.claude/skills/
    --no-skills   Skip skill install (token only — legacy behavior)
    --force       Overwrite existing skill files without prompting

  Use (in Claude Code):
    /canicode https://www.figma.com/design/ABC123/MyDesign?node-id=1-234
    /canicode-gotchas <url>      Run a gotcha survey
    /canicode-roundtrip <url>    Analyze, fix gotchas in Figma, re-analyze

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TOKEN PRIORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. --token flag (one-time override)
  2. FIGMA_TOKEN env var (CI/CD)
  3. ~/.canicode/config.json (canicode init)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 WHICH ONE SHOULD I USE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  CI/CD, automation        -> CLI + FIGMA_TOKEN env var
  Claude Code (full)       -> canicode MCP server + FIGMA_TOKEN
  Claude Code (light)      -> /canicode skill + FIGMA_TOKEN
  In Figma                 -> Figma Plugin
  Browser                  -> Web App (GitHub Pages)
  Quick trial, offline     -> CLI + JSON fixtures
`.trimStart());
}

/** Print config override guide with examples. */
export function printDocsConfig(): void {
  console.log(`
CONFIG GUIDE

Override canicode's default rule scores, severity, and filters.

STRUCTURE
  - excludeNodeTypes: node types to skip (e.g. VECTOR, BOOLEAN_OPERATION)
  - excludeNodeNames: name patterns to skip (e.g. icon, ico)
  - gridBase: spacing grid unit, default 4
  - rules: per-rule overrides (score, severity, enabled)

EXAMPLE
  {
    "excludeNodeTypes": [],
    "excludeNodeNames": [],
    "gridBase": 2,
    "rules": {
      "no-auto-layout": { "score": -15, "severity": "blocking" },
      "raw-value": { "score": -5 },
      "non-semantic-name": { "enabled": false }
    }
  }

USAGE
  canicode analyze <url> --config ./my-config.json

  Full guide: docs/CUSTOMIZATION.md
  Examples:   examples/config.json
`.trimStart());
}

function printDocsVisualCompare(): void {
  console.log(`
VISUAL COMPARE — Pixel-level comparison between Figma and AI-generated code

USAGE
  canicode visual-compare ./index.html --figma-url 'https://www.figma.com/design/ABC/File?node-id=1-234'

OPTIONS
  --figma-url <url>   Figma URL with node-id (required)
  --token <token>     Figma API token (or FIGMA_TOKEN env var)
  --output <dir>      Output directory (default: /tmp/canicode-visual-compare)
  --width <px>        Logical viewport width in CSS px (omit = infer from Figma PNG ÷ export scale)
  --height <px>       Logical viewport height in CSS px (omit = infer from Figma PNG ÷ export scale)
  --figma-scale <n>   Figma Images API scale (default: 2, matches calibrate-save-fixture @2x PNGs)

OUTPUT FILES
  /tmp/canicode-visual-compare/
    figma.png         Figma screenshot (default scale=2)
    code.png          Playwright render (devicePixelRatio matched to export scale)
    diff.png          Pixel diff (red = different pixels)

JSON OUTPUT (stdout)
  {
    "similarity": 87,        // 0-100%
    "diffPixels": 1340,
    "totalPixels": 102400,
    "width": 800,
    "height": 600,
    "figmaScreenshot": "/tmp/.../figma.png",
    "codeScreenshot": "/tmp/.../code.png",
    "diff": "/tmp/.../diff.png"
  }

HOW IT WORKS
  1. Fetches Figma screenshot via REST API (default scale=2)
  2. Infers logical CSS viewport (PNG size ÷ scale) unless --width/--height are set
  3. Renders HTML in Playwright with matching devicePixelRatio so code.png matches figma.png pixels
  4. Compares pixel-by-pixel with pixelmatch (threshold: 0.1)
  5. Returns similarity % and diff image

REQUIREMENTS
  npx playwright install chromium
  Figma API token with read access
`.trimStart());
}

function printDocsDesignTree(): void {
  console.log(`
DESIGN TREE — Generate DOM-like design tree from Figma fixture

USAGE
  canicode design-tree ./fixtures/design
  canicode design-tree ./fixtures/design --output tree.txt
  canicode design-tree "https://www.figma.com/design/ABC/File?node-id=1-234"

OPTIONS
  --token <token>     Figma API token (for URL input)
  --output <path>     Output file (default: stdout)

OUTPUT FORMAT
  Each node = one line: name (TYPE, WxH) + CSS-ready styles
  Indentation shows parent-child relationships

  Hero Form (INSTANCE, 375x960)
    style: display: flex; flex-direction: column; gap: 32px; background: #F5F5F5
    Title (TEXT, 117x58)
      style: font-family: "Inter"; font-size: 48px; color: #2C2C2C; text: "Title"

USE CASES
  Feed to AI for code generation (4KB vs 250KB raw JSON)
  Calibration pipeline (Converter uses this)
  Quick design structure inspection
`.trimStart());
}

/** Print the scoring model summary with pointer to full docs. */
export function printDocsScoring(): void {
  console.log(`
SCORING MODEL

  Score = density (70%) + diversity (30%), averaged across 6 categories.

  Severity weights:
    blocking 3.0x | risk 2.0x | missing-info 1.0x | suggestion 0.5x

  Grades: S(95) A+(90) A(85) B+(80) B(75) C+(70) C(65) D(50) F(<50)
  Floor: 5% minimum.

  Full documentation: https://github.com/let-sunny/canicode/wiki/Scoring-Model
`.trimStart());
}

const DOCS_TOPICS: Record<string, () => void> = {
  setup: printDocsSetup,
  install: printDocsSetup, // alias
  config: printDocsConfig,
  scoring: printDocsScoring,
  "visual-compare": printDocsVisualCompare,
  "design-tree": printDocsDesignTree,
};

/** Route docs command to the appropriate topic handler. */
export function handleDocs(topic?: string): void {
  if (!topic) {
    printDocsIndex();
    return;
  }

  const handler = DOCS_TOPICS[topic];
  if (handler) {
    handler();
  } else {
    console.error(`Unknown docs topic: ${topic}`);
    console.error(`Available topics: ${Object.keys(DOCS_TOPICS).join(", ")}`);
    process.exitCode = 1;
  }
}
