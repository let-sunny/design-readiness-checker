Autonomously calibrate rule scores by running a 3-agent debate loop against a real Figma file.

Input: $ARGUMENTS (a Figma URL or JSON fixture path)

---

## Step 1 — Runner Agent

Run the calibration pipeline and extract proposals.

1. Execute: `pnpm exec drc calibrate analyze $ARGUMENTS`
2. Read the output file `calibration-analysis.json`
3. Read the most recent `CALIBRATION_REPORT.md` if it exists from a prior run
4. Read `logs/` for the most recent `agent-activity-*.md` file
5. Extract the list of score adjustment proposals. For each proposal, capture:
   - `ruleId`
   - `currentScore`
   - `proposedScore`
   - `currentSeverity`
   - `proposedSeverity` (if changed)
   - `confidence` (high / medium / low)
   - `supportingCases` (number)
   - `reasoning`
6. If there are zero proposals, stop and report: "No calibration adjustments needed."
7. Log the Runner output to `logs/agent-activity-YYYY-MM-DD.md` under `## HH:mm — Runner` with the full proposal list.

---

## Step 2 — Critic Agent

Review each Runner proposal and apply rejection heuristics.

For each proposal, evaluate:

**Rejection Rule 1 — Insufficient evidence:**
If `confidence` is `"low"` AND `supportingCases < 2`, reject the proposal.
Reason: "Insufficient evidence — only N case(s) with low confidence."

**Rejection Rule 2 — Excessive change magnitude:**
If `abs(proposedScore - currentScore) > abs(currentScore) * 0.5`, reject the proposal.
Reason: "Change magnitude exceeds 50% of current score (current: X, proposed: Y, delta: Z)."

**Rejection Rule 3 — Severity jump without strong evidence:**
If `proposedSeverity` differs from `currentSeverity` AND `confidence` is not `"high"`, reject the proposal.
Reason: "Severity change requires high confidence."

For each proposal, output one of:
- `ACCEPT` — passes all checks
- `REJECT(reason)` — fails one or more checks
- `REVIEW` — borderline case, needs visual confirmation

If any proposal is marked `REVIEW`, re-run with visual comparison:
`pnpm exec drc calibrate analyze $ARGUMENTS`
Then re-evaluate the `REVIEW` items using the visual comparison data to make a final `ACCEPT` or `REJECT` decision.

Log the Critic output to `logs/agent-activity-YYYY-MM-DD.md` under `## HH:mm — Critic` with the verdict for each proposal.

---

## Step 3 — Arbitrator Agent

Resolve disagreements between Runner and Critic.

For each proposal:

**Case A — Both agree (Runner proposed, Critic accepted):**
Apply the proposal as-is.

**Case B — Critic rejected:**
Choose one of:
- **Compromise**: Use the midpoint `round((currentScore + proposedScore) / 2)` if the Runner's reasoning is strong but the Critic's concern is valid.
- **Keep current**: If the Critic's rejection reason is compelling, keep the current score unchanged.
- **Override Critic**: If the Runner provided 3+ supporting cases and the rejection was only about magnitude, apply the original proposal.

For each decision, write exactly one line of reasoning. Keep it factual.

Output a final list of changes to apply:
```
ruleId | currentScore → newScore | severity change | reason
```

Log the Arbitrator output to `logs/agent-activity-YYYY-MM-DD.md` under `## HH:mm — Arbitrator` with the decision table.

---

## Step 4 — Apply Changes

1. Read `src/rules/rule-config.ts`
2. For each approved change from the Arbitrator:
   - Update the `score` value for the rule
   - Update the `severity` value if changed
3. Run `pnpm test:run` to verify no tests break
4. Run `pnpm lint` to verify TypeScript compiles
5. If either fails, revert changes and report the failure
6. If both pass, create a commit:

```
chore: calibrate rule scores via agent loop

Adjustments:
- <ruleId>: <old> → <new> (<reason>)
- <ruleId>: <old> → <new> (<reason>)
...

Source: calibration against <input>
```

---

## Step 5 — Log Summary

Append to `logs/agent-activity-YYYY-MM-DD.md`:

```
## HH:mm — Applied Changes

| Rule | Before | After | Severity | Reason |
|------|--------|-------|----------|--------|
| ... | ... | ... | ... | ... |

Total: N rules adjusted, M proposals rejected, K kept unchanged.
```

---

## Error Handling

- If `drc calibrate analyze` fails, report the error and stop.
- If a test or lint failure occurs after applying changes, revert all changes to `rule-config.ts` and report which rule change caused the issue.
- Never force-push or amend existing commits.
- If the Figma URL requires a token and `FIGMA_TOKEN` is not set, stop and ask the user.
