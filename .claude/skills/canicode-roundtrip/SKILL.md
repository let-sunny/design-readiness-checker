---
name: canicode-roundtrip
description: Analyze Figma design, fix gotchas via Plugin API, re-analyze, then implement — true design-to-code roundtrip
disable-model-invocation: false
---

# CanICode Roundtrip — True Design-to-Code Roundtrip

Orchestrate the full design-to-code roundtrip: analyze a Figma design for readiness, collect gotcha answers for problem areas, **apply fixes directly to the Figma design** via `use_figma`, re-analyze to verify the design improved, then generate code. The design itself gets better — the next analysis passes without gotchas.

## Prerequisites

- **Figma MCP server** installed (provides `get_design_context`, `get_screenshot`, `use_figma`, and other Figma tools)
- **canicode MCP server** installed: `claude mcp add canicode -e FIGMA_TOKEN=figd_xxx -- npx -y -p canicode canicode-mcp`
- **FIGMA_TOKEN** configured for live Figma URLs
- **Figma Full seat + file edit permission** (required for `use_figma` to modify the design)

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
- Skip directly to **Step 6**.

If `isReadyForCodeGen` is `false` (grade B+ or below):
- Tell the user: "This design scored **{grade}** — running gotcha survey to identify implementation pitfalls."
- Proceed to **Step 3**.

### Step 3: Run gotcha survey and collect answers

Call the `gotcha-survey` MCP tool:

```
gotcha-survey({ input: "<figma-url>" })
```

If `questions` is empty, skip to **Step 6**.

For each question in the `questions` array, present it to the user one at a time.

Build the message from the question fields. **If `question.instanceContext` is present**, prepend one line before the question body:

```
_Instance note: This layer is inside an instance. Layout and size fixes may need to be applied on source component **{sourceComponentName or sourceComponentId or "unknown"}** (definition node `sourceNodeId`) and propagate to all instances — you will be asked to confirm before any definition-level write._
```

Then the standard block:

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

After all questions are answered, **save gotcha answers to file** at `.claude/skills/canicode-gotchas/SKILL.md` in the user's project. Always overwrite any existing file — each run produces a fresh file. Follow the format from the `/canicode-gotchas` skill.

Then proceed to **Step 4** to apply answers to the Figma design.

### Step 4: Apply gotcha answers to Figma design

Extract the `fileKey` from the Figma URL (format: `figma.com/design/:fileKey/...`).

For each answered gotcha (skip questions answered with "skip" or "n/a"), determine the apply strategy based on the `ruleId`.

Use the **`nodeId` from the answered question** (same as `gotcha-survey` output). When the question includes **`instanceContext`**, treat layout and size-constraint changes as **high impact**: applying them on the source definition affects **every instance** of that component in the file. Ask for explicit user confirmation before writing to the definition node.

#### Instance-child property overridability (Plugin API)

Most production nodes sit under `INSTANCE` subtrees. Figma uses instance-scoped ids (`I<instanceId>;<innerId>`; nested instances add more `;` segments). The `gotcha-survey` tool adds optional `instanceContext` with `parentInstanceNodeId`, `sourceNodeId`, and (when resolvable) `sourceComponentId` / `sourceComponentName`.

| Property / action | Typical override on instance child? | Notes |
|-------------------|-------------------------------------|--------|
| `node.name` | Often yes | Prefer scene node first. |
| `layoutSizingHorizontal` / `layoutSizingVertical` on the **INSTANCE** root | Yes | Targets the instance node, not deep children. |
| `annotations` | Often yes | Good fallback when a property cannot be set. |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | Often **no** | Error text usually mentions instance override — route to **definition** node (`instanceContext.sourceNodeId`) after confirmation. |
| `layoutMode`, primary layout structure | Often **no** on deep children | Same as above — definition-level change. |
| `itemSpacing`, padding fields | **Mixed** | Try scene node inside `try/catch`; on failure use definition path after confirmation. |

**Three-tier write policy (Strategy A and compatible parts of D):**

