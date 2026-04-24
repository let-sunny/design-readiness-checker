# Plan: Make codegen-ready grade threshold configurable (Issue #480)

## Summary

`isReadyForCodeGen(grade)` in `src/core/engine/scoring.ts:153-155` currently hard-codes the pass threshold at grade A (≥85%). The issue asks us to make this configurable so users can tighten (S-only) or loosen (B+) the cut, surfaced through three channels: the `scoring.ts` function itself, the CLI `gotcha-survey` command, the MCP `gotcha-survey` tool, and the `configPath` JSON file. Default behaviour (A passes) must be unchanged.

---

## Tasks

### Task 1 — Add `CODEGEN_READY_GRADES` + update `isReadyForCodeGen` signature in `scoring.ts`

**File:** `src/core/engine/scoring.ts`

**What:** 
1. Export a `GRADE_ORDER` constant (tuple of all grades from best to worst: `["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]`) so threshold comparison is ordinal, not string equality.
2. Add `DEFAULT_CODEGEN_READY_MIN_GRADE: Grade = "A"` as an exported constant (canonical default, single source of truth used by `rule-config.ts`, tests, and docs).
3. Change `isReadyForCodeGen(grade: Grade): boolean` to `isReadyForCodeGen(grade: Grade, minGrade?: Grade): boolean`. When `minGrade` is omitted, falls back to `DEFAULT_CODEGEN_READY_MIN_GRADE`. Implementation: a grade passes if its index in `GRADE_ORDER` is **≤** the index of `minGrade` (lower index = better grade).

**Why this shape:** The issue proposes `codegenReadyMinGrade` (discrete) over `codegenReadyMinPercentage` (continuous). Discrete grade values match how users think ("S-only", "B+") and match the `Grade` type already exported. Ordinal comparison with `GRADE_ORDER` is the cleanest approach — no magic numbers, no percentage recomputation, stays in sync if grade thresholds change.

**Backward compat:** The optional `minGrade` parameter means all existing call sites (which pass only `grade`) continue to work without change.

---

### Task 2 — Add `codegenReadyMinGrade` to `rule-config.ts` thresholds and `config-loader.ts` schema

**Files:**  
- `src/core/rules/rule-config.ts`  
- `src/core/rules/config-loader.ts`

**What:**

In `rule-config.ts`: Export a top-level comment block labelled `/** Global thresholds */` (following the existing `gridBase` precedent) and export:
```ts
// (no new exported binding needed here — GRADE_ORDER and DEFAULT_CODEGEN_READY_MIN_GRADE come from scoring.ts)
```
No change to `RULE_CONFIGS` needed — this is a global threshold, not a per-rule config. The threshold lives in the `ConfigFile` type (owned by `config-loader.ts`).

In `config-loader.ts`:
1. Import `Grade` type and `GRADE_ORDER` from `../engine/scoring.js`.
2. Add `codegenReadyMinGrade: z.enum(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]).optional()` to `ConfigFileSchema`.
3. Export updated `ConfigFile` type (auto via `z.infer`).
4. No changes needed to `mergeConfigs` — this field flows directly through to callers as `configFile.codegenReadyMinGrade`; callers pass it to `isReadyForCodeGen`.

**Why config-loader not rule-config:** `codegenReadyMinGrade` is a global threshold affecting the survey/scoring layer, not a per-rule knob. The pattern is identical to `gridBase` in `ConfigFileSchema`. The `mergeConfigs` function is for rule-level config; global thresholds are consumed directly by callers that load the config file, not merged into rule configs.

---

### Task 3 — Thread the threshold through `generateGotchaSurvey` and `buildResultJson`

**Files:**  
- `src/core/gotcha/survey-generator.ts`  
- `src/core/engine/scoring.ts` (the `buildResultJson` function)

**What:**

In `survey-generator.ts`:
- Add optional `codegenReadyMinGrade?: Grade` to the `options` parameter of `generateGotchaSurvey`.
- Pass it through to `isReadyForCodeGen(grade, options.codegenReadyMinGrade)` on line 96.

In `scoring.ts` (`buildResultJson`):
- Add optional `codegenReadyMinGrade?: Grade` to the `options` parameter of `buildResultJson`.
- Pass it through to `isReadyForCodeGen(scores.overall.grade, options?.codegenReadyMinGrade)` on line 477.

**Why both:** `generateGotchaSurvey` produces the `GotchaSurvey` result (used by both the MCP `gotcha-survey` tool and the CLI). `buildResultJson` produces the JSON for the `analyze` command/tool. Both surface `isReadyForCodeGen` in their output, so both need the threshold parameter. Existing callers that don't pass `codegenReadyMinGrade` continue to work (undefined falls back to "A").

