Run a deep calibration debate loop using Figma MCP for precise design context.

Input: $ARGUMENTS (Figma URL with node-id, e.g. `https://www.figma.com/design/ABC123/MyDesign?node-id=1-234`)

## Instructions

You are the orchestrator. Do NOT make calibration decisions yourself. Only pass data between agents and run deterministic CLI steps.

### Step 0 — Setup

Generate the activity log filename. Extract a short name from the URL (fileKey or design name). Build the path:

```
LOG_FILE=logs/activity/YYYY-MM-DD-HH-mm-<name>.md
```

Create the file with a header. Store the exact path — you will paste it verbatim into every subagent prompt below.

### Step 1 — Analysis (CLI)

```
npx canicode calibrate-analyze "$ARGUMENTS" --output logs/calibration/calibration-analysis.json
```

Read `logs/calibration/calibration-analysis.json`. If `issueCount` is 0, stop here.

### Step 2 — Converter

Read the analysis JSON to extract `fileKey`. Parse the root nodeId from the Figma URL.

Spawn a `general-purpose` subagent. In the prompt, include the full converter instructions from `.claude/agents/calibration/converter.md` and add:

```
This is a Figma URL. Use `get_design_context` MCP tool with fileKey and root nodeId.
Figma URL: <paste input URL here>
fileKey: <extracted fileKey>
Root nodeId: <extracted nodeId>
Activity log: <paste LOG_FILE here>
Append a brief summary to this EXACT file. Do NOT write to any other log file.
```

The Converter will implement the ENTIRE design as one HTML page and run visual-compare.

### Step 3 — Gap Analysis

Spawn the `calibration-gap-analyzer` subagent. Provide:
- Screenshot paths: `/tmp/canicode-visual-compare/figma.png`, `/tmp/canicode-visual-compare/code.png`, `/tmp/canicode-visual-compare/diff.png`
- Similarity score from the Converter's output
- Generated HTML path: `/tmp/calibration-output.html`
- Figma URL
- Analysis JSON path: `logs/calibration/calibration-analysis.json`

```
Append your summary to: <paste LOG_FILE here>
```

Gap data is saved to `logs/calibration/gaps/` and accumulates over time for rule discovery.

### Step 4 — Evaluation (CLI)

```
npx canicode calibrate-evaluate logs/calibration/calibration-analysis.json logs/calibration/calibration-conversion.json
```

Read the generated report, extract proposals. If zero proposals, stop.

### Step 5 — Critic

Spawn the `calibration-critic` subagent. The prompt MUST include this exact line:

```
Append your critique to: <paste LOG_FILE here>
```

### Step 6 — Arbitrator

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
