#!/usr/bin/env bash
# Stage Claude Code skill files into a top-level `skills/` directory for the npm tarball.
# The three skills (canicode, canicode-gotchas, canicode-roundtrip) are authored under
# `.claude/skills/` — we copy them to `skills/<name>/` because `.claude/` is the harness
# directory (also contains agents/, commands/, docs/, worktrees/) and shipping it to npm
# would leak internals. `skills/` is listed in package.json `files`.
#
# NOTE: `canicode-roundtrip/helpers.js` is produced by `pnpm build:roundtrip` (tsup IIFE
# bundle). Run that before this script if invoking standalone. `pnpm build` already chains
# both in the right order.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.claude/skills"
DEST="$ROOT/skills"

SKILLS=(canicode canicode-gotchas canicode-roundtrip)

echo "=== Bundling Claude Code skills for npm ==="

rm -rf "$DEST"
mkdir -p "$DEST"

for name in "${SKILLS[@]}"; do
  if [ ! -d "$SRC/$name" ]; then
    echo "ERROR: source skill dir missing: $SRC/$name"
    exit 1
  fi
  cp -R "$SRC/$name" "$DEST/$name"
  echo "  copied $name"
done

# Verify required files landed
REQUIRED=(
  "$DEST/canicode/SKILL.md"
  "$DEST/canicode-gotchas/SKILL.md"
  "$DEST/canicode-roundtrip/SKILL.md"
  "$DEST/canicode-roundtrip/helpers.js"
)

for f in "${REQUIRED[@]}"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: expected bundled file missing: $f"
    echo "  (if canicode-roundtrip/helpers.js is missing, run 'pnpm build:roundtrip' first)"
    exit 1
  fi
done

echo "=== Skills bundled into $DEST ==="