---

### Task 4 — Surface `--ready-min-grade` in CLI `gotcha-survey` and `analyze`, and `codegenReadyMinGrade` in MCP tools

**Files:**  
- `src/cli/commands/gotcha-survey.ts`  
- `src/cli/commands/analyze.ts`  
- `src/mcp/server.ts`

**What:**

**CLI `gotcha-survey.ts`:**
1. Add `readyMinGrade: z.enum(["S","A+","A","B+","B","C+","C","D","F"]).optional()` to `GotchaSurveyOptionsSchema`.
2. Add `.option("--ready-min-grade <grade>", "Minimum grade to pass codegen-ready check (default: A)")` to the CAC command registration.
3. In `runGotchaSurvey`: read `codegenReadyMinGrade` from `options.readyMinGrade ?? configFile?.codegenReadyMinGrade`. Pass it to `generateGotchaSurvey(result, scores, { designKey, codegenReadyMinGrade })`.

**CLI `analyze.ts`:** Check if `analyze` also calls `buildResultJson`. If it does, apply the same `readyMinGrade` option there too. (Verify by reading the file.)

**MCP `server.ts` `gotcha-survey` tool:**
1. Add `codegenReadyMinGrade: z.enum(["S","A+","A","B+","B","C+","C","D","F"]).optional().describe("Minimum grade for codegen-ready (default: A; tighten to S, loosen to B+)")` to the tool schema.
2. Resolve effective threshold: `options.codegenReadyMinGrade ?? configFile?.codegenReadyMinGrade`.
3. Pass to `generateGotchaSurvey`.

**MCP `analyze` tool:** Same pattern — add `codegenReadyMinGrade` param, resolve through `configPath`, pass to `buildResultJson`.

**Priority / resolution order:** CLI flag > configPath > default (A). This mirrors how `preset` and `configPath` interact today.

---

### Task 5 — Tests

**Files:**  
- `src/core/engine/scoring.test.ts`  
- `src/core/rules/config-loader.test.ts`  
- `src/core/gotcha/survey-generator.test.ts`

**What:**

**`scoring.test.ts` — `isReadyForCodeGen` describe block:**
Add boundary-coverage tests for the parametric form:
```
isReadyForCodeGen("A", "S")     → false
isReadyForCodeGen("S", "S")     → true
isReadyForCodeGen("A+", "A+")   → true
isReadyForCodeGen("A", "A+")    → false
isReadyForCodeGen("A", "A")     → true   (default behaviour)
isReadyForCodeGen("B+", "B+")   → true
isReadyForCodeGen("A", "B+")    → true   (looser threshold)
isReadyForCodeGen("B", "B+")    → false
isReadyForCodeGen("A")          → true   (no minGrade → default A)
isReadyForCodeGen("B+")         → false  (no minGrade → default A)
```
Also test that `buildResultJson` respects the threshold by passing `codegenReadyMinGrade: "S"` for a grade-A result and asserting `isReadyForCodeGen === false`.

**`config-loader.test.ts`:**
- Add test: valid config with `codegenReadyMinGrade: "S"` parses correctly.
- Add test: invalid value `codegenReadyMinGrade: "Z"` throws a Zod error.

**`survey-generator.test.ts`:**
- Add one test: `generateGotchaSurvey` with a mocked S-grade result but `codegenReadyMinGrade: "A+"` — the `isReadyForCodeGen` field should stay `true` (S ≥ A+ still passes). This confirms the option threads through, not just that A passes.
- Add one test: A-grade result with `codegenReadyMinGrade: "S"` → `isReadyForCodeGen: false`.

**Existing tests must still pass unchanged.** The `isReadyForCodeGen` describe block tests (lines 719-734) already test the no-arg form — they stay valid.

---

### Task 6 — Update `docs/CUSTOMIZATION.md` and MCP `docs` tool `config` topic

**Files:**  
- `docs/CUSTOMIZATION.md`  
- `src/mcp/server.ts` (the inline `config` topic string in the `docs` tool)

**What:**

In `docs/CUSTOMIZATION.md`, add a row to the **Fields** table:

| `codegenReadyMinGrade` | `string` | `"A"` | Minimum grade for `isReadyForCodeGen` (S/A+/A/B+/B/C+/C/D/F). Tighten to `"S"` for high-stakes screens; loosen to `"B+"` for exploratory work. |

And add a prose section before the "Per-Rule Overrides" heading:

```md
### Codegen-Ready Threshold

Controls when `isReadyForCodeGen` returns `true`. Default is `"A"` (85%+ = ready).

```json
{ "codegenReadyMinGrade": "S" }
```

Can also be set via CLI flag (`--ready-min-grade S`) or MCP tool parameter.
```

