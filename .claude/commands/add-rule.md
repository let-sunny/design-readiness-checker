Run a rule discovery pipeline to research, design, implement, and evaluate a new analysis rule.

Input: $ARGUMENTS (concept + fixture path, e.g. `"component description" fixtures/material3-kit`)

## Instructions

You are the orchestrator. Do NOT implement rules yourself. Only pass data between agents and run CLI steps.

**CRITICAL: You are responsible for writing ALL files to $RUN_DIR. Subagents return text/JSON — you write files. Never rely on a subagent to write to the correct path.**

### Step 0 — Setup

Parse the input: first argument is the concept (quoted string), remaining arguments are fixture paths.

Create the run directory:

```
RUN_DIR=logs/rule-discovery/<concept-slug>--<YYYY-MM-DD>/
mkdir -p $RUN_DIR
```

Create `$RUN_DIR/activity.jsonl` with a session-start entry.

### Step 1 — Researcher

Spawn the `rule-discovery-researcher` subagent. Provide:
- The concept to investigate
- The fixture paths
- **Tell the agent: "Return your findings as JSON. Do NOT write any files."**

After the Researcher returns, **you** write the JSON to `$RUN_DIR/research.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Researcher","timestamp":"<ISO8601>","result":"concept=<concept> feasible=<yes|no>","durationMs":<ms>}
```

If the Researcher says the concept is not feasible, stop here and report why.

### Step 2 — Designer

Spawn the `rule-discovery-designer` subagent. Provide:
- The Researcher's report (copy the findings)
- The concept
- **Tell the agent: "Return your proposal as JSON. Do NOT write any files."**

After the Designer returns, **you** write the JSON to `$RUN_DIR/design.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Designer","timestamp":"<ISO8601>","result":"proposed rule <rule-id>","durationMs":<ms>}
```

### Step 3 — Implementer

Spawn the `rule-discovery-implementer` subagent. Provide:
- The Designer's rule proposal

The Implementer DOES modify source files (this is the only agent allowed to).

After implementation, rebuild: `pnpm build`

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Implementer","timestamp":"<ISO8601>","result":"implemented rule <rule-id>","durationMs":<ms>}
```

### Step 4 — A/B Visual Validation

Run an A/B comparison on the entire design to measure the rule's actual impact on pixel-perfect accuracy:

1. Extract `fileKey` and root `nodeId` from the fixture or Figma URL.

2. Generate design tree: `npx canicode design-tree <fixture> --output $RUN_DIR/design-tree.txt`

3. Spawn a general-purpose subagent for **Test A (without the rule's data)**:
   - Read and follow `.claude/skills/design-to-code/PROMPT.md` for code generation rules
   - Use the design tree to convert the ENTIRE design to a single HTML page
   - Strip or withhold the information the rule checks for from the tree
   - Save to `$RUN_DIR/visual-a.html`
   - Run: `npx canicode visual-compare $RUN_DIR/visual-a.html --figma-url "<figma-url-with-root-node-id>" --output $RUN_DIR/visual-a`
   - Record similarity_a

4. Spawn a general-purpose subagent for **Test B (with the rule's data)**:
   - Read and follow `.claude/skills/design-to-code/PROMPT.md` for code generation rules
   - Same design tree, but this time INCLUDE the information
   - Save to `$RUN_DIR/visual-b.html`
   - Run: `npx canicode visual-compare $RUN_DIR/visual-b.html --figma-url "<figma-url-with-root-node-id>" --output $RUN_DIR/visual-b`
   - Record similarity_b

5. Compare: if similarity_b > similarity_a → the rule catches something that genuinely improves implementation quality.

6. Record both scores for the Evaluator.

### Step 5 — Evaluator

Spawn the `rule-discovery-evaluator` subagent. Provide:
- The rule ID
- The fixture paths
- The visual comparison results from Step 4
- **Tell the agent: "Return your evaluation as JSON. Do NOT write any files."**

After the Evaluator returns, **you** write the JSON to `$RUN_DIR/evaluation.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Evaluator","timestamp":"<ISO8601>","result":"verdict=<KEEP|ADJUST|DROP>","durationMs":<ms>}
```

### Step 6 — Critic

Spawn the `rule-discovery-critic` subagent. Provide:
- The Designer's proposal
- The Evaluator's results (including visual scores)
- **Tell the agent: "Return your decision as JSON. Do NOT write any files."**

After the Critic returns, **you** write the JSON to `$RUN_DIR/decision.json`.

Append to `$RUN_DIR/activity.jsonl`:
```json
{"step":"Critic","timestamp":"<ISO8601>","result":"<KEEP|ADJUST|DROP> for rule <rule-id>","durationMs":<ms>}
```

### Step 7 — Apply Decision

Based on the Critic's decision:
- **KEEP**: Commit the new rule. Message: `feat: add rule <rule-id> via discovery pipeline`
- **ADJUST**: Apply the Critic's suggested changes, run tests, then commit.
- **DROP**: Revert all changes to src/. Log the reason.

### Done

Report the final decision and summary.

## Rules

- Each agent must be a SEPARATE subagent call (isolated context).
- Pass only structured data between agents — never raw reasoning.
- Only the Implementer may modify source files.
- If the Critic says DROP, revert ALL source changes (`git checkout -- src/`).
- **CRITICAL: YOU write all files to $RUN_DIR. Tell every subagent (except Implementer): "Do NOT write any files." You handle all file I/O.**
- **CRITICAL: After each step, append to $RUN_DIR/activity.jsonl yourself.**
