Run a calibration debate loop using local fixture JSON files. No Figma MCP needed.

Input: $ARGUMENTS (fixture path, e.g. `fixtures/material3-kit.json`)

## Instructions

You are the orchestrator. Do NOT make calibration decisions yourself. Only pass data between agents and run deterministic CLI steps.

### Step 0 — Setup

Generate the activity log filename. Extract the fixture name (e.g. `fixtures/material3-kit.json` → `material3-kit`). Build the path:

```
LOG_FILE=logs/activity/YYYY-MM-DD-HH-mm-<fixture-name>.md
```

Create the file with a header. Store the exact path — you will paste it verbatim into every subagent prompt below.

### Step 1 — Analysis (CLI)

```
npx drc calibrate-analyze $ARGUMENTS --output logs/calibration/calibration-analysis.json
```

Read `logs/calibration/calibration-analysis.json`. If `issueCount` is 0, stop here.

### Step 2 — Converter

Spawn a `general-purpose` subagent. In the prompt, include the full converter instructions from `.claude/agents/calibration-converter.md` and add:

```
Activity log: <paste LOG_FILE here>
Append a brief summary to this EXACT file. Do NOT write to any other log file.
```

### Step 3 — Evaluation (CLI)

```
npx drc calibrate-evaluate logs/calibration/calibration-analysis.json logs/calibration/calibration-conversion.json
```

Read the generated report, extract proposals. If zero proposals, stop.

### Step 4 — Critic

Spawn the `calibration-critic` subagent. The prompt MUST include this exact line:

```
Append your critique to: <paste LOG_FILE here>
```

### Step 5 — Arbitrator

Spawn the `calibration-arbitrator` subagent. The prompt MUST include this exact line:

```
Activity log: <paste LOG_FILE here>
```

### Done

Report the final summary from the Arbitrator.

## Rules

- Each agent must be a SEPARATE subagent call (isolated context).
- Pass only structured data between agents — never raw reasoning.
- The Critic must NOT see the Runner's or Converter's reasoning, only the proposal list.
- Only the Arbitrator may edit `rule-config.ts`.
- Steps 1 and 3 are CLI commands — run them directly with Bash.
- **CRITICAL**: Every subagent prompt MUST contain the exact LOG_FILE path. Do NOT use placeholders. Paste the actual path string.
