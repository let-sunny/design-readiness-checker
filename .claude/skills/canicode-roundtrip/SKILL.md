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

For each answered gotcha (skip questions answered with "skip" or "n/a"), branch on the pre-computed `question.applyStrategy`. The routing table, target properties, and instance-child resolution are resolved server-side by `canicode` — do NOT re-derive them from the rule id.

Use the **`nodeId` from the answered question**. When `question.isInstanceChild` is `true`, treat layout and size-constraint changes as **high impact**: applying them on the source definition affects **every instance** of that component in the file. Ask for explicit user confirmation before writing to the definition node.

#### Input shape from canicode

Every gotcha-survey question (and every entry in `analyzeResult.issues[]`) carries these pre-computed fields:

| Field | Type | Meaning |
|-------|------|---------|
| `applyStrategy` | `"property-mod"` \| `"structural-mod"` \| `"annotation"` \| `"auto-fix"` | Which strategy branch to enter (A/B/C/D). |
| `targetProperty` | `string` \| `string[]` \| (absent) | Figma Plugin-API property to write. Array when multiple properties move together (e.g. `no-auto-layout` → `["layoutMode", "itemSpacing"]`). Absent for structural/annotation rules. |
| `suggestedName` | `string` \| (absent) | Naming rules only — pre-capitalized value to write to `node.name` (e.g. `"Hover"`). |
| `isInstanceChild` | `boolean` | Whether the `nodeId` targets a node inside an INSTANCE subtree. |
| `sourceChildId` | `string` \| (absent) | Definition node id inside the source component. Use directly with `figma.getNodeByIdAsync`. |
| `instanceContext` | object \| (absent) | Survey questions only. `{ parentInstanceNodeId, sourceNodeId, sourceComponentId?, sourceComponentName? }` for the Step 3 user-facing note. |

#### Instance-child property overridability (Plugin API)

Most production nodes sit under `INSTANCE` subtrees. `canicode` flags these via `question.isInstanceChild` and, when resolvable, surfaces the definition node id as `question.sourceChildId` plus extra metadata on `question.instanceContext`. You do not need to parse node ids.

| Property / action | Typical override on instance child? | Notes |
|-------------------|-------------------------------------|--------|
| `node.name` | Often yes | Prefer scene node first. |
| `layoutSizingHorizontal` / `layoutSizingVertical` on the **INSTANCE** root | Yes | Targets the instance node, not deep children. |
| `annotations` | Often yes | Good fallback when a property cannot be set. |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | Often **no** | Error text usually mentions instance override — route to definition node (`question.sourceChildId`) after confirmation. |
| `layoutMode`, primary layout structure | Often **no** on deep children | Same as above — definition-level change. |
| `itemSpacing`, padding fields | **Mixed** | Try scene node inside `try/catch`; on failure use definition path after confirmation. |

**Three-tier write policy:**

1. **Scene (instance) node** — `await figma.getNodeByIdAsync(question.nodeId)` and apply the write inside `try/catch`. Success → done (local change only). Mark result with ✅.
2. **Definition (source) node** — If the error indicates the property cannot be overridden in an instance, load `await figma.getNodeByIdAsync(question.sourceChildId)`. If that returns null, walk from the scene node to the nearest `INSTANCE` parent and use `await instance.getMainComponentAsync()`, then find the matching layer inside that component. **Ask the user to confirm** before mutating the definition — changes propagate to **all** instances. Mark result with 🌐.
3. **Annotation fallback** — If `mainComponent` is null (common for **external published libraries**) or the write still fails, add a `labelMarkdown` annotation on the **scene** node documenting the answer and limitation. Mark result with 📝.

**Shared helper pattern** (adapt per `use_figma` batch — keep each `writeFn` small so a throw does not abort unrelated writes):

