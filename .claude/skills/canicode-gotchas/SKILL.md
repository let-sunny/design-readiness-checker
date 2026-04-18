---
name: canicode-gotchas
description: Run a gotcha survey for a Figma design and save answers as a Claude Code skill file for code generation reference
---

# CanICode Gotchas -- Design Gotcha Survey & Skill Writer

Run a gotcha survey on a Figma design to identify implementation pitfalls, collect developer answers, and save them as a skill file that code generation agents can reference automatically.

## Prerequisites

- **canicode MCP server** (preferred): `claude mcp add canicode -e FIGMA_TOKEN=figd_xxx -- npx -y -p canicode canicode-mcp`
- **Without canicode MCP** (fallback): the `canicode gotcha-survey --json` CLI produces the same response shape — no MCP installation required.
- **FIGMA_TOKEN** configured for live Figma URLs

## Workflow

### Step 1: Run the gotcha survey

If the `gotcha-survey` MCP tool is available, call it with the user's Figma URL:

```
gotcha-survey({ input: "<figma-url-or-fixture-path>" })
```

**Without canicode MCP** — shell out to the CLI. The `--json` output parses identically:

```bash
npx canicode gotcha-survey "<figma-url-or-fixture-path>" --json
```

Either channel returns:
- `designGrade`: overall grade (S, A+, A, B+, B, C+, C, D, F)
- `isReadyForCodeGen`: whether the design can be implemented without gotchas
- `questions`: array of gotcha questions (may be empty)

### Step 2: Check if survey is needed

If `isReadyForCodeGen` is `true` or `questions` is empty:
- Tell the user: "This design scored **{designGrade}** and is ready for code generation — no gotchas to resolve."
- Do NOT write a skill file.
- Stop here.

### Step 3: Present questions to the user

For each question in the `questions` array, present it to the user one at a time:

```
**[{severity}] {ruleId}** — node: {nodeName}

{question}

> Hint: {hint}
> Example: {example}
```

Wait for the user's answer before moving to the next question. The user may:
- Answer the question directly
- Say "skip" to skip a question
- Say "n/a" if the question is not applicable

### Step 4: Write the gotcha skill file

After collecting all answers, write the completed file to:

```
.claude/skills/canicode-gotchas/SKILL.md
```

This file goes in the **user's project** (current working directory), NOT in the canicode repo.

Always overwrite any existing file at this path — each run produces a fresh file based on the latest analysis.

## Output Template

The written SKILL.md must follow this exact format:

````markdown
---
name: canicode-gotchas
description: Design gotcha answers for {designName} — reference during code generation
---

# Design Gotchas — {designName}

Collected from canicode gotcha survey. Reference these answers when implementing this design.

## Metadata

- **Figma URL**: {figmaUrl}
- **Grade**: {designGrade}
- **Analyzed at**: {analyzedAt}

## Gotchas

### {ruleId} — {nodeName}

- **Severity**: {severity}
- **Node ID**: {nodeId}
- **Instance context** (omit this bullet if `instanceContext` was not in the survey question): parent instance `parentInstanceNodeId`, source node `sourceNodeId`, component `sourceComponentName` / `sourceComponentId` when present — roundtrip apply uses this to write on the source definition when instance overrides fail.
- **Question**: {question}
- **Answer**: {userAnswer}

(repeat for each question)
````

### Field mapping

| Field | Source |
|-------|--------|
| `designName` | Figma file name or fixture name from the input |
| `figmaUrl` | The input URL or fixture path provided by the user |
| `designGrade` | `designGrade` from gotcha-survey response |
| `analyzedAt` | Current timestamp (ISO 8601) |
| `ruleId` | `ruleId` from each question |
| `nodeName` | `nodeName` from each question |
| `severity` | `severity` from each question (blocking / risk) |
| `nodeId` | `nodeId` from each question |
| `instanceContext` | When present on the question, copy `parentInstanceNodeId`, `sourceNodeId`, `sourceComponentId`, `sourceComponentName` into the bullet above (roundtrip / Plugin apply) |
| `question` | `question` from each question |
| `userAnswer` | The answer collected from the user in Step 3 |

### Skipped questions

If the user skipped a question or said "n/a", still include it in the output with:

```markdown
- **Answer**: _(skipped)_
```

This ensures the code generation agent knows the gotcha exists even if no answer was provided.

## Edge Cases

- **No questions returned**: The design is ready for code generation. Inform the user and stop (Step 2).
- **User wants to re-run**: Always overwrite the existing file. No merge or append — fresh output each time.
- **MCP tool not available**: Fall back to `npx canicode gotcha-survey <input> --json` — the CLI returns the same `GotchaSurvey` shape. If the CLI is also unavailable (e.g. no node runtime), tell the user to install the canicode MCP server or the `canicode` npm package (see Prerequisites).
- **Partial answers**: If the user stops mid-survey, write the file with answers collected so far. Mark remaining questions as _(skipped)_.
