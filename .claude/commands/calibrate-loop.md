Autonomously calibrate rule scores by running a 3-subagent debate loop against a Figma fixture file.

Input: $ARGUMENTS (a JSON fixture path, e.g. fixtures/material3-kit.json)

---

## Step 1 — Runner (subagent, isolated worktree)

Spawn a subagent with `isolation: "worktree"` to run calibration analysis.

The Runner subagent should:
1. Run `pnpm exec drc calibrate-run $ARGUMENTS --max-nodes 5`
2. Read the generated report from `logs/calibration/`
3. Read `src/rules/rule-config.ts` for current scores
4. Extract ALL score adjustment proposals as a JSON array:

```json
[
  {
    "ruleId": "...",
    "currentScore": -10,
    "proposedScore": -5,
    "currentSeverity": "blocking",
    "proposedSeverity": "risk",
    "confidence": "medium",
    "supportingCases": 2,
    "reasoning": "..."
  }
]
```

5. Return the JSON array. If zero proposals, return `[]`.

Log to `logs/activity/agent-activity-YYYY-MM-DD.md`:
```
## HH:mm — Runner
- 제안 목록:
  - ruleId: current→proposed, confidence (N cases). reasoning
```

---

## Step 2 — Critic (subagent, read-only)

Spawn a SEPARATE subagent to review the Runner's proposals.
Pass ONLY the Runner's JSON output — NOT the Runner's reasoning process.

The Critic subagent should apply these rejection rules strictly:

**Rule 1 — Insufficient evidence:**
If `confidence` is `"low"` AND `supportingCases < 2` → REJECT
Reason: "Insufficient evidence — only N case(s) with low confidence."

**Rule 2 — Excessive change magnitude:**
If `abs(proposedScore - currentScore) > abs(currentScore) * 0.5` → REJECT
Reason: "Change magnitude exceeds 50% of current score (current: X, proposed: Y, delta: Z)."

**Rule 3 — Severity jump without strong evidence:**
If `proposedSeverity` differs from `currentSeverity` AND `confidence` is not `"high"` → REJECT
Reason: "Severity change requires high confidence."

Return a JSON array:
```json
[
  { "ruleId": "...", "verdict": "ACCEPT" },
  { "ruleId": "...", "verdict": "REJECT", "reason": "..." }
]
```

Log to `logs/activity/agent-activity-YYYY-MM-DD.md`:
```
## HH:mm — Critic
- 반박:
  - ruleId: REJECT — reason
- 동의:
  - ruleId: ACCEPT
```

---

## Step 3 — Arbitrator (subagent, can edit files)

Spawn a SEPARATE subagent with the Runner's proposals AND the Critic's verdicts.

The Arbitrator should:

**If Critic accepted:** Apply the proposal as-is.

**If Critic rejected:**
- **Compromise**: Use midpoint `round((currentScore + proposedScore) / 2)` if Runner's reasoning is strong but Critic's concern is valid
- **Keep current**: If Critic's rejection is compelling
- **Override Critic**: If Runner has 3+ supporting cases and rejection was only about magnitude

Then:
1. Edit `src/rules/rule-config.ts` with approved changes
2. Run `pnpm test:run` — if fails, revert and report
3. Run `pnpm lint` — if fails, revert and report
4. If both pass, commit:
```
chore: calibrate rule scores via agent loop

Adjustments:
- ruleId: old → new (reason)

Source: calibration against <input>
```

Log to `logs/activity/agent-activity-YYYY-MM-DD.md`:
```
## HH:mm — Arbitrator
- 최종 결정:
  - ruleId: current → newScore — reason
  - ruleId: KEEP — reason
```

---

## Orchestrator rules

- You are the orchestrator. Do NOT make calibration decisions yourself.
- Spawn each agent as a SEPARATE subagent so their contexts don't leak.
- Pass only structured data (JSON) between agents — not reasoning chains.
- If Runner returns `[]`, stop and report: "No calibration adjustments needed."
- If any step fails, log the error and stop.

---

## Error Handling

- If `drc calibrate-run` fails, report the error and stop.
- If tests/lint fail after applying changes, revert `rule-config.ts` and report.
- Never force-push or amend existing commits.