In `src/mcp/server.ts` inline `config` topic string: add the same row + short prose so `docs({ topic: "config" })` reflects the new field.

**Note:** `docs/CUSTOMIZATION.md` is served by the `docs` MCP tool via file read (the `config` section is extracted by string search). The inline `scoring` topic already lists grade boundaries; the `config` inline section in the code does not exist (it falls through to the file). So only the file needs updating for the `config` topic — no inline string addition is needed for MCP `docs` unless `config` is an inline topic (it isn't; confirmed from the server code).

---

## Design Decisions

1. **Discrete `Grade` type over `number` percentage** — The issue proposes both; we pick `codegenReadyMinGrade` (discrete). Grade values map directly to the UI and the GotchaSurvey output; users already think in grade terms. Percentage would require users to know that B+ = 80%, which is a lookup friction. The `GRADE_ORDER` tuple makes ordinal comparison trivially correct.

2. **`GRADE_ORDER` exported from `scoring.ts`** — The single source of truth for grade ordering. This avoids duplicating grade order logic in config-loader, survey-generator, or CLI. All threshold comparisons use the same tuple via index lookup.

3. **Optional `minGrade` parameter on `isReadyForCodeGen`** — All existing call sites continue to compile and run unchanged. The default is `"A"`, matching the current hardcoded behaviour. No breaking change.

4. **`codegenReadyMinGrade` in `ConfigFileSchema`, not `RULE_CONFIGS`** — This is a global threshold, not a per-rule knob. The existing precedent is `gridBase` in `ConfigFileSchema`. Per-rule configs live in `RULE_CONFIGS`/`mergeConfigs`; global thresholds are consumed directly from `ConfigFile`.

5. **Priority chain: CLI flag > configPath field > default** — Matches the existing pattern for `preset` and `configPath`. The CLI flag (`--ready-min-grade`) is the most specific; `configPath` JSON lets teams persist team-wide preferences; the default (A) ensures unchanged behaviour.

6. **`buildResultJson` also gets the threshold** — The `analyze` command/tool surfaces `isReadyForCodeGen` in its JSON output (scoring.ts line 477). If we only thread through `generateGotchaSurvey`, the `analyze` tool's output would ignore the user's threshold. Both surfaces must be consistent.

7. **Do NOT touch `.claude/skills/` files** — Per the task instructions, skills files (`canicode-roundtrip/SKILL.md`, `canicode-gotchas/SKILL.md`) are owned by issue #481 (parallel work). This plan only implements the threshold computation and surfaces it; #481 handles skill consumption.

8. **Wiki Decision Log entry deferred to post-merge** — Required by acceptance criteria, but the note belongs in the wiki after the PR is reviewed and merged, not in the plan or code. The implementer should add a reminder comment in the PR description.

---

## Test Strategy

- Run `pnpm test:run` after each file change to catch regressions.
- The new `isReadyForCodeGen` boundary tests cover all 9 grades × multiple threshold positions.
- The config-loader tests catch Zod schema validation for the new field.
- The survey-generator tests confirm the parameter threads end-to-end.
- Existing tests for `isReadyForCodeGen` (no-arg form), `buildResultJson`, and `mergeConfigs` must all still pass — no existing test should be modified, only new tests added.

---

## Risks

1. **`buildResultJson` options type** — Currently `options?: { fileKey?: string; designKey?: string }`. Adding `codegenReadyMinGrade` extends this. Since `exactOptionalPropertyTypes` is enabled, the implementer must NOT assign `undefined` explicitly to the optional field — use conditional spread or `?.`.

2. **CLI flag hyphenation** — CAC converts `--ready-min-grade` to `rawOptions.readyMinGrade` (camelCase). The `GotchaSurveyOptionsSchema` must use `readyMinGrade` (not `readyMinGrade` vs `ready-min-grade`). Verify CAC's camelCase conversion matches the Zod key.

3. **MCP tool `analyze` + `gotcha-survey` both need the param** — Easy to forget the `analyze` tool. Both tools independently call `buildResultJson` / `generateGotchaSurvey`, so both need the parameter wired in.

4. **`configFile` may be `undefined`** when no `configPath` is provided — The resolution chain `options.readyMinGrade ?? configFile?.codegenReadyMinGrade` must handle this correctly. The `?.` is required.

5. **Grade enum in Zod schema must exactly match `Grade` type** — The `Grade` type is `"S" | "A+" | "A" | "B+" | "B" | "C+" | "C" | "D" | "F"`. The Zod enum in the `ConfigFileSchema` must list all 9 values in the same string format. A typo (e.g. `"A +"` with a space) would cause silent mismatches.

