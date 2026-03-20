/**
 * Built-in documentation for aiready CLI
 */

export function printDocsIndex(): void {
  console.log(`
AIREADY DOCUMENTATION

  aiready docs rules    Custom rules guide + example
  aiready docs config   Config override guide + example
  aiready docs install  Installation guide (CLI, MCP, Skills)

Full documentation: github.com/let-sunny/aiready#readme
`.trimStart());
}

export function printDocsRules(): void {
  console.log(`
CUSTOM RULES GUIDE

Custom rules let you add project-specific checks beyond aiready's built-in 39 rules.

STRUCTURE
  - id: unique identifier (kebab-case)
  - category: layout | token | component | naming | ai-readability | handoff-risk
  - severity: blocking | risk | missing-info | suggestion
  - score: negative number (-1 to -15)
  - prompt: what Claude checks for (used in AI-based evaluation)
  - why: reason this matters
  - impact: consequence if ignored
  - fix: how to resolve

EXAMPLE
  [
    {
      "id": "icon-missing-component",
      "category": "component",
      "severity": "blocking",
      "score": -10,
      "prompt": "Check if this node is an icon (small size, vector children, no text) and is not a component or instance.",
      "why": "Icon nodes that are not components cannot be reused consistently.",
      "impact": "Developers will hardcode icons instead of using a shared component.",
      "fix": "Convert this icon node to a component and publish it to the library."
    }
  ]

USAGE
  aiready analyze <url> --custom-rules ./my-rules.json
  See full example: examples/custom-rules.json
`.trimStart());
}

export function printDocsConfig(): void {
  console.log(`
CONFIG GUIDE

Override aiready's default rule scores, severity, and filters.

STRUCTURE
  - excludeNodeTypes: node types to skip (e.g. VECTOR, BOOLEAN_OPERATION)
  - excludeNodeNames: name patterns to skip (e.g. icon, ico)
  - gridBase: spacing grid unit, default 8
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
  aiready analyze <url> --config ./my-config.json
  See full example: examples/config.json
`.trimStart());
}

export function printDocsInstall(): void {
  console.log(`
INSTALLATION GUIDE

SETUP (required first)
  aiready init --token YOUR_TOKEN   Save Figma API token to .env
  aiready init --mcp                Show MCP bridge setup instructions
  aiready init                      See all options

  Get token: figma.com > Settings > Personal access tokens

CLI
  npm install -g aiready
  aiready analyze "https://www.figma.com/design/..." --api     # REST API (needs FIGMA_TOKEN)
  aiready analyze "https://www.figma.com/design/..." --mcp     # MCP bridge (Claude Code only)
  aiready analyze "https://www.figma.com/design/..."           # Auto: try MCP, fallback to API

MCP SERVER (Claude Code integration)
  1. Set up token:
     aiready init --token YOUR_TOKEN

  2. Add MCP server:
     claude mcp add --transport stdio aiready npx aiready-mcp

  3. Use in Claude Code:
     "Analyze this Figma design: https://www.figma.com/design/..."

  Note: MCP server uses REST API internally (needs FIGMA_TOKEN in .env)

SKILLS (Claude Code)
  Copy .claude/skills/aiready/ from github.com/let-sunny/aiready
  Then: /aiready analyze "https://www.figma.com/design/..."
  Supports --mcp and --api flags (same as CLI)
`.trimStart());
}

const DOCS_TOPICS: Record<string, () => void> = {
  rules: printDocsRules,
  config: printDocsConfig,
  install: printDocsInstall,
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
    console.error(`Available topics: ${Object.keys(DOCS_TOPICS).join(", ")}`);
    process.exit(1);
  }
}
