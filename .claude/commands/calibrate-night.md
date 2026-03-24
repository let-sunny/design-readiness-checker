Run nightly calibration across fixtures, then generate a gap-based rule review report.

Input: $ARGUMENTS (optional: fixture directory path, default `fixtures`)

## Instructions

You are the nightly orchestrator. Scan for active fixtures, run `/calibrate-loop` on each, move converged ones to `done/`, then generate the aggregate report.

### Step 0 — Discover fixtures

```bash
npx canicode fixture-list <fixture-dir> --json
```

This returns `{ "active": [...], "done": [...] }`. Use the `active` list. If empty, stop with: "No active fixtures found."

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

After each successful run, use the CLI to check convergence and move:

```bash
npx canicode fixture-done <fixture-path> --run-dir $RUN_DIR
```

This checks `debate.json` for convergence (`applied=0 AND rejected=0` by default) and moves the fixture to `done/`. If the fixture hasn't converged, the command exits with an error — that's expected, just skip and continue.

If the same low-confidence proposals keep getting **rejected** and nothing is applied (issue #14), you can move anyway with **`--lenient-convergence`** (converged when there are no applied/revised decisions, ignoring rejects):

```bash
npx canicode fixture-done <fixture-path> --run-dir $RUN_DIR --lenient-convergence
```

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
- Use `npx canicode fixture-done` for convergence checks and moves — do NOT use `mv` directly.
