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

Matrix below is confirmed by Experiment 08 ([#290](https://github.com/let-sunny/canicode/issues/290)) probes on shallow + deep instance-child FRAMEs in the Simple Design System fixture. `✅` = raw-value write accepted, `❌` = throws *"cannot be overridden in an instance"*, `⚠️` = no error but value silently unchanged (must detect with before/after compare).

| Property | Raw-value write on instance child | Variable binding | Notes |
|----------|----------------------------------|------------------|-------|
| `node.name` | ✅ | — | Prefer scene node first. |
| `annotations` | ✅ | — | Good fallback when another property cannot be set. |
| `itemSpacing`, `paddingTop/Right/Bottom/Left` | ✅ | ✅ | |
| `primaryAxisAlignItems`, `counterAxisAlignItems`, `layoutAlign` | ✅ | — | |
| `cornerRadius`, `opacity` | ✅ | ✅ | |
| `fills`, `strokes` (raw color) | ✅ | ✅ via `setBoundVariableForPaint(paint, "color", v)` | |
| `layoutSizingHorizontal` / `layoutSizingVertical` | ✅ | — | |
| `layoutMode` | ⚠️ on some nodes | — | Some instance children silently ignore the write (no throw, no change). |
| **`minWidth`, `maxWidth`, `minHeight`, `maxHeight`** | ❌ on many nodes | **✅** | **Variable binding bypasses the override restriction** — prefer binding when the answer names a token. Raw values route to the definition node after confirmation. |
| `fontSize`, `lineHeight`, `letterSpacing`, `paragraphSpacing` (TEXT) | ✅ | ✅ | |
| `characters` (TEXT) | ✅ | ✅ STRING variable | |

**Three-tier write policy:**

1. **Scene (instance) node** — `await figma.getNodeByIdAsync(question.nodeId)` and apply the write inside `try/catch`. Success → done (local change only). Mark result with ✅.
2. **Definition (source) node** — If the error indicates the property cannot be overridden in an instance, load `await figma.getNodeByIdAsync(question.sourceChildId)`. If that returns null, walk from the scene node to the nearest `INSTANCE` parent and use `await instance.getMainComponentAsync()`, then find the matching layer inside that component. Changes propagate to **all** instances of the component in the file. Mark result with 🌐.
3. **Annotation fallback** — If `mainComponent` is null (common for **external published libraries**) or the write still fails, add a `labelMarkdown` annotation on the **scene** node documenting the answer and limitation. Mark result with 📝.

**Confirmation is a batch-level concern, not a helper-level one.** A `use_figma` call runs one JavaScript batch and cannot pause mid-batch for user input. So the orchestrator is responsible for pre-flighting: classify every `question` whose `isInstanceChild` is true as a *potential* definition write, enumerate the likely propagation set to the user up-front, and get **one confirmation for the whole batch**. The helper below assumes that confirmation has already happened — it does not prompt.

**Shared helpers** — paste once at the top of every `use_figma` batch. Keep each `writeFn` small so a throw does not abort unrelated writes. Experiment 08 findings informed every branch here.

```javascript
// ── D1: Figma readback populates BOTH `label` and `labelMarkdown` on every entry,
// but writes accept only ONE. Strip to the non-empty field before spreading.
// Entries where neither field has content are dropped — they cannot round-trip
// through the write validator.
function stripAnnotations(annotations) {
  return (annotations || []).flatMap((a) => {
    const hasLM = typeof a.labelMarkdown === "string" && a.labelMarkdown.length > 0;
    const hasLabel = typeof a.label === "string" && a.label.length > 0;
    if (!hasLM && !hasLabel) return [];
    const base = hasLM ? { labelMarkdown: a.labelMarkdown } : { label: a.label };
    if (a.categoryId) base.categoryId = a.categoryId;
    if (Array.isArray(a.properties) && a.properties.length > 0) base.properties = a.properties;
    return [base];
  });
}

// ── D4: File-scoped custom categories. Run once per roundtrip (Step 4.0).
// Returns { gotcha, autoFix, fallback } map of category ids.
// Colors must be lowercase: yellow | orange | red | pink | violet | blue | teal | green.
async function ensureCanicodeCategories() {
  const api = figma.annotations;
  const existing = await api.getAnnotationCategoriesAsync();
  const byLabel = new Map(existing.map((c) => [c.label, c.id]));
  async function ensure(label, color) {
    if (byLabel.has(label)) return byLabel.get(label);
    const created = await api.addAnnotationCategoryAsync({ label, color });
    byLabel.set(label, created.id);
    return created.id;
  }
  return {
    gotcha:   await ensure("canicode:gotcha",   "blue"),
    autoFix:  await ensure("canicode:auto-fix", "green"),
    fallback: await ensure("canicode:fallback", "yellow"),
  };
}

// ── D2: Upsert a canicode annotation — replace existing by ruleId prefix, else append.
// Preserves `categoryId` and `properties` when replacing. Match covers both
// `labelMarkdown` (current format) and `label` (pre-D1 legacy entries) so reruns
// across versions consolidate instead of accumulating.
// categoryId: id from ensureCanicodeCategories().
// properties: optional array like [{ type: "width" }] — only valid camelCase types,
//   and only types the node supports (e.g. FRAME accepts width/height/layoutMode/
//   itemSpacing/padding; TEXT accepts width/height/fills/fontSize/lineHeight/…).
function upsertCanicodeAnnotation(node, { ruleId, markdown, categoryId, properties }) {
  if (!("annotations" in node)) return false;
  const prefix = `**[canicode] ${ruleId}**`;
  const body = markdown.startsWith(prefix) ? markdown : `${prefix}\n\n${markdown}`;
  const existing = stripAnnotations(node.annotations);
  const entry = { labelMarkdown: body };
  if (categoryId) entry.categoryId = categoryId;
  if (properties && properties.length) entry.properties = properties;
  const idx = existing.findIndex((a) =>
    a.labelMarkdown?.startsWith(prefix) || a.label?.startsWith(prefix),
  );
  if (idx >= 0) existing[idx] = entry;
  else existing.push(entry);
  node.annotations = existing;
  return true;
}

// ── Three-tier write policy with silent-ignore detection (B matrix finding).
// writeFn contract: may read `target[prop]` before/after to detect silent ignore
// and return false to signal "no change" — caller routes to definition fallback.
// Pre-condition: the orchestrator has already collected a batch-level confirmation
// that writes targeting a source-component definition may fan out to every instance
// of that component in the file. This helper never prompts.
async function applyWithInstanceFallback(question, writeFn, { categories } = {}) {
  const scene = await figma.getNodeByIdAsync(question.nodeId);
  if (!scene) return { icon: "📝", label: "missing node" };

  const definition = question.sourceChildId
    ? await figma.getNodeByIdAsync(question.sourceChildId)
    : null;

  try {
    const changed = await writeFn(scene);
    if (changed === false) {
      // Silent-ignore: write succeeded but value unchanged (e.g. layoutMode on some instances).
      // Route to the source definition — already covered by the batch-level confirmation.
      if (definition) {
        await writeFn(definition);
        return { icon: "🌐", label: "source definition (silent-ignore fallback)" };
      }
      // Cannot route — annotate scene as fallback.
      if (categories) {
        upsertCanicodeAnnotation(scene, {
          ruleId: question.ruleId,
          markdown: "write accepted but value unchanged; no definition available",
          categoryId: categories.fallback,
        });
      }
      return { icon: "📝", label: "silent-ignore, annotated" };
    }
    return { icon: "✅", label: "instance/scene" };
  } catch (e) {
    const msg = String(e?.message ?? e);
    // Canonical match from Experiment 08: "This property cannot be overridden in an instance".
    // The broader `/override/i` fallback catches variant wording from other properties but is
    // narrow enough that unrelated errors (file missing, network, etc.) won't false-match.
    // Do not add `/instance/i` — many unrelated messages mention "instance" and it over-routes.
    const looksLikeInstanceOverride =
      /cannot be overridden/i.test(msg) || /override/i.test(msg);
    if (!looksLikeInstanceOverride || !definition) {
      if (categories) {
        upsertCanicodeAnnotation(scene, {
          ruleId: question.ruleId,
          markdown: `could not apply automatically: ${msg}`,
          categoryId: categories.fallback,
        });
      }
      return { icon: "📝", label: "error: " + msg };
    }
    // Route to source definition — batch-level confirmation already covers propagation.
    await writeFn(definition);
    return { icon: "🌐", label: "source definition" };
  }
}

// ── C: Resolve a variable reference from an answer like { variable: "mobile-width" }.
// Scope is LOCAL variables only — exact-name match against `getLocalVariablesAsync()`.
// Slash-path names (e.g. "Brand/Primary") work only when the variable's `name` field
// itself contains the slash path. Library variables imported into this file are
// included automatically because they appear in `getLocalVariablesAsync()`; variables
// that live purely in an unimported remote library are NOT resolved here. Callers
// must fall back to a raw write (or to an annotation explaining the missing token).
async function resolveVariableByName(name) {
  const locals = await figma.variables.getLocalVariablesAsync();
  return locals.find((v) => v.name === name) || null;
}
```

Wrap every property write in `applyWithInstanceFallback(question, async (target) => { ... }, { categories })` so failed or silently-ignored instance overrides route to the definition path or fallback annotation instead of silently aborting the batch.

#### Strategy A: Property Modification — apply directly

Rules with `applyStrategy === "property-mod"`. The helper below branches on `question.targetProperty` automatically, and on each value type — scalar, multi-property object, or variable reference (`{ variable: "token-name" }`).

```javascript
async function applyPropertyMod(question, answerValue, context) {
  const props = Array.isArray(question.targetProperty)
    ? question.targetProperty
    : [question.targetProperty];

  return applyWithInstanceFallback(question, async (target) => {
    if (!target) return;
    let changed = undefined;
    for (const prop of props) {
      if (!(prop in target)) continue;
      // Multi-property rules (e.g. no-auto-layout → [layoutMode, itemSpacing]) expect
      // an object answer: { layoutMode: "VERTICAL", itemSpacing: 16 }.
      const value = (typeof answerValue === "object" && answerValue !== null && !("variable" in answerValue))
        ? answerValue[prop]
        : answerValue;

      // Variable binding — answer shape { variable: "name" }.
      // Bypasses instance-child override restrictions for minWidth/maxWidth and siblings.
      if (value && typeof value === "object" && "variable" in value) {
        const variable = await resolveVariableByName(value.variable);
        if (variable) { target.setBoundVariable(prop, variable); continue; }
        // Variable not found — fall through to raw write if the answer also has a fallback scalar.
        if (!("fallback" in value)) continue;
      }

      const scalar = (value && typeof value === "object" && "fallback" in value) ? value.fallback : value;
      const before = target[prop];
      target[prop] = scalar;
      // B: some instance children silently ignore layoutMode writes.
      if (target[prop] === before && before !== scalar) changed = false;
    }
    return changed;
  }, context);
}
```

Answer shape guide (LLM judgment — the user's answer is prose; parse accordingly):
- **`non-semantic-name`**: string — the new node name.
- **`irregular-spacing`**: number for gap (subType `gap`), or `{ paddingTop, paddingRight, paddingBottom, paddingLeft }` for padding.
- **`fixed-size-in-auto-layout`**: `"FILL"` \| `"HUG"` \| `"FIXED"` — applied to each axis listed in `targetProperty`.
- **`missing-size-constraint`**: partial `{ minWidth, maxWidth }` — include only the keys the answer supplied.
- **`no-auto-layout`**: `{ layoutMode, itemSpacing }`; optionally extend with padding/alignment from the answer.

**Variable binding** — whenever the answer names a design-system token (e.g. the user says the width should be `mobile-width`, the gap should be `space-m`, the color should be `Brand/Primary`), shape the value as `{ variable: "token-name" }` instead of a raw scalar. The helper calls `setBoundVariable` which **bypasses instance-child override restrictions**, so `minWidth`/`maxWidth`/color fields that raw writes cannot touch on an instance child will bind successfully. Mix shapes per-property — e.g. `{ minWidth: { variable: "mobile-width" }, maxWidth: 1440 }`.

The name must match **the variable's `name` field exactly** — including any slash path in the name (e.g. `"Brand/Primary"` matches only when the variable is literally named that way). Resolution is scoped to variables that `figma.variables.getLocalVariablesAsync()` returns: locally defined ones plus library variables that have already been imported into this file. If the token lives only in an unimported remote library, the binding step returns `null` and `applyPropertyMod` either falls through to a raw scalar (when the answer provided a `fallback` value) or records the miss — expose this as an annotation via the fallback category so the designer can import the variable and retry.

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

Rules with `applyStrategy === "annotation"` cannot be auto-fixed via Plugin API. Add the gotcha answer as a Figma annotation so designers see it in Dev Mode. Use the helper — it handles the D1 mutex, D2 in-place upsert, and D4 category assignment.

```javascript
const scene = await figma.getNodeByIdAsync(question.nodeId);
upsertCanicodeAnnotation(scene, {
  ruleId: question.ruleId,
  markdown: `**Q:** ${question.question}\n**A:** ${answer}`,
  categoryId: categories.gotcha,
  // Optional: surface live property values in Dev Mode alongside the note.
  // Only include types the node supports (FRAME vs TEXT — see matrix above).
  properties: question.ruleId === "absolute-position-in-auto-layout"
    ? [{ type: "layoutMode" }]
    : undefined,
});
```

Notes:
- `upsertCanicodeAnnotation` replaces an existing `**[canicode] <ruleId>**` entry on the same node instead of appending — reruns don't accumulate duplicates.
- `label` and `labelMarkdown` are mutually exclusive on write, but Figma returns both on readback. Never spread `scene.annotations` directly; always go through `stripAnnotations` (the helper does this).
- Prefer annotating the **scene** instance child so designers see the note where they work; mention in the markdown if the fix belongs on the source component but could not be applied (library/external).

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
    }, { categories });
  } else {
    // raw-value, missing-interaction-state, missing-prototype — designer judgment; annotate.
    const scene = await figma.getNodeByIdAsync(issue.nodeId);
    upsertCanicodeAnnotation(scene, {
      ruleId: issue.ruleId,
      markdown: issue.message,
      categoryId: categories.autoFix,
      // Optional: surface the live value for the affected property in Dev Mode.
      properties: issue.ruleId === "raw-value" ? [{ type: "fills" }] : undefined,
    });
  }
}
```

`suggestedName` is already capitalized for direct Plugin-API use (e.g. `"Hover"`, `"Default"`, `"Pressed"`). Do not transform it further.

#### Execution order

0. **Initialize categories** — first batch calls `const categories = await ensureCanicodeCategories();` and keeps the result in scope for every subsequent call in the same script. (Or re-run ensure at the top of each `use_figma` batch — it is idempotent by label.)
1. **Batch all property modifications** (Strategy A) into a single `use_figma` call for efficiency. Pass `{ categories }` to `applyWithInstanceFallback` so fallbacks land in the correct category.
2. **Present structural modifications** (Strategy B) one by one, apply confirmed ones.
3. **Batch all annotations** (Strategy C + declined structural mods) into a single `use_figma` call — use `categories.gotcha` for the category id.
4. **Batch all auto-fixes and annotations for lower-severity issues** (Strategy D) — use `categories.autoFix` for annotated ones, `categories.fallback` is reserved for errors surfaced by `applyWithInstanceFallback` itself.

After applying, report what was done:

```
Applied {N} changes to the Figma design:
- ✅ {nodeName}: renamed to "hero-section" (non-semantic-name) — scene/instance override
- 🌐 {nodeName}: minWidth applied on source definition (missing-size-constraint) — propagates to all instances
- ✅ {nodeName}: itemSpacing → 16px (irregular-spacing)
- 🔗 {nodeName}: minWidth bound to variable "mobile-width" (missing-size-constraint)
- ⏭️ {nodeName}: declined by user, added annotation (deep-nesting)
- 📝 {nodeName}: annotation added to canicode:gotcha (absolute-position-in-auto-layout)
- 🔧 {nodeName}: auto-fixed to "Hover" (non-standard-naming)
- 📝 {nodeName}: annotation added to canicode:auto-fix — raw color needs token binding (raw-value)
```

### Step 5: Re-analyze and verify

Run `analyze` again on the same Figma URL:

```
analyze({ input: "<figma-url>" })
```

Compare the new grade with the original:

**All gotcha issues resolved** (new grade is S, A+, or A):
- Tell the user: "Design improved from **{oldGrade}** to **{newGrade}** — all gotcha issues resolved. Ready for code generation."
- Clean up canicode annotations: remove annotations with `[canicode]` prefix from fixed nodes via `use_figma`. Apply `stripAnnotations` to avoid the D1 mutex:
```javascript
const nodeIds = ["id1", "id2"]; // nodes that now pass
for (const id of nodeIds) {
  const node = await figma.getNodeByIdAsync(id);
  if (node && "annotations" in node) {
    node.annotations = stripAnnotations(node.annotations).filter(
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
