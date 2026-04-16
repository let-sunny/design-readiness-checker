---
name: canicode-roundtrip
description: Run canicode analysis + gotcha survey, then implement with Figma MCP — full design-to-code roundtrip
disable-model-invocation: false
---

# CanICode Roundtrip -- Design Analysis to Code Generation

Orchestrate the full design-to-code flow: analyze a Figma design for readiness, collect gotcha answers for problem areas, then generate code with Figma MCP — all gotcha context injected inline so the implementation avoids known pitfalls.

## Prerequisites

- **Figma MCP server** installed (provides `get_design_context`, `get_screenshot`, and other Figma tools)
- **canicode MCP server** installed: `claude mcp add canicode -e FIGMA_TOKEN=figd_xxx -- npx -y -p canicode canicode-mcp`
- **FIGMA_TOKEN** configured for live Figma URLs

## Workflow

### Step 1: Analyze the design

Call the `analyze` MCP tool with the user's Figma URL:

```
analyze({ input: "<figma-url>" })
```

The response includes:
- `scores.overall.grade`: design grade (S, A+, A, B+, B, C+, C, D, F)
- `isReadyForCodeGen`: boolean gate for gotcha skip
- `issues`: array of design issues found
- `summary`: human-readable analysis summary

Show the user a brief summary:

```
Design grade: **{grade}** ({percentage}%) — {issueCount} issues found.
```

### Step 2: Gate — check if gotchas are needed

If `isReadyForCodeGen` is `true` (grade S, A+, or A):
- Tell the user: "This design scored **{grade}** — ready for code generation with no gotchas needed."
- Skip directly to **Step 4**.

If `isReadyForCodeGen` is `false` (grade B+ or below):
- Tell the user: "This design scored **{grade}** — running gotcha survey to identify implementation pitfalls."
- Proceed to **Step 3**.

### Step 3: Run gotcha survey and collect answers

Call the `gotcha-survey` MCP tool:

```
gotcha-survey({ input: "<figma-url>" })
```

If `questions` is empty, skip to **Step 4**.

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

After all questions are answered:

1. **Save gotcha answers to file** at `.claude/skills/canicode-gotchas/SKILL.md` in the user's project (same format as the standalone `/canicode-gotchas` skill). Always overwrite any existing file — each run produces a fresh file.

The saved file must follow this format:

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
- **Analyzed at**: {timestamp ISO 8601}

## Gotchas

### {ruleId} — {nodeName}

- **Severity**: {severity}
- **Node ID**: {nodeId}
- **Question**: {question}
- **Answer**: {userAnswer}

(repeat for each question)
````

Mark skipped questions with `**Answer**: _(skipped)_`.

2. **Compile inline gotcha context** for use in Step 4 — the gotcha answers from the saved file are also kept in the conversation so the implementation step can reference them directly.

### Step 4: Implement with Figma MCP

Follow the **figma-implement-design** skill workflow to generate code from the Figma design.

**If gotcha answers were collected in Step 3**, provide them as additional context when implementing:

- Gotchas with severity **blocking** MUST be addressed — the design cannot be implemented correctly without this information
- Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
- Reference the specific node IDs from gotcha answers to locate the affected elements in the design

## Edge Cases

- **No canicode MCP server**: If the `analyze` tool is not found, tell the user to install the canicode MCP server (see Prerequisites). The Figma MCP tools alone are not sufficient for this workflow.
- **No Figma MCP server**: If `get_design_context` is not found, tell the user to set up the Figma MCP server. Without it, the code generation phase cannot proceed.
- **User wants analysis only**: Suggest using `/canicode` instead — it runs analysis without the code generation phase.
- **User wants gotcha survey only**: Suggest using `/canicode-gotchas` instead — it runs the survey and saves answers as a persistent skill file.
- **Partial gotcha answers**: If the user stops mid-survey, proceed to Step 4 with the answers collected so far. Mark unanswered questions as skipped in the Gotcha Context Block.
- **Very large design (many gotchas)**: The gotcha survey already deduplicates sibling nodes and filters to blocking/risk severity only, limiting the number of questions. If there are still many questions, ask the user if they want to focus on blocking issues only.
