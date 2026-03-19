#!/usr/bin/env bash
set -euo pipefail

# Nightly calibration script
# Runs /calibrate-loop against Figma files provided via environment variables.
# Usage:
#   export CALIBRATE_URL_1="https://www.figma.com/design/..."
#   export CALIBRATE_URL_2="https://www.figma.com/design/..."
#   caffeinate -i ./scripts/calibrate-night.sh

# ── Validate env vars ───────────────────────────────────────────────

if [ -z "${CALIBRATE_URL_1:-}" ]; then
  echo "Error: CALIBRATE_URL_1 is not set."
  echo ""
  echo "Usage:"
  echo "  export CALIBRATE_URL_1=\"https://www.figma.com/design/.../...\""
  echo "  export CALIBRATE_URL_2=\"https://www.figma.com/design/.../...\""
  echo "  caffeinate -i ./scripts/calibrate-night.sh"
  exit 1
fi

if [ -z "${CALIBRATE_URL_2:-}" ]; then
  echo "Error: CALIBRATE_URL_2 is not set."
  echo ""
  echo "Usage:"
  echo "  export CALIBRATE_URL_1=\"https://www.figma.com/design/.../...\""
  echo "  export CALIBRATE_URL_2=\"https://www.figma.com/design/.../...\""
  echo "  caffeinate -i ./scripts/calibrate-night.sh"
  exit 1
fi

URLS=("$CALIBRATE_URL_1" "$CALIBRATE_URL_2")

# ── Logging setup ───────────────────────────────────────────────────

LOG_DIR="logs"
mkdir -p "$LOG_DIR"

DATE=$(date +%Y-%m-%d)
LOG_FILE="$LOG_DIR/agent-activity-$DATE.md"

log() {
  local timestamp
  timestamp=$(date +%H:%M)
  echo "## $timestamp — $1" >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"
  if [ -n "${2:-}" ]; then
    echo "$2" >> "$LOG_FILE"
    echo "" >> "$LOG_FILE"
  fi
}

if [ ! -f "$LOG_FILE" ]; then
  echo "# Agent Activity Log — $DATE" > "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

# ── Prevent sleep (re-exec under caffeinate if not already) ─────────

if [ -z "${CAFFEINATED:-}" ]; then
  echo "Wrapping in caffeinate to prevent sleep..."
  CAFFEINATED=1 exec caffeinate -i "$0" "$@"
fi

# ── Run calibration loop ───────────────────────────────────────────

log "Nightly Calibration Started" "Running ${#URLS[@]} files."
echo "Starting nightly calibration (${#URLS[@]} files)..."
echo ""

TOTAL_START=$SECONDS
PASS=0
FAIL=0

for i in "${!URLS[@]}"; do
  url="${URLS[$i]}"
  idx=$((i + 1))

  echo "[$idx/${#URLS[@]}] $url"
  log "Calibration Loop Start — File $idx" "URL: $url"

  RUN_START=$SECONDS

  if claude /calibrate-loop "$url"; then
    DURATION=$(( SECONDS - RUN_START ))
    log "Calibration Loop Complete — File $idx" "Duration: ${DURATION}s"
    echo "  Complete (${DURATION}s)"
    PASS=$((PASS + 1))
  else
    DURATION=$(( SECONDS - RUN_START ))
    log "Calibration Loop Failed — File $idx" "Duration: ${DURATION}s — exit code: $?"
    echo "  Failed (${DURATION}s)"
    FAIL=$((FAIL + 1))
  fi

  echo ""
done

# ── Commit & push ──────────────────────────────────────────────────

TOTAL_DURATION=$(( SECONDS - TOTAL_START ))

if git diff --quiet src/rules/rule-config.ts 2>/dev/null; then
  log "Nightly Calibration Complete — No Changes" "Total: ${TOTAL_DURATION}s | Passed: $PASS | Failed: $FAIL"
  echo "No rule-config.ts changes to commit."
else
  git add src/rules/rule-config.ts "$LOG_FILE"
  git commit -m "chore: nightly calibration run ($DATE)

Passed: $PASS / ${#URLS[@]}, Failed: $FAIL
Total duration: ${TOTAL_DURATION}s"
  git push
  log "Nightly Calibration Complete — Pushed" "Total: ${TOTAL_DURATION}s | Passed: $PASS | Failed: $FAIL | Commit pushed."
  echo "Changes committed and pushed."
fi

echo "Nightly calibration done."
echo "  Total: ${TOTAL_DURATION}s"
echo "  Passed: $PASS / ${#URLS[@]}"
echo "  Log: $LOG_FILE"
