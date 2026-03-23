/**
 * Built-in documentation for canicode CLI
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../../package.json") as { version: string };

export function printDocsIndex(): void {
  console.log(`
CANICODE DOCUMENTATION (v${pkg.version})

  canicode docs setup    Full setup guide (CLI, MCP, Skills)
  canicode docs rules    Custom rules guide + example
  canicode docs config   Config override guide + example

Full documentation: github.com/let-sunny/canicode#readme
`.trimStart());
}

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
    (saved to ~/.canicode/config.json, reports go to ~/.canicode/reports/)

  Use:
    canicode analyze "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
    (opens report in browser automatically, use --no-open to disable)

  Options:
    --preset strict|relaxed|dev-friendly|ai-ready
    --config ./my-config.json
    --custom-rules ./my-rules.json
    --no-open   Don't open report in browser

  Output:
    ~/.canicode/reports/report-YYYY-MM-DD-HH-mm-<filekey>.html

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 2. CLAUDE CODE SKILL (Figma MCP, no token needed)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Requires the official Figma MCP server at project level.

  Setup (once):
    claude mcp add -s project -t http figma https://mcp.figma.com/mcp

  Use (in Claude Code):
    /canicode https://www.figma.com/design/ABC123/MyDesign?node-id=1-234

  Flow:
    Claude Code
      -> Figma MCP get_metadata(fileKey, nodeId) -> XML node tree (structure)
      -> Figma MCP get_design_context(fileKey, nodeId) -> code (styles)
      -> Merge into fixture JSON (structure + styles)
      -> canicode analyze fixture.json -> report

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 TOKEN PRIORITY (CLI mode)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  1. --token flag (one-time override)
  2. FIGMA_TOKEN env var (CI/CD)
  3. ~/.canicode/config.json (canicode init)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 WHICH ONE SHOULD I USE?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  CI/CD, automation        -> CLI + FIGMA_TOKEN env var
  Claude Code (full)       -> canicode MCP + Figma MCP (no token needed)
  Claude Code (light)      -> /canicode skill + Figma MCP (no token needed)
  In Figma                 -> Figma Plugin
  Browser                  -> Web App (GitHub Pages)
  Quick trial, offline     -> CLI + JSON fixtures

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 DATA SOURCE DIFFERENCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  CLI (REST API)    Reads raw Figma node data directly.
                    Most accurate — all style properties available.

  MCP / Skill       Uses Figma MCP's get_metadata (structure) and
                    get_design_context (styles). Style data is extracted
                    from Figma MCP's own generated code (React + Tailwind),
                    not raw Figma node properties. Results may differ
                    slightly from CLI due to this interpretation layer.

  Details:          github.com/let-sunny/canicode/blob/main/docs/MCP-VS-CLI.md
`.trimStart());
}

export function printDocsRules(): void {
  console.log(`
CUSTOM RULES GUIDE

Add project-specific checks with declarative pattern matching.
All conditions in "match" use AND logic — every condition must be true to flag a node.

MATCH CONDITIONS
  type: ["FRAME","GROUP"]     Node type must be one of these
  notType: ["INSTANCE"]       Node type must NOT be one of these
  nameContains: "icon"        Name contains (case-insensitive)
  nameNotContains: "badge"    Name does NOT contain
  namePattern: "^btn-"        Regex pattern on name
  minWidth / maxWidth         Size constraints (px)
  minHeight / maxHeight       Size constraints (px)
  hasAutoLayout: true/false   Has layoutMode set
  hasChildren: true/false     Has child nodes
  minChildren / maxChildren   Child count range
  isComponent: true/false     Is COMPONENT or COMPONENT_SET
  isInstance: true/false       Is INSTANCE
  hasComponentId: true/false  Has componentId
  isVisible: true/false       Visibility
  hasFills / hasStrokes       Has fills or strokes
  hasEffects: true/false      Has effects
  minDepth / maxDepth         Tree depth range

EXAMPLE
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
        "nameContains": "icon"
      },
      "message": "\\"{name}\\" is an icon but not a component",
      "why": "Icons should be reusable components.",
      "impact": "Developers hardcode icons.",
      "fix": "Convert to component and publish to library."
    }
  ]

USAGE
  canicode analyze <url> --custom-rules ./my-rules.json

  Full guide: docs/CUSTOMIZATION.md
  Examples:   examples/custom-rules.json

TIP: Ask any LLM "Write a canicode custom rule that checks X" with the
  match conditions above. It can generate the JSON for you.
`.trimStart());
}

export function printDocsConfig(): void {
  console.log(`
CONFIG GUIDE

Override canicode's default rule scores, severity, and filters.

STRUCTURE
  - excludeNodeTypes: node types to skip (e.g. VECTOR, BOOLEAN_OPERATION)
  - excludeNodeNames: name patterns to skip (e.g. icon, ico)
  - gridBase: spacing grid unit, default 4
  - colorTolerance: color diff tolerance, default 10
  - rules: per-rule overrides (score, severity, enabled)

EXAMPLE
  {
    "excludeNodeTypes": [],
    "excludeNodeNames": [],
    "gridBase": 4,
    "rules": {
      "no-auto-layout": { "score": -15, "severity": "blocking" },
      "raw-color": { "score": -12 },
      "default-name": { "enabled": false }
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
  --width <px>        Viewport width override (default: match Figma screenshot)
  --height <px>       Viewport height override (default: match Figma screenshot)

OUTPUT FILES
  /tmp/canicode-visual-compare/
    figma.png         Figma screenshot (scale=2)
    code.png          Playwright render of your HTML
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
  1. Fetches Figma screenshot via REST API (scale=2)
  2. Reads screenshot dimensions
  3. Renders your HTML with Playwright at the same viewport size
  4. Compares pixel-by-pixel with pixelmatch (threshold: 0.1)
  5. Returns similarity % and diff image

REQUIREMENTS
  npx playwright install chromium
  Figma API token with read access
`.trimStart());
}

const DOCS_TOPICS: Record<string, () => void> = {
  setup: printDocsSetup,
  install: printDocsSetup, // alias
  rules: printDocsRules,
  config: printDocsConfig,
  "visual-compare": printDocsVisualCompare,
};

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
    console.error(`Available topics: setup, rules, config, visual-compare`);
    process.exit(1);
  }
}
