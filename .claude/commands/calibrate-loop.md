Run a calibration debate loop using local fixture directories.

Input: $ARGUMENTS (fixture directory path, e.g. `fixtures/material3-kit`)

## Instructions

You are the orchestrator. Do NOT make calibration decisions yourself. Only pass data between agents and run deterministic CLI steps.

**CRITICAL: You are responsible for writing ALL files to $RUN_DIR. Subagents return text/JSON — you write files. Never rely on a subagent to write to the correct path.**

### Step 0 — Setup

Extract the fixture name from the directory (e.g. `fixtures/material3-kit` → `material3-kit`). Create the run directory:

```
RUN_DIR=logs/calibration/<fixture-name>--<YYYY-MM-DD-HHMM>/
mkdir -p $RUN_DIR
```

Create `$RUN_DIR/activity.jsonl` and write the first JSON Lines entry:

```json
{"step":"session-start","timestamp":"<ISO8601>","result":"Calibration activity log initialized","durationMs":0}
```

Store the exact `RUN_DIR` path — you will paste it verbatim into every subagent prompt below.

### Step 1 — Analysis (CLI)

```
npx canicode calibrate-analyze $ARGUMENTS --run-dir $RUN_DIR
```

Read `$RUN_DIR/analysis.json`. If `issueCount` is 0, stop here.

Read the `calibrationTier` field from `analysis.json`. The CLI determines the tier based on grade percentage. Branch accordingly:

- **`"full"`**: Full pipeline — proceed to Step 2 (Converter + visual-compare + Gap Analysis)
- **`"visual-only"`**: Converter + visual-compare, but **skip Step 3 (Gap Analysis)**. Gap analysis on diff images is only meaningful at high similarity.

**Always run the Converter** regardless of tier. Low-scoring designs need score validation the most.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Analysis","timestamp":"<ISO8601>","result":"nodes=<N> issues=<N> grade=<X> (<N>%) tier=<calibrationTier>","durationMs":<ms>}
```

If tier is `"visual-only"`, append after Converter completes:
```json
{"step":"Gap Analyzer","timestamp":"<ISO8601>","result":"SKIPPED — tier=visual-only, gap analysis skipped","durationMs":0}
```

### Step 2 — Converter (HTML Generation)

Read the analysis JSON to extract `fileKey`. Also determine the root nodeId — if the input was a Figma URL, parse the node-id from it. If it was a fixture, use the document root id.

**Copy fixture screenshot**: The fixture directory contains `screenshot.png` (saved by `save-fixture`). Copy it to the run directory so `visual-compare` can reuse it without API calls:

```bash
cp <fixture-dir>/screenshot.png $RUN_DIR/figma.png
```

**Prepare stripped design-trees** (deterministic — no LLM):

Generate the baseline design-tree first, then strip it for each ablation type:

```bash
# Generate baseline design-tree
npx canicode design-tree <fixture-path> --output $RUN_DIR/design-tree.txt

# Create stripped directory
mkdir -p $RUN_DIR/stripped

# Generate stripped versions (deterministic text processing; default = all DESIGN_TREE_INFO_TYPES)
npx canicode design-tree-strip $RUN_DIR/design-tree.txt \
  --output-dir $RUN_DIR/stripped
```

This produces 6 files in `$RUN_DIR/stripped/` (`DESIGN_TREE_INFO_TYPES` in `src/core/design-tree/strip.ts`):
- `layout-direction-spacing.txt`
- `size-constraints.txt`
- `component-references.txt`
- `node-names-hierarchy.txt`
- `variable-references.txt`
- `style-references.txt`

Spawn a `general-purpose` subagent. In the prompt, include the full converter instructions from `.claude/agents/calibration/converter.md` and add:

```
Fixture directory: <paste input path here>
fileKey: <extracted fileKey>
Root nodeId: <extracted nodeId>
Run directory: <paste RUN_DIR here>

design-tree.txt is already in the run directory.
Stripped design-trees are pre-generated in $RUN_DIR/stripped/.

