Run a calibration pipeline for a single fixture using the explicit orchestration script.

Input: $ARGUMENTS (fixture directory path, e.g. `fixtures/material3-kit`)

## Instructions

Run the calibration script which handles the full pipeline:

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

The script creates a run directory (`logs/calibration/<fixture>--<timestamp>/`) and tracks each step in `index.json`. If the script fails mid-run, resume with:

```bash
npx tsx scripts/calibrate.ts --resume <run-dir>
```

### After the script completes

Read the run directory path from the script output, then report the summary from its `index.json`:
- Which steps completed, skipped, or failed
- Similarity score (from the measure step summary)
- Proposals and decisions (from evaluate/arbitrator summaries)
- Path to the run directory

## Rules

- The script handles all orchestration — do NOT manually run individual steps.
- If the script fails, check `$RUN_DIR/index.json` for the failed step and error message.
- To re-run from a failed step, use `--resume`. Do NOT delete the run directory.
