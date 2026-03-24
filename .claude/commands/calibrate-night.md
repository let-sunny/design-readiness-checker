Run nightly calibration across fixtures, then generate a gap-based rule review report.

Input: $ARGUMENTS (optional: fixture directory path, default `fixtures`)

## Instructions

You are the nightly orchestrator. Scan for active fixtures, run `/calibrate-loop` on each, move converged ones to `done/`, then generate the aggregate report.

### Step 0 — Discover fixtures

Determine the fixture directory from the input (default: `fixtures`).

```bash
ls <fixture-dir>/*/data.json
```

These are the **active** fixture directories to calibrate. Fixtures in `<fixture-dir>/done/` have already converged and are skipped.

If no fixture directories found, stop with a message: "No active fixtures found."

### Step 1 — Run calibration for each fixture

For each active fixture, run `/calibrate-loop` with that fixture path.

- Run them **sequentially** (not in parallel) — each one modifies `rule-config.ts`
- If one fixture fails, log the failure and continue to the next
- Track pass/fail counts

After each fixture, briefly report:
```
[1/6] fixtures/material3-kit — Complete (applied=2)
[2/6] fixtures/simple-ds — Complete (applied=0, converged)
[3/6] fixtures/figma-ui3-kit — Failed (reason)
```

### Step 2 — Move converged fixtures

After each successful run, check the run's `debate.json` for the Arbitrator's summary.

If `applied=0` (no score changes were made), this fixture has converged:

```bash
mkdir -p <fixture-dir>/done
mv <fixture-path> <fixture-dir>/done/
```

Report which fixtures were moved to `done/`.

### Step 3 — Generate aggregate report

After all fixtures are done, build and run the gap report:

```bash
pnpm build
npx canicode calibrate-gap-report --output logs/calibration/REPORT.md
```

### Step 4 — Summary

Report:
- How many fixtures ran / passed / failed / converged
- Which fixtures were moved to `done/`
- Which fixtures remain active
- Where the aggregate report is: `logs/calibration/REPORT.md`
- Remind: "Review the report, then run `/add-rule` when you want to implement a new rule."

## Rules

- Run fixtures sequentially, not in parallel.
- If a fixture fails, continue to the next — don't stop the whole run.
- Each `/calibrate-loop` creates its own run directory under `logs/calibration/`.
- Do NOT modify source files yourself — `/calibrate-loop` handles that via its agent pipeline.
- Only move a fixture to `done/` when `applied=0` — meaning the Arbitrator made zero changes.
