---
name: canicode-roundtrip
description: Analyze Figma design, fix gotchas via Plugin API, re-analyze, then implement — true design-to-code roundtrip
disable-model-invocation: false
---

# CanICode Roundtrip — True Design-to-Code Roundtrip

Orchestrate the full design-to-code roundtrip: analyze a Figma design for readiness, collect gotcha answers for problem areas, **apply fixes directly to the Figma design** via `use_figma`, re-analyze to verify the design improved, then generate code. The design itself gets better — the next analysis passes without gotchas.

## Prerequisites

- **Figma MCP server** installed (provides `get_design_context`, `get_screenshot`, `use_figma`, and other Figma tools) — REQUIRED, there is no CLI fallback for `use_figma`
- **canicode MCP server** (preferred): `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp` — long-form flags only; the short-form `-y -p` collides with `claude mcp add`'s parser (#366). The MCP server reads `FIGMA_TOKEN` from `~/.canicode/config.json` or the host environment, so do **not** pass `-e FIGMA_TOKEN=…` here (#364).
- **Without canicode MCP** (fallback): Steps 1 (analyze) and 3 (gotcha-survey) shell out to `npx canicode <command> --json` — same JSON shape as the MCP tools. Step 4 (apply to Figma) still requires Figma MCP `use_figma`.
- **FIGMA_TOKEN** configured for live Figma URLs
- **Figma Full seat + file edit permission** (required for `use_figma` to modify the design)

## Workflow

### Step 0: Verify Figma MCP tools are loaded

Before Step 1, verify that `use_figma` is callable in **this** session — not merely listed in `.mcp.json`. Newly registered MCP servers (e.g. via `claude mcp add -s project -t http figma https://mcp.figma.com/mcp`) require a Claude Code restart to load their tools; reading `.mcp.json` is not a substitute for checking the live tool list you have access to right now.

If `use_figma` is unavailable in the current session, **Do NOT proceed to Step 1**. Steps 1 (analyze) and 3 (gotcha-survey) spend real Figma API calls and 5–15 minutes of human survey time before Step 4 would otherwise discover `use_figma` is missing. Halt immediately and tell the user:

1. Confirm `.mcp.json` registers the Figma MCP entry (e.g. `figma` under `mcpServers`).
2. Restart Claude Code so the newly registered tools load.
3. Re-invoke `/canicode-roundtrip <url>`.

See the Edge Case **No Figma MCP server** below for the one-way fallback when Figma MCP genuinely cannot be installed — the precheck above is for the common "installed but not restarted" case, not a replacement for that fallback.

### Step 1: Analyze the design

If the `analyze` MCP tool is available, call it with the user's Figma URL:

```
analyze({ input: "<figma-url>" })
```

**Without canicode MCP** — shell out to the CLI (same JSON shape):

```bash
npx canicode analyze "<figma-url>" --json
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

If the `gotcha-survey` MCP tool is available, call it:

```
gotcha-survey({ input: "<figma-url>" })
```

**Without canicode MCP** — shell out to the CLI (same JSON shape):

```bash
npx canicode gotcha-survey "<figma-url>" --json
```

If `questions` is empty, skip to **Step 6**.

For each question in the `questions` array, present it to the user one at a time.

Build the message from the question fields. **If `question.instanceContext` is present**, prepend one line before the question body:

```
_Instance note: This layer is inside an instance. Layout and size fixes may need to be applied on source component **{sourceComponentName or sourceComponentId or "unknown"}** (definition node `sourceNodeId`) and propagate to all instances — you will be asked to confirm before any definition-level write._
```

**If `question.replicas` is present (#356 dedup)**, prepend a second line noting the answer applies to N instances:

```
_Replicas: This question represents **{replicas} instances** of the same source-component child sharing the same rule. Your single answer will be applied to all of them in Step 4 (one annotation/write per instance scene)._
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