Your job: implement baseline HTML (output.html) + 6 strip HTMLs (stripped/<type>.html),
then write converter-assessment.json with ruleImpactAssessment + uncoveredStruggles.
Do NOT run visual-compare, html-postprocess, or code-metrics — the orchestrator handles measurements.
```

After the Converter returns, **verify** these files exist in $RUN_DIR:
```bash
ls $RUN_DIR/output.html $RUN_DIR/converter-assessment.json
ls $RUN_DIR/stripped/layout-direction-spacing.html \
   $RUN_DIR/stripped/size-constraints.html \
   $RUN_DIR/stripped/component-references.html \
   $RUN_DIR/stripped/node-names-hierarchy.html \
   $RUN_DIR/stripped/variable-references.html \
   $RUN_DIR/stripped/style-references.html
```

If any file is missing, log a warning naming the missing files but continue.

**Record token usage**: The subagent result includes `total_tokens`, `tool_uses`, `duration_ms` in usage metadata. Store these for later inclusion in conversion.json.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Converter","timestamp":"<ISO8601>","result":"baseline + 6 strips written, tokens=<N>","durationMs":<ms>}
```

### Step 2.5 — Measurements (CLI — no LLM)

Run all measurements on the Converter's HTML outputs. This is deterministic — no subagent needed.

**Baseline measurements:**

```bash
# Post-process HTML (sanitize + inject local fonts)
npx canicode html-postprocess $RUN_DIR/output.html

# Visual comparison (baseline)
npx canicode visual-compare $RUN_DIR/output.html \
  --figma-screenshot $RUN_DIR/figma.png \
  --output $RUN_DIR
```

Record the `similarity` from visual-compare JSON stdout.

**Responsive comparison** (if expanded screenshot exists):

List `screenshot-*.png` in the fixture directory. Extract the width number from each filename, sort numerically. If 2+ screenshots exist, the smallest width is the original and the largest is the expanded viewport.

```bash
# Example: screenshot-1200.png (original), screenshot-1920.png (expanded)
SCREENSHOTS=($(ls <fixture-path>/screenshot-*.png | sort -t- -k2 -n))
LARGEST="${SCREENSHOTS[-1]}"
LARGEST_WIDTH=$(echo "$LARGEST" | grep -oP 'screenshot-\K\d+')

npx canicode visual-compare $RUN_DIR/output.html \
  --figma-screenshot "$LARGEST" \
  --width "$LARGEST_WIDTH" \
  --expand-root \
  --output $RUN_DIR/responsive
```

Record `responsiveSimilarity` from JSON stdout. If only 1 screenshot exists, set `responsiveSimilarity`, `responsiveDelta`, `responsiveViewport` to `null`.

**Code metrics (baseline):**

```bash
npx canicode code-metrics $RUN_DIR/output.html
```

Record `htmlBytes`, `htmlLines`, `cssClassCount`, `cssVariableCount` from JSON stdout.

**Strip measurements** — for each of the 6 strip types:

```bash
# Post-process
npx canicode html-postprocess $RUN_DIR/stripped/<strip-type>.html

# Visual comparison
npx canicode visual-compare $RUN_DIR/stripped/<strip-type>.html \
  --figma-screenshot $RUN_DIR/figma.png \
  --output $RUN_DIR/stripped/<strip-type>

# Code metrics
npx canicode code-metrics $RUN_DIR/stripped/<strip-type>.html
```

For each strip, record `strippedSimilarity`, `strippedHtmlBytes`, `strippedCssClassCount`, `strippedCssVariableCount` from the CLI outputs.

**Input tokens** (design-tree text): `inputTokens = ceil(utf8Text.length / 4)`
- `baselineInputTokens` from `$RUN_DIR/design-tree.txt`
- `strippedInputTokens` from `$RUN_DIR/stripped/<strip-type>.txt`
- `tokenDelta` = `baselineInputTokens - strippedInputTokens`

**Responsive for size-constraints strip** (if responsive comparison ran above):

