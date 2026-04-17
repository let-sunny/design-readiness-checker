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

node -e '
let s = "";
process.stdin.on("data", (c) => (s += c));
process.stdin.on("end", () => {
  try {
    const d = JSON.parse(s);
    if (typeof d.file_path !== "string" || d.file_path.length === 0) return;
    const line = JSON.stringify({
      t: new Date().toISOString(),
      file: d.file_path,
    }) + "\n";
    require("fs").appendFileSync(
      require("path").join(process.env.DEVELOP_RUN_DIR, "implement-progress.jsonl"),
      line,
    );
  } catch {}
})' <<< "$TOOL_INPUT" 2>/dev/null

exit 0