1. **Scene (instance) node** — `await figma.getNodeByIdAsync(question.nodeId)` and apply the write inside `try/catch`. Success → done (local change only). Mark result with ✅.
2. **Definition (source) node** — If the error indicates the property cannot be overridden in an instance (or closely related wording), load `await figma.getNodeByIdAsync(question.instanceContext.sourceNodeId)`. If that is null, walk from the scene node to the nearest `INSTANCE` parent and use `await instance.getMainComponentAsync()`, then find the matching layer by id or name path inside that component. **Ask the user to confirm** before mutating the definition — changes propagate to **all** instances. Mark result with 🌐.
3. **Annotation fallback** — If `mainComponent` is null (common for **external published libraries**) or the write still fails, add a `labelMarkdown` annotation on the **scene** node documenting the answer and limitation. Mark result with 📝.

**Shared helper pattern** (adapt per `use_figma` batch — keep each `writeFn` small so a throw does not abort unrelated writes):

```javascript
async function applyWithInstanceFallback(question, writeFn) {
  const scene = await figma.getNodeByIdAsync(question.nodeId);
  if (!scene) return { icon: "📝", label: "missing node" };

  const definitionId = question.instanceContext?.sourceNodeId;
  const definition = definitionId
    ? await figma.getNodeByIdAsync(definitionId)
    : null;

  try {
    await writeFn(scene);
    return { icon: "✅", label: "instance/scene" };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    const looksLikeInstanceOverride =
      /instance/i.test(msg) ||
      /override/i.test(msg) ||
      /cannot be overridden/i.test(msg);
    if (!looksLikeInstanceOverride || !definition) {
      return { icon: "📝", label: "error: " + msg };
    }
    // Orchestrator: pause here, ask user to confirm propagation to all instances, then:
    await writeFn(definition);
    return { icon: "🌐", label: "source definition" };
  }
}
```

In the Strategy snippets below, treat `"nodeId"` as `question.nodeId` from the answered gotcha. Prefer `await figma.getNodeByIdAsync(...)` over the sync API. **Wrap property writes** in `applyWithInstanceFallback(question, async (target) => { ... })` (or equivalent) whenever `question.instanceContext` exists or the id starts with `I` and contains `;`.

#### Strategy A: Property Modification — apply directly

These rules have straightforward property changes. Parse the user's answer to extract target values. **Still use** `applyWithInstanceFallback` when instance children are involved so failed overrides route to definition or annotation instead of failing the whole batch silently.

**`non-semantic-name`** — Rename the node to the answer:
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target) target.name = "hero-section";
});
```

**`irregular-spacing`** — Fix spacing to the grid-aligned value from the answer:
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target && "itemSpacing" in target) target.itemSpacing = 16;
  // For padding: target.paddingTop = 8; target.paddingBottom = 8; etc.
});
```

**`fixed-size-in-auto-layout`** — Change sizing mode per the answer (FILL, HUG, or FIXED):
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target && "layoutSizingHorizontal" in target) {
    target.layoutSizingHorizontal = "FILL"; // or "HUG" or "FIXED"
  }
});
```

**`missing-size-constraint`** — Set min/max constraints from the answer:
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target && "minWidth" in target) {
    target.minWidth = 320;  // from answer
    target.maxWidth = 1200; // from answer, if provided
  }
});
```

