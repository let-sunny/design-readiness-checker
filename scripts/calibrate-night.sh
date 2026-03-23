#!/usr/bin/env bash
set -euo pipefail

# Nightly calibration: scan fixtures directory, run calibration, move converged fixtures to done/.
#
# Each /calibrate-loop invocation creates its own run directory under logs/calibration/<name>--<timestamp>/.
#
# Phase 1 — For each active fixture (fixtures/*.json): run calibration.
#           If applied=0 (converged), move fixture to fixtures/done/.
# Phase 2 — canicode calibrate-gap-report → logs/calibration/REPORT.md
# Phase 3 — Manual: review the report, then run /add-rule in Claude Code.
#
# Usage:
#   ./scripts/calibrate-night.sh                        # scan fixtures/ dir
#   ./scripts/calibrate-night.sh --fixture-dir path/    # custom fixture directory
#   ./scripts/calibrate-night.sh --deep                 # uses /calibrate-loop-deep
#
# Optional:
#   CALIBRATE_SKIP_PHASE2=1     — only Phase 1 (no gap report)
#   CALIBRATE_SKIP_BUILD=1      — skip pnpm build before Phase 2
#   CALIBRATE_AUTO_COMMIT=1     — git commit + push at end

COMMAND="/calibrate-loop"
FIXTURE_DIR="fixtures"

for arg in "$@"; do
  case "$arg" in
    --deep)
      COMMAND="/calibrate-loop-deep"
      ;;
    --fixture-dir)
      shift
      FIXTURE_DIR="$1"
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$PROJECT_ROOT/.env"
  set +a
fi