After all questions are answered, **upsert this design's gotcha section** into `.claude/skills/canicode-gotchas/SKILL.md` in the user's project. Read the existing file, then either replace the section whose `Design key` matches this run (same Figma URL → fileKey+nodeId) or append a new numbered section under `# Collected Gotchas`. Never modify anything above the `# Collected Gotchas` heading — the region above it (frontmatter + workflow prose) is the skill loader contract installed by `canicode init`. See the `/canicode-gotchas` skill's "Upsert the gotcha section" step (Step 4) for the exact section format and matching rule.

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
| `annotationProperties` | `Array<{ type: string }>` \| (absent) | Pre-computed Dev Mode annotation `properties` hint for the ruleId (+ subType). Pass directly to `upsertCanicodeAnnotation`. Absent when the rule has no mapping. See the annotation matrix below for the enum + node-type filtering (enforced by the helper's retry path). |
| `suggestedName` | `string` \| (absent) | Naming rules only — pre-capitalized value to write to `node.name` (e.g. `"Hover"`). |
| `isInstanceChild` | `boolean` | Whether the `nodeId` targets a node inside an INSTANCE subtree. |
| `sourceChildId` | `string` \| (absent) | Definition node id inside the source component. Use directly with `figma.getNodeByIdAsync`. |
| `instanceContext` | object \| (absent) | Survey questions only. `{ parentInstanceNodeId, sourceNodeId, sourceComponentId?, sourceComponentName? }` for the Step 3 user-facing note. |
| `replicas` | `number` \| (absent) | Survey questions only (#356). Total instance count when this one question represents N instance-child issues sharing the same `(sourceComponentId, sourceNodeId, ruleId)` tuple. Absent for single-instance questions. |
| `replicaNodeIds` | `string[]` \| (absent) | Survey questions only (#356). All OTHER instance scene node ids the answer should land on. The apply step iterates `[nodeId, ...replicaNodeIds]`. Absent when `replicas` is absent. |

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

#### Annotation `properties` matrix

Experiment 09 ([#290 follow-up](https://github.com/let-sunny/canicode/issues/290)) re-measured the full 33-value enum on a scene FRAME (`3077:9894`) and scene TEXT (`3077:9963`) in the Simple Design System fixture. The key finding: **the gate is node-type, not scene-vs-instance**. FRAMEs reject `fills`/`cornerRadius`/`opacity`/`maxWidth`/`effects` regardless of context. Instance children additionally lose `minWidth`/`minHeight`/`alignItems` on FRAMEs — these are instance-override restrictions layered on top.

Each row below covers the full 33-value enum (`width`, `height`, `maxWidth`, `minWidth`, `maxHeight`, `minHeight`, `fills`, `strokes`, `effects`, `strokeWeight`, `cornerRadius`, `textStyleId`, `textAlignHorizontal`, `fontFamily`, `fontStyle`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `itemSpacing`, `padding`, `layoutMode`, `alignItems`, `opacity`, `mainComponent`, plus 8 grid props `gridRowGap`/`gridColumnGap`/`gridRowCount`/`gridColumnCount`/`gridRowAnchorIndex`/`gridColumnAnchorIndex`/`gridRowSpan`/`gridColumnSpan`):

| Node type | Accepted (scene) | Additionally rejected on instance child | Rejected in all contexts |
|-----------|------------------|-----------------------------------------|--------------------------|
| FRAME | `width`, `height`, `minWidth`, `minHeight`, `itemSpacing`, `padding`, `layoutMode`, `alignItems` | `minWidth`, `minHeight`, `alignItems` | `maxWidth`, `maxHeight`, `fills`, `strokes`, `effects`, `strokeWeight`, `cornerRadius`, `opacity`, `mainComponent`, all 8 text props, all 8 grid props |
| TEXT | `width`, `height`, `fills`, `textStyleId`, `fontFamily`, `fontStyle`, `fontSize`, `fontWeight`, `lineHeight` | not re-measured — Experiment 08 only probed `strokes`/`opacity`/`cornerRadius`/`effects`/`layoutMode`/`itemSpacing`/`padding` on instance-child TEXT, and all were rejected there too | `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `strokes`, `effects`, `strokeWeight`, `cornerRadius`, `opacity`, `textAlignHorizontal`, `letterSpacing`, `itemSpacing`, `padding`, `layoutMode`, `alignItems`, `mainComponent`, all 8 grid props |

`upsertCanicodeAnnotation` wraps the write in `try/catch`: if `properties` fails node-type validation it retries without them, so the markdown body always survives. You can pass `properties` speculatively.

> **Note:** This policy has shipped per ADR-012 (resolves [#295](https://github.com/let-sunny/canicode/issues/295)): **scene write by default; definition write is opt-in** behind `allowDefinitionWrite`. The bundled helper and the prose below match — reading one without the other is safe.

**Write policy (ordered tiers):**

The helper walks the tiers in order; variable binding is an alternative writeFn shape available at tiers 1 and 2 that bypasses the instance-child override gate (Experiment 08) — it is *not* a separate ordering position between the tiers.

1. **Scene (instance) node** — `await figma.getNodeByIdAsync(question.nodeId)` and apply the write inside `try/catch`. If the answer names a design-system token (`{ variable: "name" }`), the helper calls `setBoundVariable` / `setBoundVariableForPaint` first and that binding bypasses the override gate — otherwise it performs a raw-value write. Success → done (local change only). Mark result with ✅.
2. **Definition (source) node — opt-in only** — Runs only when the orchestrator passes `allowDefinitionWrite: true` on the helper context (after a batch-level confirmation naming the source component AND the propagation set). When the flag is off (the ADR-012 default), a recognized instance-override failure (override-error or silent-ignore) short-circuits here and routes directly to tier 3 — the definition node is never touched. When the flag is on, the helper loads `question.sourceChildId` (or walks `getMainComponentAsync()` if needed) and writes using the same bind-if-token-else-raw shape as tier 1; changes propagate to **every non-overridden instance** in the file (Experiment 10). Mark result with 🌐.
3. **Annotation fallback — default path** — Under the ADR-012 default this is where override-errors and silent-ignores land: the helper annotates the **scene** node with markdown that names the source component as the recommended write target and notes that the instance kept its current value to avoid unintended fan-out. When `allowDefinitionWrite` is on, this tier also catches any definition-tier throw (e.g. Experiment 10 external-library read-only case, `mainComponent.remote === true` / *"Cannot write to internal and read-only node"*, and the `mainComponent === null` branch where `getMainComponentAsync()` resolves with no definition to name — see Experiment 11 / ADR-011). Either way, mark result with 📝.

**Confirmation is a batch-level concern — and only needed when opting in.** A `use_figma` call runs one JavaScript batch and cannot pause mid-batch for user input. Under the ADR-012 default (`allowDefinitionWrite: false`), no propagation happens, so no confirmation is required — override-errors annotate and move on. The orchestrator sets `allowDefinitionWrite: true` only after enumerating the likely propagation set to the user up-front and collecting **one confirmation for the whole batch** that names the source component(s) and the affected instance set. When describing impact, note that the write reaches every **non-overridden** instance — any instance with a local override for the same property keeps its override. The helper below never prompts — it assumes that if the flag is on, confirmation already happened.

**Pre-flight writability probe (#357).** Before showing the user the Definition write picker, call `CanICodeRoundtrip.probeDefinitionWritability(questions)` inside a small `use_figma` batch. The probe loads every distinct `sourceChildId` once and classifies it as writable or unwritable using the same detection as the runtime fallback (Experiment 10 `remote === true` and Experiment 11 unresolved-`null`). The result decides which version of the picker to show:

```javascript
// Inside a use_figma batch:
const probe = await CanICodeRoundtrip.probeDefinitionWritability(questions);
return { events: [], probe };
```

Branches on `probe`:

- **`allUnwritable === true`** — every candidate source is in an external library (or unresolved). Opting in is structurally a no-op; every write would throw "Cannot write to internal and read-only node" and fall through to scene annotation anyway. Show the user a single-option picker:

  ```
  Definition write policy

  This file's source components live in an external library and are
  read-only from here ({unwritableSourceNames.join(", ")}). Tier 2
  propagation cannot fire — every "opt-in" write would fall through
  to a scene annotation regardless.

  ❯ 1. Annotate only (only viable option for this file)
    2. Cancel — duplicate the library locally first to enable propagation
  ```

  Skip the opt-in branch entirely and call the helpers with the default `allowDefinitionWrite: false`.

- **`partiallyUnwritable === true`** — some sources are local, some remote. Surface the split:

  ```
  Definition write policy

  {unwritableCount} of {totalCount} source components are remote
  (read-only) and will fall through to annotation; the remaining
  {totalCount - unwritableCount} are local and will propagate.
  Remote sources: {unwritableSourceNames.join(", ")}.

  Continue with allowDefinitionWrite: true?
  ```

  When confirmed, propagate to the local sources and let the helper's runtime fallback annotate the remote ones — the existing Experiment-10 retry path absorbs them without aborting the batch.

- **`allUnwritable === false && partiallyUnwritable === false`** (the all-local / no-candidates case) — show the existing batch-level picker prose. No probe-driven adjustment needed.

The probe is read-only and idempotent; running it before the picker adds one round-trip but saves the user a confusing "I opted in, why did I get annotations?" moment that #342 surfaced live on Simple Design System (Community).

**Shared helpers (bundled)** — the deterministic helpers live in TypeScript at `src/core/roundtrip/*.ts` and are bundled to a single IIFE at `.claude/skills/canicode-roundtrip/helpers.js`. `use_figma` only accepts a self-contained JS string, so the source of truth is TypeScript (with vitest coverage) and the bundle is the delivery artifact.

**Usage in a roundtrip session:**

1. Read `.claude/skills/canicode-roundtrip/helpers.js` once at the start of Step 4.
2. Prepend its contents verbatim at the top of every `use_figma` batch body — it registers a single global `CanICodeRoundtrip`.
3. Reference exposed globals as `CanICodeRoundtrip.*`:
   - `stripAnnotations(annotations)` — normalizes the D1 label/labelMarkdown mutex on readback.
   - `ensureCanicodeCategories()` — returns `{ gotcha, flag, fallback }` category id map (D4); idempotent, safe to call at the top of every batch. May also include `legacyAutoFix` when the file already carries the pre-#355 `canicode:auto-fix` category from earlier roundtrips — read-only on the canicode side, used only by Step 5 cleanup to sweep old annotations.
   - `upsertCanicodeAnnotation(node, { ruleId, markdown, categoryId, properties })` — idempotent annotation upsert. Handles D1 mutex, D2 in-place replace by ruleId prefix, and the D3 `properties` node-type retry.
   - `applyWithInstanceFallback(question, writeFn, { categories, allowDefinitionWrite, telemetry })` — three-tier write policy with silent-ignore detection. `allowDefinitionWrite` defaults to `false` per ADR-012 — override-errors and silent-ignores annotate the scene naming the source component instead of writing the definition. Set `true` only after a batch-level confirmation. `telemetry` is an optional `(event, props) => void` callback fired when a definition write is skipped (wiring point for future Node-side opt-in usage data). The `writeFn` may return `false` to signal "write accepted but value unchanged" so the helper can route to the next tier.
   - `applyPropertyMod(question, answerValue, { categories, allowDefinitionWrite, telemetry })` — Strategy A entry point. Branches on `targetProperty` (single vs array) and answer shape (scalar, per-property object, `{ variable: "name" }` binding). Uses `setBoundVariableForPaint` for `fills` / `strokes` and `setBoundVariable` for scalar fields. Passes the full context through to `applyWithInstanceFallback`.
   - `resolveVariableByName(name)` — local-variable exact-name lookup; returns `null` for remote library variables not imported into this file.
   - `probeDefinitionWritability(questions)` — async pre-flight (#357). Returns `{ totalCount, unwritableCount, unwritableSourceNames, allUnwritable, partiallyUnwritable }`. Use BEFORE the Definition write picker so the picker can drop the opt-in branch when every candidate is in an external library / unresolved (saves the user a wasted "I opted in, why did I get annotations?" decision). Read-only probe, dedupes by `sourceChildId`.

Keep each `writeFn` small so a throw does not abort unrelated writes. Experiment 08 findings informed every branch in the bundled helpers, and the batch-level confirmation contract still applies *when opting in*: if the orchestrator passes `allowDefinitionWrite: true`, it must have already collected one confirmation covering every potential definition write in the batch. Under the default, no confirmation is needed — the helper annotates the scene instead of propagating.

Wrap every property write in `CanICodeRoundtrip.applyWithInstanceFallback(question, async (target) => { ... }, { categories })` so failed or silently-ignored instance overrides route to the scene annotation (or, when the user has opted in, to the definition tier) instead of silently aborting the batch.

#### Strategy A: Property Modification — apply directly

Rules with `applyStrategy === "property-mod"`. Call the bundled helper — it branches on `question.targetProperty` (single vs array) and on each value type (scalar, multi-property object, `{ variable: "token-name" }` binding) automatically. Paint properties (`fills`, `strokes`) are bound with `setBoundVariableForPaint` per the Plugin API contract; scalar fields use `setBoundVariable`.

```javascript
await CanICodeRoundtrip.applyPropertyMod(question, answerValue, { categories });
```

**Replicas (#356)** — when `question.replicaNodeIds` is present, the same answer must land on every replica instance. Iterate the merged set so each scene gets its own per-node failure routing (under the ADR-012 default each replica annotates independently; with `allowDefinitionWrite: true` they share the one definition write because they share the source):

```javascript
const targets = [question.nodeId, ...(question.replicaNodeIds ?? [])];
for (const nodeId of targets) {
  await CanICodeRoundtrip.applyPropertyMod({ ...question, nodeId }, answerValue, { categories });
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

Rules with `applyStrategy === "annotation"` cannot be auto-fixed via Plugin API. Add the gotcha answer as a Figma annotation so designers see it in Dev Mode. Use the helper — it handles the D1 mutex, D2 in-place upsert, and D4 category assignment. When `question.replicaNodeIds` is present (#356), iterate the merged set so every replica instance gets the annotation:

```javascript
const targets = [question.nodeId, ...(question.replicaNodeIds ?? [])];
for (const nodeId of targets) {
  const scene = await figma.getNodeByIdAsync(nodeId);
  CanICodeRoundtrip.upsertCanicodeAnnotation(scene, {
    ruleId: question.ruleId,
    markdown: `**Q:** ${question.question}\n**A:** ${answer}`,
    categoryId: categories.gotcha,
    // Optional: surface live property values in Dev Mode alongside the note.
    // Only include types the node supports (FRAME vs TEXT — see matrix above).
    properties: question.annotationProperties,
  });
}
```

Notes:
- `upsertCanicodeAnnotation` writes the recommendation directly as the body and appends an italic `— *<ruleId>*` footer. The footer is the dedup marker — reruns replace the existing entry in place. The category badge (`canicode:gotcha` / `canicode:flag` / `canicode:fallback`) above the body already brands the annotation, so the body no longer leads with `**[canicode] <ruleId>**` (#353). Pre-#353 entries are still recognised on rerun and replaced with the new format.
- `label` and `labelMarkdown` are mutually exclusive on write, but Figma returns both on readback. Never spread `scene.annotations` directly; always call `CanICodeRoundtrip.upsertCanicodeAnnotation` (or `CanICodeRoundtrip.stripAnnotations` if you truly need the normalized array).
- Prefer annotating the **scene** instance child so designers see the note where they work; mention in the markdown if the fix belongs on the source component but could not be applied (library/external).

#### Strategy D: Auto-fix lower-severity issues from analysis

The gotcha survey covers only blocking/risk severity. Lower-severity rules appear in `analyzeResult.issues[]` without a survey question. Each issue carries the same pre-computed fields (`applyStrategy`, `targetProperty`, `annotationProperties`, `suggestedName`, `isInstanceChild`, `sourceChildId`). Loop over them:

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
    await CanICodeRoundtrip.applyWithInstanceFallback(q, async (target) => {
      if (target) target.name = issue.suggestedName;
    }, { categories });
  } else {
    // raw-value, missing-interaction-state, missing-prototype — designer judgment; annotate.
    const scene = await figma.getNodeByIdAsync(issue.nodeId);
    CanICodeRoundtrip.upsertCanicodeAnnotation(scene, {
      ruleId: issue.ruleId,
      markdown: issue.message,
      categoryId: categories.flag,
      // Optional: surface the live value for the affected property in Dev Mode.
      properties: issue.annotationProperties,
    });
  }
}
```

`suggestedName` is already capitalized for direct Plugin-API use (e.g. `"Hover"`, `"Default"`, `"Pressed"`). Do not transform it further.

#### Execution order

0. **Initialize categories** — first batch calls `const categories = await CanICodeRoundtrip.ensureCanicodeCategories();` and keeps the result in scope for every subsequent call in the same script. (Or re-run ensure at the top of each `use_figma` batch — it is idempotent by label.)
1. **Batch all property modifications** (Strategy A) into a single `use_figma` call for efficiency. Pass `{ categories }` to `applyWithInstanceFallback` so fallbacks land in the correct category.
2. **Present structural modifications** (Strategy B) one by one, apply confirmed ones.
3. **Batch all annotations** (Strategy C + declined structural mods) into a single `use_figma` call — use `categories.gotcha` for the category id.
4. **Batch all auto-fixes and annotations for lower-severity issues** (Strategy D) — use `categories.flag` for annotated ones (renamed from `autoFix` per #355 — the category means "flagged for designer attention", not "fixed"), `categories.fallback` is reserved for errors surfaced by `applyWithInstanceFallback` itself.

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
- 📝 {nodeName}: annotation added to canicode:flag — raw color needs token binding (raw-value)
```

### Step 5: Re-analyze and report what the roundtrip addressed

Run `analyze` again on the same Figma URL:

```
analyze({ input: "<figma-url>" })
```

Under ADR-012's annotate-by-default policy, most instance-child gotchas route to 📝 annotations and do **not** move the numeric grade — so the headline for this step is the **issues-delta** (what the roundtrip captured), not a grade comparison. Grade is kept as a footnote so the Row 8 regression guardrail still applies.

**Tally inputs** — derive the counts from the data you already have:
- `X` (✅ resolved): count of ✅ + 🔧 + 🔗 markers from the Step 4 report block you just emitted (scene/instance-child writes, auto-fix renames, and variable bindings all successfully landed the value).
- `Y` (📝 annotated): count of 📝 markers from Step 4 — gotcha answers captured as Figma annotations for code-gen reference.
- `Z` (🌐 definition writes): count of 🌐 markers from Step 4 — only non-zero when the orchestrator opted in with `allowDefinitionWrite: true` (helper context option, not a CLI flag).
- `W` (⏭️ skipped): count of ⏭️ markers from Step 4 plus any Step 3 questions the user answered with `skip` or `n/a`.
- `V` (remaining): `issues.length` from the re-analyze response — unresolved gotchas plus non-actionable rules still flagged by the design.
- `N` (addressed) = `X + Y + Z + W`.

If Step 4 produced no report block (e.g. user skipped every question, or no gotcha survey ran), all four counts are zero — that is a legitimate outcome; report the breakdown with zeros rather than treating it as an error.

**All gotcha issues resolved** (`V == 0`, i.e. re-analyze surfaces no remaining issues — note this is independent of grade since ADR-012 annotations do not move the score):
- Tell the user (fill in the counts from the tally above):

  ```
  Roundtrip complete — N issues addressed:
    ✅  X resolved (auto-fix or property write succeeded)
    📝  Y annotated on Figma (gotcha answers captured for code-gen)
    🌐  Z definition writes propagated (only when allowDefinitionWrite: true)
    ⏭️  W skipped (user declined or "skip")
    —
    V issues remaining (unresolved gotchas + non-actionable rules)

  Grade: {oldGrade} → {newGrade}. Ready for code generation.
  ```
- Clean up canicode annotations on fixed nodes via `use_figma`. Filter by **categoryId** (the durable canicode-side identifier — the body no longer carries a `[canicode]` prefix per #353). Include `legacyAutoFix` if `ensureCanicodeCategories` returned it, so pre-#355 `canicode:auto-fix` entries get swept too. The trailing `— *<ruleId>*` footer is kept as a secondary marker for legacy `[canicode]`-prefix entries that may exist on files that have not been re-roundtripped yet:
```javascript
const canicodeIds = new Set(
  [categories.gotcha, categories.flag, categories.fallback, categories.legacyAutoFix].filter(Boolean)
);
const nodeIds = ["id1", "id2"]; // nodes that now pass
for (const id of nodeIds) {
  const node = await figma.getNodeByIdAsync(id);
  if (node && "annotations" in node) {
    node.annotations = CanICodeRoundtrip.stripAnnotations(node.annotations).filter(
      a => !(a.categoryId && canicodeIds.has(a.categoryId)) &&
           !a.labelMarkdown?.startsWith("**[canicode]")
    );
  }
}
```
- Proceed to **Step 6**.

**Some issues remain** (`V > 0`):
- Show the same breakdown and ask whether to proceed:

  ```
  Roundtrip complete — N issues addressed:
    ✅  X resolved (auto-fix or property write succeeded)
    📝  Y annotated on Figma (gotcha answers captured for code-gen)
    🌐  Z definition writes propagated (only when allowDefinitionWrite: true)
    ⏭️  W skipped (user declined or "skip")
    —
    V issues remaining (unresolved gotchas + non-actionable rules)

  Grade: {oldGrade} → {newGrade}. Proceed to code generation with remaining context?
  ```
- If yes → proceed to **Step 6** with remaining gotcha context.
- If no → stop and emit the **Stop wrap-up** below; do **not** restate the grade as the lead.

#### Wrap-up message rubric (Stop branch)

When the user picks **Stop** here, the closing message is the *last thing the user sees of canicode* in this session. Keep the issues-delta as the headline (`✅ X / 📝 Y / 🌐 Z / ⏭️ W / V remaining`) — grade movement, if any, belongs as a footnote line **after** the delta, not as the lead bullet. Reason: the value canicode delivers under the ADR-012 default is the annotation count carried into code-gen, not score movement (per [#341](https://github.com/let-sunny/canicode/issues/341), [#352](https://github.com/let-sunny/canicode/issues/352)).

```
Stopped — N issues addressed, V remaining for manual follow-up:
  ✅  X resolved
  📝  Y annotated on Figma (carried into code-gen via canicode-gotchas)
  🌐  Z definition writes propagated
  ⏭️  W skipped

Grade: {oldGrade} → {newGrade}.
```

Anti-pattern (do **not** lead with a grade-only sentence like "Grade: C → C+. Most size-constraint gotchas are now annotations…"). Lead with the delta block; mention grade once, on its own footnote line, plain prose only.

### Step 6: Implement with Figma MCP

Follow the **figma-implement-design** skill workflow to generate code from the Figma design.

**If annotations or unresolved gotchas remain from Step 5**, provide them as additional context when implementing:

- Gotchas with severity **blocking** MUST be addressed — the design cannot be implemented correctly without this information
- Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
- Reference the specific node IDs from gotcha answers to locate the affected elements in the design
- Pass the Figma URL (or `designKey` = `<fileKey>#<nodeId>`) to `figma-implement-design` so it can grep the matching `## #NNN — …` section in `.claude/skills/canicode-gotchas/SKILL.md` instead of reading the whole accumulated file

**If all issues were resolved in Steps 4-5**, no additional gotcha context is needed — the design speaks for itself.

#### Wrap-up message rubric (post-handoff)

After `figma-implement-design` returns, summarise the roundtrip in the same shape as the Step 5 / Stop wrap-up — issues-delta first, grade as a footnote, then the code-gen outcome. Do **not** lead with grade movement (per [#352](https://github.com/let-sunny/canicode/issues/352)):

```
Roundtrip complete — N issues addressed, code generated:
  ✅  X resolved
  📝  Y annotated on Figma (referenced during code-gen)
  🌐  Z definition writes propagated
  ⏭️  W skipped
  —
  V issues remaining

Grade: {oldGrade} → {newGrade}.
Code: <files generated / next-step pointer from figma-implement-design>
```

## Edge Cases

- **No canicode MCP server**: Fall back to `npx canicode analyze --json` and `npx canicode gotcha-survey --json` — both CLI commands return the same shape as the MCP tools. The Figma MCP is still required for `use_figma` in Step 4; there is no CLI fallback for Figma design edits.
- **No Figma MCP server**: If `get_design_context` or `use_figma` is not found, tell the user to set up the Figma MCP server. Without it, the apply and code generation phases cannot proceed.
- **No edit permission**: If `use_figma` fails with a permission error, tell the user they need Full seat + file edit permission. Fall back to the one-way flow: skip Steps 4-5 and proceed directly to Step 6 with gotcha answers as code generation context.
- **User wants analysis only**: Suggest using `/canicode` instead — it runs analysis without the code generation phase.
- **User wants gotcha survey only**: Suggest using `/canicode-gotchas` instead — it runs the survey and saves answers as a persistent skill file.
- **Partial gotcha answers**: Apply only the answered questions. Skipped/n/a questions are neither applied nor annotated.
- **use_figma call fails for a node**: Report the error for that specific node, continue with other nodes. Failed property modifications become annotations so the context is not lost.
- **Re-analyze shows new issues**: Only address issues from the original gotcha survey. New issues may appear due to structural changes — report them but do not re-enter the gotcha loop.
- **Very large design (many gotchas)**: The gotcha survey already deduplicates sibling nodes and filters to blocking/risk severity only. If there are still many questions, ask the user if they want to focus on blocking issues only.
- **External library components**: Applies only when the orchestrator has set `allowDefinitionWrite: true`. Experiment 10's observed case is `getMainComponentAsync()` resolving with `mainComponent.remote === true` — writes then throw *"Cannot write to internal and read-only node"*. The `mainComponent === null` case is documented in the Plugin API but was not reproduced live in Experiment 10; Experiment 11 (#309) unit-test-covers the helper's routing for that branch (override-error + no `sourceChildId` → annotate with `could not apply automatically:` markdown — see ADR-011 Verification), so the code path is regression-locked while live Figma reproduction remains a manual fixture-seeding follow-up. Under the default (`allowDefinitionWrite: false`), the definition write never fires and this throw cannot surface. **The pre-flight `probeDefinitionWritability` (#357) detects both branches up-front** so the Definition write picker can drop the opt-in option entirely when every candidate is unwritable, saving the user a wasted decision before the runtime fallback kicks in.