```bash
npx canicode visual-compare $RUN_DIR/stripped/size-constraints.html \
  --figma-screenshot "$LARGEST" \
  --width "$LARGEST_WIDTH" \
  --expand-root \
  --output $RUN_DIR/stripped/size-constraints-responsive
```

Other strip types: set responsive fields to `null`.

**Derived fields (every strip row):**

- `delta` = `baselineSimilarity - strippedSimilarity` (percentage points)
- `htmlBytesDelta` = `baselineHtmlBytes - strippedHtmlBytes`
- `deltaDifficulty`: use the metric the evaluator uses for that strip family (`src/agents/evaluation-agent.ts` — `getStripDifficultyForRule`):
  - `layout-direction-spacing` → map `delta` with `stripDeltaToDifficulty` (≤5 easy, 6–15 moderate, 16–30 hard, >30 failed)
  - `size-constraints` → if `responsiveDelta` is finite, map `responsiveDelta` with `stripDeltaToDifficulty`; else map `delta`
  - `component-references`, `node-names-hierarchy`, `variable-references`, `style-references` → if both token counts present, map with `tokenDeltaToDifficulty` (≤5% easy, 6–20% moderate, 21–40% hard, >40% failed); else map `delta` with `stripDeltaToDifficulty`

**Difficulty from similarity:** Use `SIMILARITY_DIFFICULTY_THRESHOLDS` from `src/agents/orchestrator.ts`: 90%+ easy, 70-89% moderate, 50-69% hard, <50% failed.

**Assemble `conversion.json`**: Merge Converter's `converter-assessment.json` (ruleImpactAssessment, uncoveredStruggles) with all measurement results:

```json
{
  "rootNodeId": "<from converter-assessment.json>",
  "similarity": <baseline similarity>,
  "difficulty": "<from similarity thresholds>",
  "responsiveSimilarity": <or null>,
  "responsiveDelta": <or null>,
  "responsiveViewport": <or null>,
  "htmlBytes": <from code-metrics>,
  "htmlLines": <from code-metrics>,
  "cssClassCount": <from code-metrics>,
  "cssVariableCount": <from code-metrics>,
  "ruleImpactAssessment": <from converter-assessment.json>,
  "uncoveredStruggles": <from converter-assessment.json>,
  "stripDeltas": [<assembled from strip measurements>],
  "converterTokens": <from subagent usage>,
  "converterToolUses": <from subagent usage>,
  "converterDurationMs": <from subagent usage>
}
```

Write `$RUN_DIR/conversion.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Measurements","timestamp":"<ISO8601>","result":"similarity=<N>% difficulty=<level> strips=<N>/6","durationMs":<ms>}
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
- Similarity score from `$RUN_DIR/conversion.json`
- Generated HTML path: `$RUN_DIR/output.html`
- Fixture path and analysis JSON path: `$RUN_DIR/analysis.json`
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

Gather supporting evidence (deterministic CLI — no LLM):

```bash
npx canicode calibrate-gather-evidence $RUN_DIR
```

This reads `conversion.json`, `gaps.json`, `summary.md`, and `data/calibration-evidence.json`, and writes a single `$RUN_DIR/critic-evidence.json` with structured data for the Critic.

Read `$RUN_DIR/critic-evidence.json` and include it in the Critic prompt.

Spawn the `calibration-critic` subagent. In the prompt:
- Include the proposal list from summary.md
- Include the gathered evidence from `critic-evidence.json`
- **Tell the agent: "Return your reviews as JSON. Do NOT write any files."**

After the Critic returns, **you** write the JSON to `$RUN_DIR/debate.json`:
```json
{
  "critic": {
    "timestamp": "<ISO8601>",
    "summary": "approved=<N> rejected=<N> revised=<N>",
    "reviews": [
      {
        "ruleId": "X",
        "decision": "APPROVE|REJECT|REVISE",
        "confidence": "high|medium|low",
        "pro": ["evidence supporting change"],
        "con": ["evidence against change"],
        "reason": "..."
      }
    ]
  }
}
```

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Critic","timestamp":"<ISO8601>","result":"approved=<N> rejected=<N> revised=<N>","durationMs":<ms>}
```