# Discover active fixtures (skip done/)
FIXTURES=()
for f in "$FIXTURE_DIR"/*.json; do
  [ -f "$f" ] && FIXTURES+=("$f")
done

if [ ${#FIXTURES[@]} -eq 0 ]; then
  echo "No active fixtures found in $FIXTURE_DIR/*.json"
  echo "All fixtures may have converged (moved to $FIXTURE_DIR/done/)."
  exit 0
fi

# Nightly-level log (tracks the orchestration itself)
NIGHTLY_LOG_DIR="logs/activity"
mkdir -p "$NIGHTLY_LOG_DIR"

DATETIME=$(date +%Y-%m-%d-%H-%M)
NIGHTLY_LOG="$NIGHTLY_LOG_DIR/${DATETIME}-nightly.md"

log() {
  local timestamp
  timestamp=$(date +%H:%M)
  echo "## $timestamp — $1" >> "$NIGHTLY_LOG"
  echo "" >> "$NIGHTLY_LOG"
  if [ -n "${2:-}" ]; then
    echo "$2" >> "$NIGHTLY_LOG"
    echo "" >> "$NIGHTLY_LOG"
  fi
}

echo "# Calibration night — $DATETIME" > "$NIGHTLY_LOG"
echo "" >> "$NIGHTLY_LOG"

if [ -z "${CAFFEINATED:-}" ]; then
  echo "Wrapping in caffeinate to prevent sleep..."
  CAFFEINATED=1 exec caffeinate -i "$0" "$@"
fi

TOTAL_START=$SECONDS
BEFORE_HASH=$(git hash-object src/rules/rule-config.ts 2>/dev/null || echo "none")

log "Phase 1 started" "Command: $COMMAND | Active fixtures: ${#FIXTURES[@]}"

echo "Phase 1: calibrate ${#FIXTURES[@]} active fixture(s) with ${COMMAND}"
echo "  (converged fixtures in $FIXTURE_DIR/done/ are skipped)"
echo ""

PASS=0
FAIL=0
CONVERGED=0
CONVERGED_LIST=""

for i in "${!FIXTURES[@]}"; do
  fixture="${FIXTURES[$i]}"
  idx=$((i + 1))
  base="$(basename "$fixture" .json)"

  echo "  [$idx/${#FIXTURES[@]}] $fixture"
  log "Fixture $idx start" "File: $fixture"

  RUN_START=$SECONDS
  if claude --dangerously-skip-permissions "$COMMAND" "$fixture"; then
    DURATION=$(( SECONDS - RUN_START ))

    # Check if converged: find the latest run dir for this fixture and check debate.json
    LATEST_RUN_DIR=$(ls -d logs/calibration/"${base}"--* 2>/dev/null | sort | tail -1)
    APPLIED="?"
    if [ -n "$LATEST_RUN_DIR" ] && [ -f "$LATEST_RUN_DIR/debate.json" ]; then
      # Extract applied count from arbitrator summary
      APPLIED=$(python3 -c "
import json, sys
try:
    d = json.load(open('$LATEST_RUN_DIR/debate.json'))
    s = d.get('arbitrator', {}).get('summary', '')
    # Parse 'applied=N' from summary string
    for part in s.split():
        if part.startswith('applied='):
            print(part.split('=')[1])
            sys.exit(0)
    print('?')
except: print('?')
" 2>/dev/null || echo "?")
    fi

    if [ "$APPLIED" = "0" ]; then
      # Converged — move fixture to done/
      mkdir -p "$FIXTURE_DIR/done"
      mv "$fixture" "$FIXTURE_DIR/done/"
      CONVERGED=$((CONVERGED + 1))
      CONVERGED_LIST="${CONVERGED_LIST}    → $fixture (moved to done/)\n"
      log "Fixture $idx converged" "Duration: ${DURATION}s — moved to done/"
      echo "    Complete (${DURATION}s) — converged, moved to done/"
    else
      log "Fixture $idx complete" "Duration: ${DURATION}s — applied=$APPLIED"
      echo "    Complete (${DURATION}s) — applied=$APPLIED"
    fi
    PASS=$((PASS + 1))
  else
    DURATION=$(( SECONDS - RUN_START ))
    log "Fixture $idx failed" "Duration: ${DURATION}s"
    echo "    Failed (${DURATION}s)"
    FAIL=$((FAIL + 1))
  fi
done

PHASE1_DURATION=$(( SECONDS - TOTAL_START ))
log "Phase 1 finished" "Passed: $PASS | Failed: $FAIL | Converged: $CONVERGED | Duration: ${PHASE1_DURATION}s"

echo ""
echo "Phase 1 done: ${PASS} passed, ${FAIL} failed, ${CONVERGED} converged (${PHASE1_DURATION}s)"
if [ -n "$CONVERGED_LIST" ]; then
  echo -e "$CONVERGED_LIST"
fi
echo ""

GAP_REPORT_PATH="logs/calibration/REPORT.md"

if [ -z "${CALIBRATE_SKIP_PHASE2:-}" ]; then
  echo "Phase 2: gap rule review report → ${GAP_REPORT_PATH}"

  if [ -z "${CALIBRATE_SKIP_BUILD:-}" ]; then
    pnpm build
  fi

  if [ ! -f dist/cli/index.js ]; then
    echo "Error: dist/cli/index.js not found. Run pnpm build or unset CALIBRATE_SKIP_BUILD."
    exit 1
  fi

  node dist/cli/index.js calibrate-gap-report --output "$GAP_REPORT_PATH"

  log "Phase 2 complete" "Report: ${GAP_REPORT_PATH}"
  echo ""
  echo "Phase 2 done."
  echo "  Report: ${GAP_REPORT_PATH}"
  echo ""
  echo "Phase 3 (manual): read the report, then run /add-rule in Claude Code when you add a rule."
else
  echo "Phase 2 skipped (CALIBRATE_SKIP_PHASE2=1)."
fi

TOTAL_DURATION=$(( SECONDS - TOTAL_START ))
REMAINING=$(ls "$FIXTURE_DIR"/*.json 2>/dev/null | wc -l | tr -d ' ')
log "Nightly finished" "Total: ${TOTAL_DURATION}s | Remaining active: $REMAINING | Converged: $CONVERGED"

echo "Log: $NIGHTLY_LOG"
echo "Active fixtures remaining: $REMAINING"
echo "Total time: ${TOTAL_DURATION}s"

AFTER_HASH=$(git hash-object src/rules/rule-config.ts 2>/dev/null || echo "none")
HAS_CHANGES=false
if [ "$BEFORE_HASH" != "$AFTER_HASH" ]; then
  HAS_CHANGES=true
fi

if [ "${CALIBRATE_AUTO_COMMIT:-}" = "1" ]; then
  if [ "$HAS_CHANGES" = true ] || [ -n "$(git status --porcelain logs/ 2>/dev/null)" ]; then
    git add src/rules/rule-config.ts logs/ || true
    if git diff --cached --quiet; then
      echo "No staged changes to commit."
    else
      git commit -m "chore: nightly calibration — ${DATETIME}

Phase 1: ${PASS}/${#FIXTURES[@]} passed, ${CONVERGED} converged
Report: ${GAP_REPORT_PATH}"
      git push
      echo "Committed and pushed calibration changes."
    fi
  else
    echo "No rule-config or logs changes to commit."
  fi
fi
