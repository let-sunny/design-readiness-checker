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

A fixture has converged ONLY when `applied=0` AND `rejected=0` (no changes and no disagreements):

```bash
mkdir -p <fixture-dir>/done
mv <fixture-path> <fixture-dir>/done/
```

If `applied=0` but `rejected>0`, the fixture is still **active** — proposals are being debated. Do NOT move it to `done/`.

Report which fixtures were moved to `done/`.

### Step 2.5 — Regression check

After all fixtures are processed, re-run `calibrate-evaluate` for each completed fixture to verify that score changes from earlier fixtures didn't regress later ones:

```bash
for dir in logs/calibration/<latest-run-dirs>; do
  npx canicode calibrate-evaluate _ _ --run-dir "$dir" 2>/dev/null
done
```

Compare the fresh evaluation output with the original. If a previously **validated** rule now shows as **overscored** or **underscored**, log a warning:

```
⚠ Regression: rule <ruleId> was validated in <fixture-A> but is now <type> after changes from <fixture-B>
```

This is informational — do not revert changes, just report regressions in the summary.

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
- Only move a fixture to `done/` when `applied=0 AND rejected=0` — meaning all proposals were validated with no disagreements.
