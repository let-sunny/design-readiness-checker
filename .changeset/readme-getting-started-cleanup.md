---
"canicode": patch
---

Clean up README structure and remove accidentally-tracked `.tmp/`
calibration scratchpad.

- "Getting Started" was duplicating install info that already lived in
  the "Installation — pick one" matrix below it (Cursor in both, Claude
  Code in both, CLI in both). Replaced with a lean two-step "Try it in
  30 seconds" + a single Claude Code roundtrip block — the matrix below
  carries every install scenario.
- Token-safety warning preserved (moved to the top of Installation
  section).
- `.tmp/413-gate` calibration scratchpad (6 files, never gitignored
  because the existing `*.tmp` pattern matched the extension only, not
  the directory) was removed from git history. `.gitignore` now also
  matches `.tmp/`. Confirmed never published to npm (`package.json`
  `files` allow-list excludes it) or gh-pages (HTTP 404).
