Run the calibration pipeline for a single fixture, all active fixtures, or resume a failed run.

Input: $ARGUMENTS (fixture path, `--all`, or `--resume <run-dir>`)

## Instructions

Run the calibration script:

```bash
npx tsx scripts/calibrate.ts $ARGUMENTS
```

The script (`scripts/calibrate.ts`) orchestrates:
1. **Analyze** (CLI) — `calibrate-analyze`
2. **Design tree** (CLI) — generate baseline + 6 stripped design-trees
3. **Convert** (Agent, 7 parallel `claude -p` sessions) — baseline + 6 strip HTMLs
4. **Measure** (CLI) — visual-compare + code-metrics for all 7
5. **Gap Analyze** (Agent, `claude -p`) — if tier=full
6. **Evaluate** (CLI) — `calibrate-evaluate`
7. **Critic** (Agent, `claude -p`) — challenge proposals
8. **Arbitrator** (Agent, `claude -p`) — final decisions, applies to rule-config.ts
9. **Evidence** (CLI) — enrich + prune calibration evidence
10. **Report** (CLI) — aggregate gap report

> `index.json` tracks 14 internal sub-steps (e.g., screenshot capture, strip generation, post-processing split out separately). The 10 stages above are the logical grouping.

### Modes

- **Single fixture**: `npx tsx scripts/calibrate.ts <fixture-path>`
- **All active fixtures**: `npx tsx scripts/calibrate.ts --all` — discovers active fixtures, runs sequentially, checks convergence, runs regression check, generates aggregate report
- **Resume**: `npx tsx scripts/calibrate.ts --resume <run-dir>`

### After the script completes

Report the summary:
- Which steps completed, skipped, or failed
- Similarity score (from the measure step summary)
- Proposals and decisions (from evaluate/arbitrator summaries)
- For `--all` mode: fixtures ran/passed/failed/converged
- Path to the run directory (or aggregate report for `--all`)

## Rules

- The script handles all orchestration — do NOT manually run individual steps.
- If the script fails, check `$RUN_DIR/index.json` for the failed step and error message.
- To re-run from a failed step, use `--resume`. Do NOT delete the run directory.
- Fixtures run sequentially in `--all` mode — each may modify `rule-config.ts`.
