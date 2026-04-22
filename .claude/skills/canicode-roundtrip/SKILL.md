---
name: canicode-roundtrip
description: Analyze Figma design, fix gotchas via Plugin API, re-analyze, then implement — true design-to-code roundtrip
disable-model-invocation: false
---

# CanICode Roundtrip — True Design-to-Code Roundtrip

**Channel contrast:** **`canicode-gotchas`** stores answers in **local** `.claude/skills/canicode-gotchas/SKILL.md` only (memo — no Figma write). **`canicode-roundtrip`** (**this skill**) writes to the **Figma canvas** via Plugin API (`use_figma`). If you only need Q&A persistence, use gotchas; if you need annotations and fixes on the file, use roundtrip.

Orchestrate the full design-to-code roundtrip: analyze a Figma design for readiness, collect gotcha answers for problem areas, **apply fixes directly to the Figma design** via `use_figma`, re-analyze to verify gotchas were captured, then generate code. Success means **gotchas answered and carried into annotations / writes** — not a numeric grade bump (analyze still reports grade for continuity; roundtrip success is lint-first).

## Prerequisites

- **Figma MCP server** installed (provides `get_design_context`, `get_screenshot`, `use_figma`, and other Figma tools) — REQUIRED, there is no CLI fallback for `use_figma`. Register it with your host (e.g. Claude Code: `claude mcp add -s project -t http figma https://mcp.figma.com/mcp`; Cursor: add the Figma MCP entry per host docs / project `.mcp.json`).
- **canicode MCP** (preferred): **Claude Code:** `claude mcp add canicode -- npx --yes --package=canicode canicode-mcp` — long-form flags only; short `-y -p` collides with `claude mcp add`'s parser (#366); do **not** pass `-e FIGMA_TOKEN=…` here (#364). **Cursor / other hosts:** add `canicode-mcp` to MCP config — see [Customization guide](https://github.com/let-sunny/canicode/blob/main/docs/CUSTOMIZATION.md#cursor-mcp-canicode). The server reads `FIGMA_TOKEN` from `~/.canicode/config.json` or the environment.
- **Without canicode MCP** (fallback): Steps 1 (analyze) and 3 (gotcha-survey) shell out to `npx canicode <command> --json` — same JSON shape as the MCP tools. Step 4 (apply to Figma) still requires Figma MCP `use_figma`.
- **FIGMA_TOKEN** configured for live Figma URLs
- **Figma Full seat + file edit permission** (required for `use_figma` to modify the design)

## Workflow

### Step 0: Verify Figma MCP tools are loaded

Before Step 1, verify that `use_figma` is callable in **this** session — not merely listed in `.mcp.json`. Newly registered MCP servers require a **host restart or MCP reload** so tools appear (e.g. Claude Code: restart after `claude mcp add …`; Cursor: restart Cursor or reload MCP after editing `.cursor/mcp.json`). Reading `.mcp.json` is not a substitute for checking the live tool list you have access to right now.

If `use_figma` is unavailable in the current session, **Do NOT proceed to Step 1**. Steps 1 (analyze) and 3 (gotcha-survey) spend real Figma API calls and 5–15 minutes of human survey time before Step 4 would otherwise discover `use_figma` is missing. Halt immediately and tell the user:

1. Confirm `.mcp.json` (project or user) registers the Figma MCP entry (e.g. `figma` under `mcpServers`).
2. Restart the IDE / agent host (or reload MCP) so the newly registered tools load.
3. Re-invoke the roundtrip (Claude Code slash command `/canicode-roundtrip`, or Cursor: @ **canicode-roundtrip** with the Figma URL).

See the Edge Case **No Figma MCP server** below for the one-way fallback when Figma MCP genuinely cannot be installed — the precheck above is for the common "installed but not restarted" case, not a replacement for that fallback.

**canicode MCP (same cold-session pattern):** If `analyze` / `gotcha-survey` MCP tools are missing but `.mcp.json` lists canicode, you are on the `npx canicode …` fallback. Tell the user to restart the host or reload MCP after `claude mcp add canicode …` (or the Cursor equivalent) so the canicode tools appear — same communication fix as #433; the CLI path is not an error.

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

