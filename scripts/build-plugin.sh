#!/usr/bin/env bash
# Build the Figma plugin:
# 1. Build browser.global.js (analysis engine IIFE bundle)
# 2. Compile plugin/main.ts -> plugin/main.js
# 3. Inline browser.global.js into plugin/ui.html from template

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGIN_DIR="$ROOT/plugin"
DOCS_DIR="$ROOT/docs"

echo "=== Building CanICode Figma Plugin ==="

# Step 1: Build the browser bundle
echo "[1/3] Building browser.global.js..."
pnpm build:web

# Step 2: Compile plugin main.ts
echo "[2/3] Compiling plugin/main.ts..."

# Compile from plugin directory so tsconfig.json is picked up
cd "$PLUGIN_DIR"
npx tsc --project tsconfig.json
# Move compiled output from build/ to plugin root
mv build/main.js main.js
rm -rf build
cd "$ROOT"

# Step 3: Inline browser.global.js into ui.html
echo "[3/3] Inlining browser bundle into ui.html..."

BROWSER_JS="$DOCS_DIR/browser.global.js"
TEMPLATE="$PLUGIN_DIR/ui.template.html"
OUTPUT="$PLUGIN_DIR/ui.html"

if [ ! -f "$BROWSER_JS" ]; then
  echo "ERROR: $BROWSER_JS not found. Run 'pnpm build:web' first."
  exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
  echo "ERROR: $TEMPLATE not found."
  exit 1
fi

# Use node to do the replacement (safer than sed for large files)
node -e "
  const fs = require('fs');
  const template = fs.readFileSync('$TEMPLATE', 'utf-8');
  const browserJs = fs.readFileSync('$BROWSER_JS', 'utf-8');
  const output = template.replace('/* BROWSER_GLOBAL_JS */', browserJs);
  fs.writeFileSync('$OUTPUT', output, 'utf-8');
  console.log('  ui.html written (' + Math.round(output.length / 1024) + ' KB)');
"

echo ""
echo "=== Plugin built successfully ==="
echo "  $PLUGIN_DIR/main.js"
echo "  $PLUGIN_DIR/ui.html"
echo "  $PLUGIN_DIR/manifest.json"
echo ""
echo "To test: Figma > Plugins > Development > Import plugin from manifest"
echo "         Select: $PLUGIN_DIR/manifest.json"