```javascript
async function applyWithInstanceFallback(question, writeFn) {
  const scene = await figma.getNodeByIdAsync(question.nodeId);
  if (!scene) return { icon: "📝", label: "missing node" };

  const definitionId = question.sourceChildId;
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

Wrap every property write in `applyWithInstanceFallback(question, async (target) => { ... })` so failed instance overrides route to the definition path or annotation instead of silently aborting the batch.

#### Strategy A: Property Modification — apply directly

Rules with `applyStrategy === "property-mod"`. Use the unified helper below; it branches on `question.targetProperty` automatically.

```javascript
async function applyPropertyMod(question, answerValue) {
  const props = Array.isArray(question.targetProperty)
    ? question.targetProperty
    : [question.targetProperty];
  return applyWithInstanceFallback(question, async (target) => {
    if (!target) return;
    for (const prop of props) {
      if (!(prop in target)) continue;
      // Multi-property rules (e.g. no-auto-layout → [layoutMode, itemSpacing]) expect
      // an object answer: { layoutMode: "VERTICAL", itemSpacing: 16 }.
      // Single-property rules expect a scalar (number, string, enum).
      target[prop] = (typeof answerValue === "object" && answerValue !== null)
        ? answerValue[prop]
        : answerValue;
    }
  });
}
```

Answer shape guide (LLM judgment — the user's answer is prose; parse accordingly):
- **`non-semantic-name`**: string — the new node name.
- **`irregular-spacing`**: number for gap (subType `gap`), or `{ paddingTop, paddingRight, paddingBottom, paddingLeft }` for padding.
- **`fixed-size-in-auto-layout`**: `"FILL"` \| `"HUG"` \| `"FIXED"` — applied to each axis listed in `targetProperty`.
- **`missing-size-constraint`**: partial `{ minWidth, maxWidth }` — include only the keys the answer supplied.
- **`no-auto-layout`**: `{ layoutMode, itemSpacing }`; optionally extend with padding/alignment from the answer.

#### Strategy B: Structural Modification — confirm with user first

Rules with `applyStrategy === "structural-mod"`. Show the proposed change and **ask for user confirmation** before applying.

**`non-layout-container`** — Convert Group/Section to Auto Layout frame:
- Prompt: "I'll convert **{nodeName}** to an Auto Layout frame with {direction} layout and {spacing}px gap. Proceed?"
- If confirmed: `applyPropertyMod(question, { layoutMode: "VERTICAL", itemSpacing: 12 })`.

**`deep-nesting`** — Flatten intermediate wrappers or extract sub-component:
- Prompt: "I'll flatten **{nodeName}** by {description from answer}. This changes the layer hierarchy. Proceed?"
- Apply based on the specific answer (remove wrappers, convert padding, etc.).

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
- Requires finding the original component — if not identifiable, fall back to annotation.

If the user **declines** any structural modification, add an annotation instead (same as Strategy C).

#### Strategy C: Annotation — record on the design for designer reference

Rules with `applyStrategy === "annotation"` cannot be auto-fixed via Plugin API. Add the gotcha answer as a Figma annotation so designers see it in Dev Mode.

```javascript
const scene = await figma.getNodeByIdAsync(question.nodeId);
if (scene && "annotations" in scene) {
  scene.annotations = [...(scene.annotations || []), {
    labelMarkdown: `**[canicode] ${question.ruleId}**\n\n**Q:** ${question.question}\n**A:** ${answer}`
  }];
}
```

Important: use `labelMarkdown` only — `label` and `labelMarkdown` are mutually exclusive. Preserve existing annotations by spreading `scene.annotations`. Prefer annotating the **scene** instance child so designers see the note where they work; mention in the markdown if the fix belongs on the source component but could not be applied (library/external).

#### Strategy D: Auto-fix lower-severity issues from analysis

The gotcha survey covers only blocking/risk severity. Lower-severity rules appear in `analyzeResult.issues[]` without a survey question. Each issue carries the same pre-computed fields (`applyStrategy`, `targetProperty`, `suggestedName`, `isInstanceChild`, `sourceChildId`). Loop over them:

```javascript
for (const issue of analyzeResult.issues) {
  if (issue.applyStrategy !== "auto-fix") continue;

  // Shape an ad-hoc question-like object so the same helpers apply.
  const q = {
    nodeId: issue.nodeId,
    ruleId: issue.ruleId,
    ...(issue.sourceChildId ? { sourceChildId: issue.sourceChildId } : {}),
  };

  if (issue.targetProperty === "name" && issue.suggestedName) {
    // Naming rules — rename to the pre-computed suggestedName.
    await applyWithInstanceFallback(q, async (target) => {
      if (target) target.name = issue.suggestedName;
    });
  } else {
    // raw-value, missing-interaction-state, missing-prototype — designer judgment; annotate.
    const scene = await figma.getNodeByIdAsync(issue.nodeId);
    if (scene && "annotations" in scene) {
      scene.annotations = [...(scene.annotations || []), {
        labelMarkdown: `**[canicode] ${issue.ruleId}**\n\n${issue.message}`
      }];
    }
  }
}
```

`suggestedName` is already capitalized for direct Plugin-API use (e.g. `"Hover"`, `"Default"`, `"Pressed"`). Do not transform it further.

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