**`no-auto-layout`** — Set layout mode, direction, and spacing from the answer:
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target && "layoutMode" in target) {
    target.layoutMode = "VERTICAL"; // or "HORIZONTAL"
    target.itemSpacing = 16;
    // Optionally set padding, alignment from the answer
  }
});
```

#### Strategy B: Structural Modification — confirm with user first

These rules change the design structure. Show the proposed change and **ask for user confirmation** before applying.

**`non-layout-container`** — Convert Group/Section to Auto Layout frame:
- Prompt: "I'll convert **{nodeName}** to an Auto Layout frame with {direction} layout and {spacing}px gap. Proceed?"
- If confirmed:
```javascript
await applyWithInstanceFallback(question, async (target) => {
  if (target && "layoutMode" in target) {
    target.layoutMode = "VERTICAL";
    target.itemSpacing = 12;
  }
});
```

**`deep-nesting`** — Flatten intermediate wrappers or extract sub-component:
- Prompt: "I'll flatten **{nodeName}** by {description from answer}. This changes the layer hierarchy. Proceed?"
- Apply based on the specific answer (remove wrappers, convert padding, etc.)

**`missing-component`** — Convert frame to reusable component:
- Prompt: "I'll convert **{nodeName}** to a reusable component. Proceed?"
- If confirmed:
```javascript
const scene = await figma.getNodeByIdAsync(question.nodeId);
if (scene && scene.type === "FRAME") {
  figma.createComponentFromNode(scene);
}
```

**`detached-instance`** — Reconnect to original component:
- Prompt: "I'll reconnect **{nodeName}** to its original component. Any overrides will be preserved. Proceed?"
- This requires finding the original component — if not identifiable, fall back to annotation.

If user **declines** any structural modification, add an annotation instead (same as Strategy C).

#### Strategy C: Annotation — record on the design for designer reference

These rules cannot be auto-fixed via Plugin API. Add the gotcha answer as a Figma annotation on the node so designers see it in Dev Mode.

**Rules from gotcha survey**: `absolute-position-in-auto-layout`, `variant-structure-mismatch`

```javascript
const scene = await figma.getNodeByIdAsync(question.nodeId);
if (scene && "annotations" in scene) {
  scene.annotations = [...(scene.annotations || []), {
    labelMarkdown: "**[canicode] {ruleId}**\n\n**Q:** {question}\n**A:** {answer}"
  }];
}
```

Important: use `labelMarkdown` only — `label` and `labelMarkdown` are mutually exclusive. Preserve existing annotations by spreading `scene.annotations`. Prefer annotating the **scene** instance child so designers see the note where they work; mention in the markdown if the fix belongs on the source component but could not be applied (library/external).

#### Strategy D: Auto-fix lower-severity issues from analysis

The gotcha survey only covers blocking/risk severity (11 rules). The remaining 5 rules appear in the Step 1 analysis `issues` array but not in the survey. Process them directly — no gotcha question needed.

**Auto-fix naming** — apply directly from the analysis issue data:

**`non-standard-naming`** — The analysis identifies non-standard state names. Rename to the standard equivalent:
```javascript
const q = { nodeId: violation.nodeId, instanceContext: undefined };
await applyWithInstanceFallback(q, async (target) => {
  if (target) target.name = "Hover"; // standardize from "hover_v1", "on_hover", etc.
});
```
Standard state names: Default, Hover, Active, Pressed, Selected, Highlighted, Disabled, Enabled, Focus, Focused, Dragged.

**`inconsistent-naming-convention`** — The analysis identifies the dominant convention among siblings. Rename minority nodes to match:
```javascript
const q = { nodeId: violation.nodeId, instanceContext: undefined };
await applyWithInstanceFallback(q, async (target) => {
  if (target) target.name = "CardTitle"; // convert to dominant convention (e.g., PascalCase)
});
```

**Annotate** — these require designer judgment, no auto-fix possible:

**`raw-value`** — Raw colors/fonts/spacing without design tokens. Annotate which values need token binding:
```javascript
node.annotations = [...(node.annotations || []), {
  labelMarkdown: "**[canicode] raw-value**\n\nThis node uses raw values without design tokens.\n**Issue:** {issue message from analysis}"
}];
```

**`missing-interaction-state`** — Missing hover/active/disabled variants. Annotate what states are needed:
```javascript
node.annotations = [...(node.annotations || []), {
  labelMarkdown: "**[canicode] missing-interaction-state**\n\nThis component is missing interaction state variants.\n**Missing:** {missing states from analysis}"
}];
```

**`missing-prototype`** — Missing prototype interactions (rule currently disabled, include for completeness):
```javascript
node.annotations = [...(node.annotations || []), {
  labelMarkdown: "**[canicode] missing-prototype**\n\nThis interactive element has no prototype interaction defined.\n**Expected:** {expected interaction from analysis}"
}];
```

#### Execution order

1. **Batch all property modifications** (Strategy A) into a single `use_figma` call for efficiency.
2. **Present structural modifications** (Strategy B) one by one, apply confirmed ones.
3. **Batch all annotations** (Strategy C + declined structural mods) into a single `use_figma` call.
4. **Batch all auto-fixes and annotations for lower-severity issues** (Strategy D) into a single `use_figma` call.

After applying, report what was done:

```
Applied {N} changes to the Figma design:
- ✅ {nodeName}: renamed to "hero-section" (non-semantic-name) — scene/instance override
- 🌐 {nodeName}: minWidth applied on source definition (missing-size-constraint) — propagates to all instances
- ✅ {nodeName}: itemSpacing → 16px (irregular-spacing)
- ⏭️ {nodeName}: declined by user, added annotation (deep-nesting)
- 📝 {nodeName}: annotation added (absolute-position-in-auto-layout)
- 🔧 {nodeName}: auto-fixed to "Hover" (non-standard-naming)
- 📝 {nodeName}: annotation — raw color needs token binding (raw-value)
```

### Step 5: Re-analyze and verify

Run `analyze` again on the same Figma URL:

```
analyze({ input: "<figma-url>" })
```

Compare the new grade with the original:

**All gotcha issues resolved** (new grade is S, A+, or A):
- Tell the user: "Design improved from **{oldGrade}** to **{newGrade}** — all gotcha issues resolved. Ready for code generation."
- Clean up canicode annotations: remove annotations with `[canicode]` prefix from fixed nodes via `use_figma`:
```javascript
const nodeIds = ["id1", "id2"]; // nodes that now pass
for (const id of nodeIds) {
  const node = figma.getNodeById(id);
  if (node && "annotations" in node) {
    node.annotations = (node.annotations || []).filter(
      a => !a.labelMarkdown?.startsWith("**[canicode]")
    );
  }
}
```
- Proceed to **Step 6**.

**Some issues remain**:
- Show what improved and what still needs attention.
- Ask: "Design improved from **{oldGrade}** to **{newGrade}**. {remainingCount} issues remain. Proceed to code generation?"
- If yes → proceed to **Step 6** with remaining gotcha context.
- If no → stop and let the user address remaining issues manually.

### Step 6: Implement with Figma MCP

Follow the **figma-implement-design** skill workflow to generate code from the Figma design.

**If annotations or unresolved gotchas remain from Step 5**, provide them as additional context when implementing:

- Gotchas with severity **blocking** MUST be addressed — the design cannot be implemented correctly without this information
- Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
- Reference the specific node IDs from gotcha answers to locate the affected elements in the design

**If all issues were resolved in Steps 4-5**, no additional gotcha context is needed — the design speaks for itself.

## Edge Cases

- **No canicode MCP server**: If the `analyze` tool is not found, tell the user to install the canicode MCP server (see Prerequisites). The Figma MCP tools alone are not sufficient for this workflow.
- **No Figma MCP server**: If `get_design_context` or `use_figma` is not found, tell the user to set up the Figma MCP server. Without it, the apply and code generation phases cannot proceed.
- **No edit permission**: If `use_figma` fails with a permission error, tell the user they need Full seat + file edit permission. Fall back to the one-way flow: skip Steps 4-5 and proceed directly to Step 6 with gotcha answers as code generation context.
- **User wants analysis only**: Suggest using `/canicode` instead — it runs analysis without the code generation phase.
- **User wants gotcha survey only**: Suggest using `/canicode-gotchas` instead — it runs the survey and saves answers as a persistent skill file.
- **Partial gotcha answers**: Apply only the answered questions. Skipped/n/a questions are neither applied nor annotated.
- **use_figma call fails for a node**: Report the error for that specific node, continue with other nodes. Failed property modifications become annotations so the context is not lost.
- **Re-analyze shows new issues**: Only address issues from the original gotcha survey. New issues may appear due to structural changes — report them but do not re-enter the gotcha loop.
- **Very large design (many gotchas)**: The gotcha survey already deduplicates sibling nodes and filters to blocking/risk severity only. If there are still many questions, ask the user if they want to focus on blocking issues only.
- **External library components**: When `getMainComponentAsync()` returns `null`, the source lives in a published library this file only references — there is no supported path to edit it from the current file via Plugin API. Use the annotation fallback on the scene node and state that limitation explicitly in `labelMarkdown`.
