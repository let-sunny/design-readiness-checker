Run a deep calibration debate loop using Figma MCP for precise design context.

Input: $ARGUMENTS (Figma URL with node-id, e.g. `https://www.figma.com/design/ABC123/MyDesign?node-id=1-234`)

## Instructions

You are the orchestrator. Do NOT make calibration decisions yourself. Only pass data between agents and run deterministic CLI steps.

**CRITICAL: You are responsible for writing ALL files to $RUN_DIR. Subagents return text/JSON — you write files. Never rely on a subagent to write to the correct path.**

### Step 0 — Setup

Extract a short name from the URL (fileKey or design name). Create the run directory:

```
RUN_DIR=logs/calibration/<name>--<YYYY-MM-DD-HHMM>/
mkdir -p $RUN_DIR
```

Create `$RUN_DIR/activity.jsonl` and write the first JSON Lines entry:

```json
{"step":"session-start","timestamp":"<ISO8601>","result":"Calibration activity log initialized","durationMs":0}
```

Store the exact `RUN_DIR` path — you will paste it verbatim into every subagent prompt below.

### Step 1 — Analysis (CLI)

```
npx canicode calibrate-analyze "$ARGUMENTS" --run-dir $RUN_DIR
```

Read `$RUN_DIR/analysis.json`. If `issueCount` is 0, stop here.

Check the grade from `scoreReport.overall.grade` and `scoreReport.overall.percentage` and branch into 3 tiers:

- **A or higher (percentage >= 90)**: Full pipeline — proceed to Step 2 (Converter + visual-compare + Gap Analysis)
- **B to B+ (percentage 68-89)**: Converter + visual-compare, but **skip Step 3 (Gap Analysis)**.
- **Below B (percentage < 68)**: Skip Steps 2-3 entirely. Jump to Step 4 (Evaluation).

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Analysis","timestamp":"<ISO8601>","result":"nodes=<N> issues=<N> grade=<X> (<N>%) tier=<full|visual-only|skip>","durationMs":<ms>}
```

If skipping visual-compare entirely (< 68%), also append:
```json
{"step":"Converter","timestamp":"<ISO8601>","result":"SKIPPED — grade below B (<percentage>%)","durationMs":0}
{"step":"Gap Analyzer","timestamp":"<ISO8601>","result":"SKIPPED — no visual-compare data","durationMs":0}
```

If skipping only Gap Analysis (68-89%), append after Converter completes:
```json
{"step":"Gap Analyzer","timestamp":"<ISO8601>","result":"SKIPPED — grade below A (<percentage>%), visual-compare only","durationMs":0}
```

### Step 2 — Converter

Read the analysis JSON to extract `fileKey`. Parse the root nodeId from the Figma URL. Extract a short fixture name from the URL for cache lookup.

Spawn a `general-purpose` subagent. In the prompt, include the full converter instructions from `.claude/agents/calibration/converter.md` and add:

```
This is a Figma URL. Use `get_design_context` MCP tool with fileKey and root nodeId.
Figma URL: <paste input URL here>
fileKey: <extracted fileKey>
Root nodeId: <extracted nodeId>
Run directory: <paste RUN_DIR here>
```

After the Converter returns, **verify** files exist in $RUN_DIR:
```bash
ls $RUN_DIR/conversion.json $RUN_DIR/output.html
```

If `conversion.json` is missing, write it yourself from the Converter's returned summary.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Converter","timestamp":"<ISO8601>","result":"similarity=<N>% difficulty=<level>","durationMs":<ms>}
```

### Step 3 — Gap Analysis

Check whether screenshots were produced:

```bash
test -f $RUN_DIR/figma.png && echo "EXISTS" || echo "MISSING"
```

**If MISSING**: append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Gap Analyzer","timestamp":"<ISO8601>","result":"SKIPPED — figma.png not found","durationMs":0}
```
Proceed to Step 4.

**If EXISTS**: spawn the `calibration-gap-analyzer` subagent. In the prompt include:
- Screenshot paths: `$RUN_DIR/figma.png`, `$RUN_DIR/code.png`, `$RUN_DIR/diff.png`
- Similarity score, HTML path, fixture/URL, analysis JSON path
- The Converter's interpretations list
- **Tell the agent: "Return the gap analysis as JSON. Do NOT write any files."**

After the Gap Analyzer returns, **you** write the JSON to `$RUN_DIR/gaps.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Gap Analyzer","timestamp":"<ISO8601>","result":"gaps=<N> actionable=<N>","durationMs":<ms>}
```

### Step 4 — Evaluation (CLI)

```
npx canicode calibrate-evaluate _ _ --run-dir $RUN_DIR
```

Read `$RUN_DIR/summary.md`, extract proposals.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Evaluation","timestamp":"<ISO8601>","result":"overscored=<N> underscored=<N> validated=<N> proposals=<N>","durationMs":<ms>}
```

If zero proposals, write `$RUN_DIR/debate.json` with skip reason and jump to Step 7:
```json
{"critic": null, "arbitrator": null, "skipped": "zero proposals from evaluation"}
```

### Step 5 — Critic

Spawn the `calibration-critic` subagent. In the prompt:
- Include only the proposal list (NOT the Converter's reasoning)
- **Tell the agent: "Return your reviews as JSON. Do NOT write any files."**

After the Critic returns, **you** write the JSON to `$RUN_DIR/debate.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Critic","timestamp":"<ISO8601>","result":"approved=<N> rejected=<N> revised=<N>","durationMs":<ms>}
```

### Step 6 — Arbitrator

Spawn the `calibration-arbitrator` subagent. In the prompt:
- Include proposals and the Critic's reviews
- **Tell the agent: "Return your decisions as JSON. Only edit rule-config.ts if applying changes. Do NOT write to logs."**

After the Arbitrator returns, **you** update `$RUN_DIR/debate.json` — add the `arbitrator` field.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Arbitrator","timestamp":"<ISO8601>","result":"applied=<N> rejected=<N>","durationMs":<ms>}
```

### Step 7 — Generate Report

```
npx canicode calibrate-gap-report --output logs/calibration/REPORT.md
```

### Done

Report the final summary: similarity, proposals, decisions, and path to `logs/calibration/REPORT.md`.

## Rules

- Each agent must be a SEPARATE subagent call (isolated context).
- Pass only structured data between agents — never raw reasoning.
- The Critic must NOT see the Runner's or Converter's reasoning, only the proposal list.
- Only the Arbitrator may edit `rule-config.ts`.
- Steps 1, 4, 7 are CLI commands — run them directly with Bash.
- **CRITICAL: YOU write all files to $RUN_DIR. Subagents (Gap Analyzer, Critic, Arbitrator) MUST return JSON as text — tell them "Do NOT write any files." You are the only one who writes to $RUN_DIR.**
- **CRITICAL: After each step, append to $RUN_DIR/activity.jsonl yourself. Do NOT rely on subagents to append.**
