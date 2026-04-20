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

#### Step 3a: Why the response carries a pre-grouped+batched view

The naive "one-question-at-a-time" loop produces two well-known UX failures on real designs:

- **Repeated Instance note (#370)** — when 10 consecutive questions share the same `instanceContext.sourceComponentId`, the standard "_Instance note: …source component **X**…_" paragraph prints 10 times. After the first occurrence it adds zero new information and consumes ~2 screens of vertical space.
- **Repeated identical answer (#369)** — when 7 consecutive questions all carry the same `ruleId` (e.g. `missing-size-constraint`) and the user's reasonable answer would be the same for all of them (e.g. `min-width: 320px, max-width: 1200px`), the user types the same thing 7 times in a row.

`gotcha-survey` already ships the resolution on its `groupedQuestions` field. Sort key (`(sourceComponentId ?? "_no-source", ruleId, nodeName)`), source-component grouping, and the batchable-rule whitelist (`missing-size-constraint`, `irregular-spacing`, `no-auto-layout`, `fixed-size-in-auto-layout`) all live in `core/gotcha/group-and-batch-questions.ts` with vitest coverage. Per ADR-016, do **not** re-implement the sort, partition, or whitelist in prose — iterate over `groupedQuestions.groups[].batches[]` directly.

#### Step 3b: Prompt each group, then each batch within it

For each `group` in `response.groupedQuestions.groups`:

- **`group.instanceContext === null`** — this is the trailing group of non-instance questions. Skip the header and prompt each batch directly.
- **`group.instanceContext !== null`** — emit the Instance note **once** as a group header (#370):

  ```
  ─────────────────────────────────────────
  The next {sum of batch.questions.length} questions all target instance children of source component **{instanceContext.sourceComponentName ?? instanceContext.sourceComponentId ?? "unknown"}** (definition node `{instanceContext.sourceNodeId}`). Layout and size fixes may need to apply on the source and propagate to all instances — you will be asked to confirm before any definition-level write.
  ─────────────────────────────────────────
  ```

For each `batch` inside the group:

- **`batch.questions.length === 1`** — render the standard single-question block for `batch.questions[0]`:

  ```
  **[{severity}] {ruleId}** — node: {nodeName}

  {question}

  > Hint: {hint}
  > Example: {example}
  ```

  **If `question.replicas` is present (#356 dedup)**, prepend one note above the standard block:

  ```
  _Replicas: This question represents **{replicas} instances** of the same source-component child sharing the same rule. Your single answer will be applied to all of them in Step 4 (one annotation/write per instance scene)._
  ```

- **`batch.questions.length >= 2 && batch.batchable === true`** (#369) — render one batch prompt covering all members. Use `batch.totalScenes` (already summed across each member's `replicas`) for the Figma-scene fan-out hint:

  ```
  **[{severity}] {batch.ruleId}** — {batch.questions.length} instances:
    - {nodeName₁}{ruleSpecificContext₁}
    - {nodeName₂}{ruleSpecificContext₂}
    - …

  {sharedQuestionPrompt}

  Reply with one answer to apply to all {batch.questions.length}, or **split** to answer each individually.

  > Hint: {hint}
  > Example: {example}
  ```

  Where:
  - `sharedQuestionPrompt` is the rule's `question` text with the per-node noun replaced by the rule's plural noun (e.g. "These layers all use FILL sizing without min/max constraints. What size boundaries should they share?" instead of repeating "What size boundaries should this layer have?" N times).
  - `ruleSpecificContext` is short and rule-specific: e.g. for `missing-size-constraint` show the current `width`/`height` if the question has them; for `irregular-spacing` show the current `itemSpacing`; otherwise omit.
  - On `split`, fall back to the per-question loop for that batch only — keep the rest of the group's batches as-is.

  When `batch.totalScenes > batch.questions.length` (at least one member carries replicas), append one note so the user knows their single answer fans out further than the listed nodes:

  ```
  _Replicas: your one answer will land on **{batch.totalScenes}** Figma scenes total in Step 4 (some of these {batch.questions.length} questions already represent multiple instances of the same source-component child)._
  ```

- **`batch.batchable === false`** is always rendered as a single-question prompt — the helper guarantees `questions.length === 1` for those (identity-typed answers like `non-semantic-name`, structural-mod rules).

Wait for the user's answer before moving to the next batch. For each batch, the user may:
- Answer the question directly (single value covers all batch members)
- Say **split** (batch only) to fall back to per-question prompting for that batch
- Say **skip** to skip the question / the entire batch
- Say **n/a** if the question / the entire batch is not applicable

When applying the batched answer, expand back to per-question records before storing — the gotcha section format and Step 4 apply loop both expect one record per `nodeId`.

After all questions are answered, **upsert this design's gotcha section** into `.claude/skills/canicode-gotchas/SKILL.md` in the user's project. Read the existing file, then either replace the section whose `Design key` matches `survey.designKey` (the canonical identifier the gotcha-survey response carries — see `/canicode-gotchas` Step 4a) or append a new numbered section under `# Collected Gotchas`. Never modify anything above the `# Collected Gotchas` heading — the region above it (frontmatter + workflow prose) is the skill loader contract installed by `canicode init`. See the `/canicode-gotchas` skill's "Upsert the gotcha section" step (Step 4) for the exact section format and matching rule.

Then proceed to **Step 4** to apply answers to the Figma design.

### Step 4: Apply gotcha answers to Figma design

For each answered gotcha (skip questions answered with "skip" or "n/a"), branch on the pre-computed `question.applyStrategy`. The routing table, target properties, and instance-child resolution are resolved server-side by `canicode` — do NOT re-derive them from the rule id. The `fileKey` is not needed at this step — the bundled helpers operate on `nodeId` directly.

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
3. **Annotation fallback — default path** — Under the ADR-012 default this is where override-errors and silent-ignores land: the helper annotates the **scene** node with markdown that names the actual no-op (the property silently ignored the write or the override was rejected) and points to the source component as the correct write target. When `allowDefinitionWrite` is on, this tier also catches any definition-tier throw (e.g. Experiment 10 external-library read-only case, `mainComponent.remote === true` / *"Cannot write to internal and read-only node"*, and the `mainComponent === null` branch where `getMainComponentAsync()` resolves with no definition to name — see Experiment 11 / ADR-011). Either way, mark result with 📝.

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
   - `extractAcknowledgmentsFromNode(node, canicodeCategoryIds?)` — synchronous pure helper (#371). Reads one node's annotations and returns `{ nodeId, ruleId }[]` for entries gated by canicode `categoryId` plus a recognisable `— *<ruleId>*` footer (or legacy `**[canicode] <ruleId>**` prefix). When `canicodeCategoryIds` is omitted, footer-text matching alone is sufficient (test mode).
   - `readCanicodeAcknowledgments(rootNodeId, categories?)` — async tree walker (#371). Loads `rootNodeId` via `figma.getNodeByIdAsync`, recurses through `children`, and accumulates one acknowledgment per recognised entry. Used at the top of Step 5a to harvest the side channel that lets the analysis pipeline distinguish "still broken" from "the designer has a plan" — pass the result straight to `analyze({ acknowledgments })`. Errors on individual nodes are swallowed so locked / external nodes don't abort the sweep.
   - `computeRoundtripTally({ stepFourReport, reanalyzeResponse })` — pure helper (#383). Takes the structured Step 4 outcome counts (`{ resolved, annotated, definitionWritten, skipped }`) plus a narrowed re-analyze view (`{ issueCount, acknowledgedCount }`) and returns `{ X, Y, Z, W, N, V, V_ack, V_open }`. Replaces the LLM-side emoji-bullet re-counting in Step 5 — render the returned object directly into the wrap-up templates. Throws when `acknowledgedCount > issueCount` (impossible state).
   - `applyAutoFix(issue, { categories, allowDefinitionWrite?, telemetry? })` — Strategy D entry point (#386). Branches on `targetProperty === "name" && suggestedName` once: renames the node via `applyWithInstanceFallback` (so naming auto-fixes share the same tier-1/2/3 policy as Strategy A) or writes a `categories.flag` annotation carrying `issue.message` and `issue.annotationProperties`. Returns one `AutoFixOutcome` (`{ outcome, nodeId, nodeName, ruleId, label }`) where `outcome` is `🔧` / `🌐` / `📝` so Step 4 can bump the structured `stepFourReport` counters without parsing prose. Replaces the inline JS the SKILL used to carry (per ADR-016).
   - `applyAutoFixes(issues, { categories, allowDefinitionWrite?, telemetry? })` — loop wrapper (#386). Filters `issues` to `applyStrategy === "auto-fix"` (skipped entries surface as `⏭️` outcomes for symmetry) and applies each one in sequence. Returns the full `AutoFixOutcome[]`.
   - `removeCanicodeAnnotations(annotations, categories)` — pure filter. Returns `annotations` with every canicode-authored entry removed (gates on `categories.gotcha` / `flag` / `fallback` / `legacyAutoFix` plus the legacy `**[canicode]` body prefix). Use after `stripAnnotations` in the Step 5 cleanup loop — replaces the inline filter predicate the SKILL used to carry. `isCanicodeAnnotation(annotation, categories)` is the single-entry version, exported for callers that need the predicate alone.

Keep each `writeFn` small so a throw does not abort unrelated writes. Experiment 08 findings informed every branch in the bundled helpers, and the batch-level confirmation contract still applies *when opting in*: if the orchestrator passes `allowDefinitionWrite: true`, it must have already collected one confirmation covering every potential definition write in the batch. Under the default, no confirmation is needed — the helper annotates the scene instead of propagating.

Wrap every property write in `CanICodeRoundtrip.applyWithInstanceFallback(question, async (target) => { ... }, { categories })` so failed or silently-ignored instance overrides route to the scene annotation (or, when the user has opted in, to the definition tier) instead of silently aborting the batch.

#### Strategy A: Property Modification — apply directly

Rules with `applyStrategy === "property-mod"`. Call the bundled helper — it branches on `question.targetProperty` (single vs array) and on each value type (scalar, multi-property object, `{ variable: "token-name" }` binding) automatically. Paint properties (`fills`, `strokes`) are bound with `setBoundVariableForPaint` per the Plugin API contract; scalar fields use `setBoundVariable`.

```javascript
await CanICodeRoundtrip.applyPropertyMod(question, answerValue, { categories });
```

**Replicas (#356)** — when `question.replicaNodeIds` is present, the same answer must land on every replica instance. Iterate the merged set so each scene gets its own per-node failure routing (under the ADR-012 default each replica annotates independently; with `allowDefinitionWrite: true` they share the one definition write because they share the source):

<!-- adr-016-ack: fan-out over an explicit small array of node IDs; the deterministic work lives inside applyPropertyMod -->
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

> **Instance-child guard (#368).** Strategy B mutations restructure the layer tree — `createComponentFromNode`, `flatten`, wrapper removal, instance-link reconnection. None of these compose safely with the Plugin API's instance-override rules: on a node where `question.isInstanceChild === true`, calling `createComponentFromNode` either throws *"Cannot create a component from a node inside an instance"* or detaches the parent instance entirely (the picked instance is replaced by a one-off frame, severing every existing override and propagation link). Restructuring deep-nested wrappers inside an instance child has the same risk surface — even when the call doesn't throw, the resulting structure cannot ride the source-component's propagation in future updates.
>
> Before showing the per-rule prompt below, check `question.isInstanceChild`. If it is true, **do not run the destructive call**. Surface this a/b prompt instead and default to **(a)**:
>
> ```
> **{ruleId}** would normally restructure **{nodeName}** here, but this node lives inside instance **{instanceContext.parentInstanceNodeId}** of source component **{instanceContext.sourceComponentName or sourceComponentId or "unknown"}** (definition node `{instanceContext.sourceNodeId}`). On instance children Plugin API restructuring either fails outright or detaches the parent instance.
>
> ❯ a) Annotate the scene with a recommendation to apply the change on the source definition (safe — picks up via canicode-gotchas in code-gen, source designer can act on it later)
>   b) Detach the parent instance and attempt the restructuring on the resulting one-off frame (destructive — every existing instance override is lost and the node no longer rides the source component's propagation)
> ```
>
> On **(a)**, route to Strategy C — call `upsertCanicodeAnnotation(scene, { ruleId: question.ruleId, markdown: "**Q:** … **A:** Apply on source definition `${instanceContext.sourceNodeId}` (`${instanceContext.sourceComponentName ?? "unknown"}`) — instance-child restructuring would detach the parent instance.", categoryId: categories.gotcha })`. Reference `instanceContext.sourceComponentName` and `instanceContext.sourceNodeId` in the body so the source designer can locate the target.
>
> On **(b)**, gate behind a second confirmation that explicitly names the side effects ("This will detach instance **{parentInstanceNodeId}** — all overrides on it will be lost and it will stop receiving updates from **{sourceComponentName}**. Type the parent instance name to confirm."). Only then execute the per-rule destructive call below.
>
> The same posture as ADR-012's `allowDefinitionWrite: false` default: instance-child structural mutations are off-by-default and require explicit user opt-in *per node*, not per batch — the destructive call here doesn't have a quiet fallback the way Strategy A's `applyWithInstanceFallback` does.

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

If the user **declines** any structural modification (or the instance-child guard above routes to **(a)**), add an annotation instead (same as Strategy C).

#### Strategy C: Annotation — record on the design for designer reference

Rules with `applyStrategy === "annotation"` cannot be auto-fixed via Plugin API. Add the gotcha answer as a Figma annotation so designers see it in Dev Mode. Use the helper — it handles the D1 mutex, D2 in-place upsert, and D4 category assignment. When `question.replicaNodeIds` is present (#356), iterate the merged set so every replica instance gets the annotation:

<!-- adr-016-ack: fan-out over an explicit small array of node IDs; the deterministic work lives inside upsertCanicodeAnnotation -->
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

The gotcha survey covers only blocking/risk severity. Lower-severity rules appear in `analyzeResult.issues[]` without a survey question. Each issue carries the same pre-computed fields (`applyStrategy`, `targetProperty`, `annotationProperties`, `suggestedName`, `isInstanceChild`, `sourceChildId`). The bundled helper handles the loop, the filter (`applyStrategy === "auto-fix"`), the naming-vs-annotation branch, and the per-issue outcome accumulator in one call:

```javascript
const outcomes = await CanICodeRoundtrip.applyAutoFixes(analyzeResult.issues, { categories });
```

`outcomes` is an array of `{ outcome, nodeId, nodeName, ruleId, label }`. `outcome` is one of `🔧` (rename succeeded), `🌐` (definition write propagated — only when `allowDefinitionWrite: true`), `📝` (annotation written, including the fallback path), or `⏭️` (issue's `applyStrategy` was not `"auto-fix"` so it was skipped). Bump the matching `stepFourReport` counter for each entry — `🔧` → `resolved`, `🌐` → `definitionWritten`, `📝` → `annotated`, `⏭️` → `skipped` — so the Step 5 tally (`CanICodeRoundtrip.computeRoundtripTally`, #383) consumes the same structured shape as Strategies A/B/C.

`suggestedName` is already capitalized for direct Plugin-API use (e.g. `"Hover"`, `"Default"`, `"Pressed"`). The helper writes it through `applyWithInstanceFallback` so locked / read-only / instance-override nodes annotate cleanly instead of aborting the batch — see the source at `src/core/roundtrip/apply-auto-fix.ts` (#386, ADR-016).

#### Execution order

0. **Initialize categories** — first batch calls `const categories = await CanICodeRoundtrip.ensureCanicodeCategories();` and keeps the result in scope for every subsequent call in the same script. (Or re-run ensure at the top of each `use_figma` batch — it is idempotent by label.)
1. **Batch all property modifications** (Strategy A) into a single `use_figma` call for efficiency. Pass `{ categories }` to `applyWithInstanceFallback` so fallbacks land in the correct category.
2. **Present structural modifications** (Strategy B) one by one, apply confirmed ones.
3. **Batch all annotations** (Strategy C + declined structural mods) into a single `use_figma` call — use `categories.gotcha` for the category id.
4. **Batch all auto-fixes and annotations for lower-severity issues** (Strategy D) — use `categories.flag` for annotated ones (renamed from `autoFix` per #355 — the category means "flagged for designer attention", not "fixed"), `categories.fallback` is reserved for errors surfaced by `applyWithInstanceFallback` itself.

After applying, **emit a structured `stepFourReport`** alongside the human-readable per-question lines. Step 5 reads from this object — it does **not** re-parse the per-question lines (per ADR-016). Increment each counter as Strategy A/B/C/D complete:

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

stepFourReport = {
  resolved: <count of ✅ + 🔧 + 🔗 lines>,        // scene writes, auto-fix renames, variable bindings
  annotated: <count of 📝 lines>,                 // including ⏭️ declines that fell back to annotation
  definitionWritten: <count of 🌐 lines>,         // only non-zero with allowDefinitionWrite: true
  skipped: <count of ⏭️ lines + Step 3 skip/n/a>  // user-declined questions
}
```

Hold `stepFourReport` in scope through Step 5 — it is the input to `CanICodeRoundtrip.computeRoundtripTally` below.

### Step 5: Re-analyze and report what the roundtrip addressed

#### Step 5a: Harvest canicode-authored annotations as acknowledgments (#371)

Before re-running `analyze`, collect every `(nodeId, ruleId)` pair that Step 4 wrote as a Figma annotation. The REST API does not expose annotations, so this side channel is the only way the analysis pipeline learns that a roundtrip-touched issue is "the designer has a plan" rather than "still broken". Without it the grade and issue count look identical to the pre-roundtrip state — `32 → 32` — even when every gotcha has been captured per ADR-012.

Run a short `use_figma` batch that walks the same subtree the original `analyze` covered (`targetNodeId` if you used one, else `figma.root.id`), reads canicode-categorised annotations, and serialises the result:

```javascript
// Inside a use_figma batch:
const categories = await CanICodeRoundtrip.ensureCanicodeCategories();
const acknowledgments = await CanICodeRoundtrip.readCanicodeAcknowledgments(
  targetNodeId ?? figma.root.id,
  categories
);
return { events: [], acknowledgments };
```

`readCanicodeAcknowledgments` walks `node.children` recursively, gates on the `canicode:gotcha` / `canicode:flag` / `canicode:fallback` (and legacy `canicode:auto-fix`) category ids, and extracts the ruleId from the annotation footer (`— *<ruleId>*`) or the legacy `**[canicode] <ruleId>**` prefix. The categoryId guard keeps user-authored notes that happen to end in italic kebab-case from being mistaken for canicode acknowledgments.

#### Step 5b: Re-analyze with acknowledgments

Pass the harvested array straight into `analyze` so the engine flags matching issues as `acknowledged: true` and the density score gives them half weight:

```
analyze({ input: "<figma-url>", acknowledgments })
```

**Without canicode MCP** — the CLI accepts the same input via `--acknowledgments <path>` (JSON file containing the array). Write the array to a temp file from the `use_figma` return, then:

```bash
npx canicode analyze "<figma-url>" --json --acknowledgments /tmp/canicode-acks.json
```

The response now carries:
- `acknowledgedCount` (top level) — how many issues matched an acknowledgment.
- `issues[i].acknowledged: true` (per matched issue) — survives into the report and downstream skills.
- `summary` text — when `acknowledgedCount > 0`, the Total line reads `Total: N (A acknowledged via canicode annotations / N-A unaddressed)`.

Under ADR-012's annotate-by-default policy, most instance-child gotchas route to 📝 annotations and do **not** move the numeric grade — but the half-weight density now produces a small visible movement when annotations are recognised. The headline for this step remains the **issues-delta** (what the roundtrip captured); grade movement is a secondary signal.

**Tally** — call `CanICodeRoundtrip.computeRoundtripTally` with the structured `stepFourReport` you assembled in Step 4 and the re-analyze response from Step 5b. The helper handles every count derivation (`N = X + Y + Z + W`, `V_open = V - V_ack`) and validates that `acknowledgedCount` cannot exceed `issueCount`. Render the returned `{ X, Y, Z, W, N, V, V_ack, V_open }` straight into the templates below — do **not** re-derive any of these from the Step 4 prose:

```javascript
const tally = CanICodeRoundtrip.computeRoundtripTally({
  stepFourReport,                  // the object emitted at the end of Step 4
  reanalyzeResponse: {             // narrowed view of the re-analyze response
    issueCount: response.issueCount,
    acknowledgedCount: response.acknowledgedCount,
  },
});
```

If Step 4 produced no `stepFourReport` (e.g. user skipped every question, or no gotcha survey ran), pass an all-zero object — `tally.N === 0`, `tally.V_open === tally.V`, and the templates below render the breakdown with zeros rather than treating it as an error. (Skipping Step 5a and passing no `acknowledgments` argument is also valid in this case — the response simply has `acknowledgedCount: 0`.)

**All gotcha issues resolved** (`V == 0`, i.e. re-analyze surfaces no remaining issues — note this is mostly independent of grade since ADR-012 annotations only move the score by the half-weight reduction enabled in Step 5b):
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
- Clean up canicode annotations on fixed nodes via `use_figma`. Use the bundled `removeCanicodeAnnotations` helper — it gates on **categoryId** (the durable canicode-side identifier — the body no longer carries a `[canicode]` prefix per #353), includes `legacyAutoFix` if `ensureCanicodeCategories` returned it (pre-#355 `canicode:auto-fix` sweep), and also matches the legacy `**[canicode]` body prefix as a secondary marker for entries on files that have not been re-roundtripped yet. The match logic lives in `src/core/roundtrip/remove-canicode-annotations.ts` with vitest coverage so prose stays ADR-016-compliant:
<!-- adr-016-ack: fan-out over an explicit small array of node IDs; the deterministic work lives inside removeCanicodeAnnotations -->
```javascript
const nodeIds = ["id1", "id2"]; // nodes that now pass
for (const id of nodeIds) {
  const node = await figma.getNodeByIdAsync(id);
  if (node && "annotations" in node) {
    node.annotations = CanICodeRoundtrip.removeCanicodeAnnotations(
      CanICodeRoundtrip.stripAnnotations(node.annotations),
      categories,
    );
  }
}
```
- Proceed to **Step 6**.

**Some issues remain** (`V > 0`):
- Show the same breakdown and ask whether to proceed. When `V_ack > 0`, expand the remaining line into the acknowledged/unaddressed split surfaced by the re-analyze (#371) so the user can see how much of `V` is "captured for code-gen" vs "still on the user's plate":

  ```
  Roundtrip complete — N issues addressed:
    ✅  X resolved (auto-fix or property write succeeded)
    📝  Y annotated on Figma (gotcha answers captured for code-gen)
    🌐  Z definition writes propagated (only when allowDefinitionWrite: true)
    ⏭️  W skipped (user declined or "skip")
    —
    V issues remaining
       ↳ V_ack acknowledged via canicode annotations (carried into code-gen)
       ↳ V_open unaddressed (no annotation — your follow-up backlog)

  Grade: {oldGrade} → {newGrade}. Proceed to code generation with remaining context?
  ```

  When `V_ack == 0` (re-analyze returned `acknowledgedCount: 0`), keep the single `V issues remaining (unresolved gotchas + non-actionable rules)` line.
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
   —
  V remaining
     ↳ V_ack acknowledged via canicode annotations
     ↳ V_open unaddressed

Grade: {oldGrade} → {newGrade}.
```

When `V_ack == 0`, drop the `↳` lines and leave a single `V remaining` row. Anti-pattern (do **not** lead with a grade-only sentence like "Grade: C → C+. Most size-constraint gotchas are now annotations…"). Lead with the delta block; mention grade once, on its own footnote line, plain prose only.

### Step 6: Implement with Figma MCP

Follow the **figma-implement-design** skill workflow to generate code from the Figma design.

**If annotations or unresolved gotchas remain from Step 5**, provide them as additional context when implementing:

- Gotchas with severity **blocking** MUST be addressed — the design cannot be implemented correctly without this information
- Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
- Reference the specific node IDs from gotcha answers to locate the affected elements in the design
- Pass the Figma URL or `survey.designKey` to `figma-implement-design` so it can grep the matching `## #NNN — …` section in `.claude/skills/canicode-gotchas/SKILL.md` instead of reading the whole accumulated file

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
     ↳ V_ack acknowledged via canicode annotations
     ↳ V_open unaddressed

Grade: {oldGrade} → {newGrade}.
Code: <files generated / next-step pointer from figma-implement-design>
```

(Drop the `↳` lines when `V_ack == 0`.)

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