#### Early-stop check (deterministic CLI — no LLM)

```bash
npx canicode calibrate-finalize-debate $RUN_DIR
```

This outputs JSON: `{"action": "early-stop"|"continue", ...}`.

- If `action` is `"early-stop"`: the CLI has already written `stoppingReason` to debate.json. Append to activity.jsonl:
  ```json
  {"step":"Arbitrator","timestamp":"<ISO8601>","result":"SKIPPED — early-stop: all proposals rejected with high confidence","durationMs":0}
  ```
  Jump to Step 6.5.

- If `action` is `"continue"`: proceed to Step 6.

### Step 6 — Arbitrator

Spawn the `calibration-arbitrator` subagent. In the prompt:
- Include proposals and the Critic's reviews from `$RUN_DIR/debate.json`
- **Tell the agent: "Return your decisions as JSON. Only edit rule-config.ts if applying changes. Do NOT write to logs."**

After the Arbitrator returns, **you** update `$RUN_DIR/debate.json` — read the existing content and add the `arbitrator` field:

```json
{
  "critic": { ... },
  "arbitrator": {
    "timestamp": "<ISO8601>",
    "summary": "applied=<N> revised=<N> rejected=<N> hold=<N>",
    "decisions": [
      {
        "ruleId": "X",
        "decision": "applied|revised|rejected|hold|disabled",
        "confidence": "high|medium|low",
        "before": -10,
        "after": -7,
        "reason": "..."
      }
    ]
  }
}
```

Then finalize the debate (deterministic CLI — no LLM):

```bash
npx canicode calibrate-finalize-debate $RUN_DIR
```

This determines `stoppingReason` (if any) and writes it to debate.json. Outputs JSON with `action: "finalized"`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Arbitrator","timestamp":"<ISO8601>","result":"applied=<N> rejected=<N> hold=<N>","durationMs":<ms>}
```

### Step 6.5 — Enrich and prune evidence

After the debate (or early-stop), enrich `data/calibration-evidence.json` with the Critic's structured pro/con/confidence. This ensures cross-run evidence persists beyond the ephemeral `logs/` directory.

```bash
npx canicode calibrate-enrich-evidence $RUN_DIR
```

This reads `debate.json`, extracts the Critic's reviews (pro, con, confidence, decision), and updates matching entries in `data/calibration-evidence.json`. Runs for both normal and early-stop paths.

Then prune calibration evidence for the applied rules:

```bash
npx canicode calibrate-prune-evidence $RUN_DIR
```

This reads `debate.json`, extracts applied/revised ruleIds, and removes their entries from `data/calibration-evidence.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"PruneEvidence","timestamp":"<ISO8601>","result":"pruned=<N> ruleIds","durationMs":<ms>}
```

### Step 7 — Generate Report

```
npx canicode calibrate-gap-report --output logs/calibration/REPORT.md
```

This aggregates all run directories into a single report.

### Done

Report the final summary: similarity, proposals, decisions, and path to `logs/calibration/REPORT.md`.

## Rules

- Each agent must be a SEPARATE subagent call (isolated context).
- Pass only structured data between agents — never raw reasoning.
- The Critic receives proposals + converter's ruleImpactAssessment + gaps + prior evidence (structured data, not free-form reasoning).
- Only the Arbitrator may edit `rule-config.ts`.
- Steps 1, 4, 7 are CLI commands — run them directly with Bash.
- **CRITICAL: YOU write all files to $RUN_DIR. Subagents (Gap Analyzer, Critic, Arbitrator) MUST return JSON as text — tell them "Do NOT write any files." You are the only one who writes to $RUN_DIR.**
- **CRITICAL: After each step, append to $RUN_DIR/activity.jsonl yourself. Do NOT rely on subagents to append.**
