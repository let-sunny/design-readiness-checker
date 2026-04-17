#!/bin/bash
# PostToolUse hook — writes a heartbeat line to implement-progress.jsonl when
# running inside a /develop Implementer sub-agent.
#
# Guarded by $DEVELOP_RUN_DIR: short-circuits to no-op in any other session.
# Hook failures never block the tool call (always exits 0).
#
# The orchestrator (scripts/develop.ts) reads this file on timeout via
# parseHeartbeat() to synthesize a partial implement-log.json.

set +e

[ -n "$DEVELOP_RUN_DIR" ] || exit 0

FILE=$(node -e 'let s=""; process.stdin.on("data",c=>s+=c); process.stdin.on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(d.file_path||"")}catch{}})' <<< "$TOOL_INPUT" 2>/dev/null)

[ -n "$FILE" ] || exit 0

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"t":"%s","file":"%s"}\n' "$TS" "$FILE" >> "$DEVELOP_RUN_DIR/implement-progress.jsonl" 2>/dev/null

exit 0
