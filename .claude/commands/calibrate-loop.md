Run a calibration debate loop: 4 subagents discuss and apply rule score adjustments.

Input: $ARGUMENTS (fixture path, e.g. `fixtures/material3-kit.json`)

## Instructions

You are the orchestrator. Do NOT make calibration decisions yourself. Only pass data between agents and run deterministic CLI steps.

### Step 1 — Runner (Analysis)

Spawn the `calibration-runner` subagent with this prompt:

> Analyze this fixture: $ARGUMENTS

Wait for the Runner to complete. Capture the analysis summary.
If Runner returns "No issues found", stop here.

### Step 2 — Converter (Code Conversion)

Spawn the `calibration-converter` subagent with this prompt:

> Convert the top 5 nodes from this analysis to code:
> - Analysis JSON: logs/calibration/calibration-analysis.json
> - Original input: $ARGUMENTS
> - Output to: logs/calibration/calibration-conversion.json

Wait for the Converter to complete.

### Step 3 — Evaluation (CLI)

Run this command directly (do NOT spawn a subagent — this is deterministic):

```
pnpm exec drc calibrate-evaluate logs/calibration/calibration-analysis.json logs/calibration/calibration-conversion.json
```

Read the generated report from `logs/calibration/` (the most recent `.md` file).
Extract the proposals (score adjustments and new rule proposals).

If there are zero proposals, stop here and report: "No calibration adjustments needed."

### Step 4 — Critic

Spawn the `calibration-critic` subagent with this prompt:

> Review these calibration proposals:
> (paste the proposals section only — NOT any reasoning chain)

Wait for the Critic to complete. Capture its full critique (APPROVE/REJECT/REVISE per rule).

### Step 5 — Arbitrator

Spawn the `calibration-arbitrator` subagent with this prompt:

> Here are the Runner proposals and Critic reviews. Make final decisions.
>
> Runner proposals:
> (paste the proposals from Step 3)
>
> Critic reviews:
> (paste the Critic's reviews from Step 4)
>
> Fixture: $ARGUMENTS

Wait for the Arbitrator to complete.

### Done

Report the final summary from the Arbitrator.

## Rules

- Each agent must be a SEPARATE subagent call (isolated context).
- Pass only structured data between agents — never raw reasoning.
- The Critic must NOT see the Runner's or Converter's reasoning, only the proposal list.
- Only the Arbitrator may edit `rule-config.ts`.
- Step 3 (evaluation) is a CLI command, NOT a subagent — run it directly with Bash.
