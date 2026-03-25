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
  canicode docs rules      Custom rules guide + example
  canicode docs config     Config override guide + example
  canicode docs implement  Design-to-code package guide
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

/** Print custom rules guide with examples. */
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

  Full guide: docs/REFERENCE.md
  Examples:   examples/custom-rules.json

TIP: Ask any LLM "Write a canicode custom rule that checks X" with the
  match conditions above. It can generate the JSON for you.
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

  Full guide: docs/REFERENCE.md
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
  --figma-scale <n>   Figma Images API scale (default: 2, matches save-fixture @2x PNGs)

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

/** Print the implement command guide. */
export function printDocsImplement(): void {
  console.log(`
DESIGN-TO-CODE IMPLEMENTATION GUIDE

Prepare everything an AI needs to implement a Figma design as code.

USAGE
  canicode implement <figma-url-or-fixture> [options]

OPTIONS
  --prompt <path>      Custom prompt file (default: built-in HTML+CSS)
  --image-scale <n>    Image export scale: 2 for PC (default), 3 for mobile
  --output <dir>       Output directory (default: ./canicode-implement/)
  --token <token>      Figma API token (for live URLs)

OUTPUT
  canicode-implement/
    analysis.json      Analysis report with issues and scores
    design-tree.txt    DOM-like tree with CSS styles (~N tokens)
    images/            PNG assets with human-readable names (hero-banner@2x.png)
    vectors/           SVG assets for vector nodes
    PROMPT.md          Stack-specific code generation prompt

WORKFLOW
  1. Run: canicode implement ./my-fixture --prompt ./my-react-prompt.md
  2. Feed design-tree.txt + PROMPT.md to your AI assistant
  3. AI generates code matching the design pixel-perfectly
  4. Verify with: canicode visual-compare ./output.html --figma-url <url>

CUSTOM PROMPT
  Default prompt generates HTML+CSS. For your own stack:
  1. Write a prompt file (e.g. my-react-prompt.md)
  2. Pass it: canicode implement ./fixture --prompt ./my-react-prompt.md
  The design-tree.txt format is stack-agnostic — your prompt just needs
  to describe how to convert it to your target framework.

IMAGE SCALE
  --image-scale 2     PC/desktop (default) — @2x retina
  --image-scale 3     Mobile — @3x retina
  SVG vectors are scale-independent and always included.
`.trimStart());
}

/** Print the scoring model explanation. */
export function printDocsScoring(): void {
  console.log(`
SCORING MODEL

canicode scores designs on a 0-100% scale across 6 categories:
layout, token, component, naming, ai-readability, handoff-risk.

HOW SCORES ARE CALCULATED

  Each category score combines two signals:

  1. Density (70% weight)
     Measures issue volume relative to design size.
     Formula: 100 - (weighted_issues / node_count) * 100
     A design with many issues per node scores lower.

  2. Diversity (30% weight)
     Measures how many different rule types triggered.
     Formula: (1 - unique_rules / total_category_rules) * 100
     Issues concentrated in one rule are easier to fix than scattered issues.

  Final category score = density * 0.7 + diversity * 0.3
  Overall score = average of all 6 category scores (equal weight).

SEVERITY WEIGHTS

  Issues are weighted by severity when computing density:

    blocking      3.0x    Cannot implement correctly without fixing
    risk          2.0x    Will break or increase cost later
    missing-info  1.0x    Forces developers to guess
    suggestion    0.5x    Nice-to-have improvement

  A single blocking issue counts as much as 6 suggestions.

GRADE THRESHOLDS

    S   >= 95%      A+  >= 90%      A   >= 85%
    B+  >= 80%      B   >= 75%      C+  >= 70%
    C   >= 65%      D   >= 50%      F   <  50%

SCORE FLOOR

  Minimum score is 5%. Any Figma file with visible nodes provides some
  structural information, so 0% ("completely unimplementable") is avoided.

CALIBRATION STATUS

  Severity weights and density/diversity ratio are initial estimates.
  The /calibrate-loop pipeline validates these against pixel-level
  visual comparison (visual-compare similarity). Calibration evidence
  accumulates in data/calibration-evidence.json across runs.

  Individual rule scores are managed in src/core/rules/rule-config.ts
  and can be overridden via --config (see: canicode docs config).
`.trimStart());
}

const DOCS_TOPICS: Record<string, () => void> = {
  setup: printDocsSetup,
  install: printDocsSetup, // alias
  rules: printDocsRules,
  config: printDocsConfig,
  implement: printDocsImplement,
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
