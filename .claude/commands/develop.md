Run the automated development pipeline for a GitHub issue.

Input: $ARGUMENTS (issue number, or `--resume <run-dir>` with optional `--from <step>`)

## Instructions

Run the development script:

```bash
npx tsx scripts/develop.ts $ARGUMENTS
```

The script (`scripts/develop.ts`) orchestrates:
1. **Plan** (Agent) — Read issue, explore codebase, produce plan.json
2. **Implement** (Agent) — Write code per plan, commit, produce implement-log.json
3. **Test** (CLI, non-blocking) — `pnpm lint && pnpm test:run`, failures forwarded to Review
4. **Review** (Agent) — Independent review with intent-conflict awareness
5. **Fix** (Agent) — Fix review findings while preserving implementation intent
6. **Verify** (CLI + circuit breaker) — `pnpm lint && pnpm test:run && pnpm build`, auto-retry with re-plan
7. **PR** (CLI) — `gh pr create --draft`

State tracked in `logs/develop/<issue>--<timestamp>/index.json`.

### After the script completes

Report the summary from index.json:
- Which steps completed, skipped, or failed
- Plan summary and task count
- Review verdict and finding counts
- Circuit breaker state (if verify needed retries)
- PR URL (if created)
- Path to the run directory

### Examples

```bash
# New run
npx tsx scripts/develop.ts 236

# Resume from failure
npx tsx scripts/develop.ts --resume logs/develop/236--2026-04-16-1200

# Resume from specific step (name or 1-based index: plan=1, implement=2, test=3, review=4, fix=5, verify=6, pr=7)
npx tsx scripts/develop.ts --resume logs/develop/236--2026-04-16-1200 --from review
```

## Rules

- The script handles all orchestration — do NOT manually run individual steps.
- If the script fails, check `$RUN_DIR/index.json` for the failed step and error.
- To re-run from a specific step, use `--resume` with `--from`.
