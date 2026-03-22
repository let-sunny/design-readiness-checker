Run a rule discovery pipeline to research, design, implement, and evaluate a new analysis rule.

Input: $ARGUMENTS (concept + fixture path, e.g. `"component description" fixtures/material3-kit.json`)

## Instructions

You are the orchestrator. Do NOT implement rules yourself. Only pass data between agents and run CLI steps.

### Step 0 — Setup

Parse the input: first argument is the concept (quoted string), remaining arguments are fixture paths.

Generate the activity log filename:

```
LOG_FILE=logs/activity/YYYY-MM-DD-HH-mm-rule-<concept-slug>.md
```

Create the file with a header.

### Step 1 — Researcher

Spawn the `rule-discovery-researcher` subagent. Provide:
- The concept to investigate
- The fixture paths
- The activity log path:

```
Append your report to: <paste LOG_FILE here>
```

If the Researcher says the concept is not feasible, stop here and report why.

### Step 2 — Designer

Spawn the `rule-discovery-designer` subagent. Provide:
- The Researcher's report (copy the findings)
- The concept

```
Append your proposal to: <paste LOG_FILE here>
```

### Step 3 — Implementer

Spawn the `rule-discovery-implementer` subagent. Provide:
- The Designer's rule proposal

```
Append your summary to: <paste LOG_FILE here>
```

After implementation, rebuild: `pnpm build`

### Step 4 — Visual Validation

For 2-3 nodes flagged by the new rule, run visual comparison:

1. Run analysis to find flagged nodes:
   ```
   npx canicode analyze <fixture> --json
   ```
2. For each flagged node, generate code (spawn a general-purpose subagent to convert the node to HTML)
3. Run visual compare:
   ```
   npx canicode visual-compare <generated.html> --figma-url "<url-with-node-id>"
   ```
4. Record similarity scores

### Step 5 — Evaluator

Spawn the `rule-discovery-evaluator` subagent. Provide:
- The rule ID
- The fixture paths
- The visual comparison results from Step 4

```
Append your evaluation to: <paste LOG_FILE here>
```

### Step 6 — Critic

Spawn the `rule-discovery-critic` subagent. Provide:
- The Designer's proposal
- The Evaluator's results (including visual scores)

```
Append your critique to: <paste LOG_FILE here>
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
- **CRITICAL**: Every subagent prompt MUST contain the exact LOG_FILE path.