#### Step 3 — grouped survey (`groupedQuestions`)

Iterate `groupedQuestions.groups[].batches[]`. Instance notes, batch prompts, replicas, split/skip/n/a, stdin upsert — **[Appendix Step 3](https://github.com/let-sunny/canicode/blob/main/docs/roundtrip-protocol.md#appendix--step-3-grouped-survey-groupedquestions)**. Per ADR-016, do not re-implement grouping.


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

#### Instance-child matrix, annotation enum matrix, write tiers, probe, helpers

Full tables, Experiment 08/09 references, definition-write probe branches, and the bundled `CanICodeRoundtrip` API catalogue live in [`docs/roundtrip-protocol.md`](https://github.com/let-sunny/canicode/blob/main/docs/roundtrip-protocol.md) on `main`. Open it when you need the matrices or helper list — do not re-derive write rules from memory (ADR-016).

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

#### Strategy B: Structural modification

Instance-child guard and per-rule prompts — **[Appendix Strategy B](https://github.com/let-sunny/canicode/blob/main/docs/roundtrip-protocol.md#appendix--strategy-b-structural-modification)**. Decline / guard → Strategy C annotation.

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

The gotcha survey covers blocking/risk severity plus `missing-info` severity from info-collection rules (#406 — currently `missing-prototype`, `missing-interaction-state`). All other lower-severity rules appear in `analyzeResult.issues[]` without a survey question. Each issue carries the same pre-computed fields (`applyStrategy`, `targetProperty`, `annotationProperties`, `suggestedName`, `isInstanceChild`, `sourceChildId`). The bundled helper handles the loop, the filter (`applyStrategy === "auto-fix"`), the naming-vs-annotation branch, and the per-issue outcome accumulator in one call:

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
4. **Batch all auto-fixes and annotations for lower-severity issues** (Strategy D) — use `categories.flag` for annotated ones (renamed from `autoFix` per #355 — the category means "flagged for designer attention", not "fixed"). `categories.fallback` from `applyWithInstanceFallback` is **only** the true ADR-012 path (annotate instead of propagating to a source definition); other helper annotate paths use `gotcha` or `flag` (#444).

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

After each emoji line above, mirror a **structured per-item row** so scene-write vs annotation fallback is visible every run (#435):

```
{ruleId} @ {nodeName}
  attempt: scene write (`question.targetProperty` / binding shape from answer)
  result: {emoji outcome} ({short reason — e.g. silent-ignore ADR-012 → annotated, override-error → annotated, tier-2 propagated})
```

stepFourReport = {
  resolved: <count of ✅ + 🔧 + 🔗 lines>,        // scene writes, auto-fix renames, variable bindings
  annotated: <count of 📝 lines>,                 // including ⏭️ declines that fell back to annotation
  definitionWritten: <count of 🌐 lines>,         // only non-zero with allowDefinitionWrite: true
  skipped: <count of ⏭️ lines + Step 3 skip/n/a>  // user-declined questions
}
```

Hold `stepFourReport` in scope through Step 5 — it is the input to `CanICodeRoundtrip.computeRoundtripTally` below.

#### Auto-chain acknowledgments after apply (#440)

**After every Step 4 apply pass** (any Strategies A–D batch that ran), **do not wait for a separate user prompt** — in the **same session**, immediately run **Step 5a → Step 5b**: `readCanicodeAcknowledgments`, then `analyze({ input, acknowledgments })`. This is **not** conditional on the Step 4 summary containing a 📝 line: pure ✅ / 🔗 scene writes still need the re-analyze + tally for a consistent roundtrip report; when 📝 annotations exist, chaining is **mandatory** so REST analyze can see them — otherwise **`issueCount` stays flat** (`32 → 32`) even when gotchas were captured (#371). Emit the harvest + re-analyze before the conversational wrap-up so **`acknowledgedCount`** and `computeRoundtripTally` land in the **same** apply-summary response as the Step 4 totals.

### Step 5: Re-analyze and report what the roundtrip addressed

#### Step 5a: Harvest canicode-authored annotations as acknowledgments (#371)

Before re-running `analyze`, collect every `(nodeId, ruleId)` pair that Step 4 wrote as a Figma annotation. The REST API does not expose annotations, so this side channel is the only way the analysis pipeline learns that a roundtrip-touched issue is "the designer has a plan" rather than "still broken". Without it the **issue list** looks unchanged (`32 → 32` issues) — even when every gotcha has been captured per ADR-012.

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

Under ADR-012's annotate-by-default policy, many writes become 📝 annotations. Treat **issues-delta + `acknowledgedCount`** as the headline success signal — not grade movement (#423).

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

**All gotcha issues resolved** (`V == 0`, i.e. re-analyze surfaces no remaining issues):
- Tell the user (fill in the counts from the tally above):

  ```
  Roundtrip complete — N issues addressed:
    ✅  X resolved (auto-fix or property write succeeded)
    📝  Y annotated on Figma (gotcha answers captured for code-gen)
    🌐  Z definition writes propagated (only when allowDefinitionWrite: true)
    ⏭️  W skipped (user declined or "skip")
    —
    V issues remaining (unresolved gotchas + non-actionable rules)

  Ready for code generation. *(Optional:) Report still shows grade **{grade}** — informational only.*
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

  Proceed to code generation with remaining context? *(Optional footnote: report grade **{grade}**.)*
  ```

  When `V_ack == 0` (re-analyze returned `acknowledgedCount: 0`), keep the single `V issues remaining (unresolved gotchas + non-actionable rules)` line.
- If yes → proceed to **Step 6** with remaining gotcha context.
- If no → stop and emit the **Stop wrap-up** below; lead with the delta, not grade.

#### Wrap-up message rubric (Stop branch)

When the user picks **Stop** here, the closing message is the *last thing the user sees of canicode* in this session. Keep the **issues-delta** as the headline (`✅ X / 📝 Y / 🌐 Z / ⏭️ W / V remaining`). Value delivered is **gotchas captured for code-gen** (#423). Optional single line: current report grade — never lead with grade-only framing.

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

*(Optional)* Report grade: **{grade}**.
```

When `V_ack == 0`, drop the `↳` lines and leave a single `V remaining` row. Anti-pattern: leading with grade-only sentences. Lead with the delta block.

### Step 6: Implement with Figma MCP

Follow the **figma-implement-design** skill workflow to generate code from the Figma design.

**If annotations or unresolved gotchas remain from Step 5**, provide them as additional context when implementing:

- Gotchas with severity **blocking** MUST be addressed — the design cannot be implemented correctly without this information
- Gotchas with severity **risk** SHOULD be addressed — they indicate potential issues that will surface later
- Gotchas with severity **missing-info** from info-collection rules (`purpose === "info-collection"`, e.g. `missing-prototype`, `missing-interaction-state`) are annotation-primary (#406): the answer describes implementation context Figma cannot encode (click target, state variants). Treat them as code-generation context rather than violations to fix — the rule's score impact is minimal by design
- Reference the specific node IDs from gotcha answers to locate the affected elements in the design
- Pass the Figma URL or `survey.designKey` to `figma-implement-design` so it can grep the matching `## #NNN — …` section in `.claude/skills/canicode-gotchas/SKILL.md` instead of reading the whole accumulated file

**If all issues were resolved in Steps 4-5**, no additional gotcha context is needed — the design speaks for itself.

#### Wrap-up message rubric (post-handoff)

After `figma-implement-design` returns, summarise the roundtrip in the same shape as the Step 5 / Stop wrap-up — issues-delta first, then code-gen outcome; grade at most one optional footline (#423).

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

*(Optional)* Report grade: **{grade}**.
Code: <files generated / next-step pointer from figma-implement-design>
```

(Drop the `↳` lines when `V_ack == 0`.)

## Edge cases

Full list — **[Appendix Edge Cases](https://github.com/let-sunny/canicode/blob/main/docs/roundtrip-protocol.md#appendix--edge-cases-full-list)**.

