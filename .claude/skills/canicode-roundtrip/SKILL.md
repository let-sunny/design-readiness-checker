---
name: canicode-roundtrip
description: Run canicode analysis + gotcha survey, then implement with Figma MCP — full design-to-code roundtrip
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

After all questions are answered, compile the gotcha answers into a **Gotcha Context Block** (used in Step 4):

```
## Design Gotchas — Collected Answers

These gotcha answers were collected from the canicode gotcha survey.
Apply them when translating the design to code.

### {ruleId} — {nodeName}
- **Severity**: {severity}
- **Node ID**: {nodeId}
- **Question**: {question}
- **Answer**: {userAnswer}

(repeat for each answered question)
```

Mark skipped questions with `**Answer**: _(skipped)_`.

### Step 4: Implement with Figma MCP

This step follows the standard Figma design-to-code workflow, with gotcha context injected.

#### 4a. Get design context

Call the Figma MCP tool:

```
get_design_context({ file_key: "<fileKey>", node_id: "<nodeId>" })
```

Extract `file_key` and `node_id` from the Figma URL:
- `figma.com/design/:fileKey/:fileName?node-id=:nodeId` — convert `-` to `:` in nodeId
- `figma.com/design/:fileKey/branch/:branchKey/:fileName` — use branchKey as fileKey

#### 4b. Get screenshot

Call the Figma MCP tool:

```
get_screenshot({ file_key: "<fileKey>", node_id: "<nodeId>" })
```

Use the screenshot as a visual reference for pixel-accurate implementation.

#### 4c. Understand component structure

From the `get_design_context` response, identify:
- Component instances and their original component definitions
- Design tokens (colors, typography, spacing) used
- Layout structure (auto-layout directions, gaps, padding)
- Any Code Connect mappings returned

#### 4d. Plan component hierarchy

Map the Figma layer structure to your project's component hierarchy:
- Match Figma components to existing project components where possible
- Identify where new components are needed
- Plan the nesting structure

#### 4e. Translate to project conventions — WITH gotcha context

This is where gotcha answers are applied. When translating the design:

1. Follow your project's existing patterns, components, and token system
2. **If gotcha answers were collected in Step 3**, apply each answer as a constraint:
   - Gotchas with severity **blocking** MUST be addressed — they indicate the design cannot be implemented correctly without this information
   - Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
   - Reference the specific node IDs from gotcha answers to locate the affected elements
3. Map Figma design tokens to your project's token system
4. Use the screenshot from Step 4b to verify visual intent where the design structure is ambiguous

#### 4f. Implement

Write the code following your project's conventions:
- Use existing components and utilities from the project
- Apply gotcha constraints from Step 4e
- Match the visual output to the Figma screenshot

#### 4g. Verify

After implementation:
- Compare the rendered output visually against the Figma screenshot
- Check that all gotcha constraints were addressed
- Verify responsive behavior if the design includes responsive variants

## Edge Cases

- **No canicode MCP server**: If the `analyze` tool is not found, tell the user to install the canicode MCP server (see Prerequisites). The Figma MCP tools alone are not sufficient for this workflow.
- **No Figma MCP server**: If `get_design_context` is not found, tell the user to set up the Figma MCP server. Without it, the code generation phase cannot proceed.
- **User wants analysis only**: Suggest using `/canicode` instead — it runs analysis without the code generation phase.
- **User wants gotcha survey only**: Suggest using `/canicode-gotchas` instead — it runs the survey and saves answers as a persistent skill file.
- **Partial gotcha answers**: If the user stops mid-survey, proceed to Step 4 with the answers collected so far. Mark unanswered questions as skipped in the Gotcha Context Block.
- **Very large design (many gotchas)**: The gotcha survey already deduplicates sibling nodes and filters to blocking/risk severity only, limiting the number of questions. If there are still many questions, ask the user if they want to focus on blocking issues only.
