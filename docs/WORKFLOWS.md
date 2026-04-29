# canicode Workflow Guide

canicode bridges Figma designs and production code by closing the information gaps that make AI-assisted code generation guess. This guide tells you which canicode workflow fits the work in front of you right now.

If you only remember one thing: **canicode does not generate code**. It prepares the Figma source so that Figma's official `figma-implement-design` skill can generate code with fewer mistakes (see ADR-013 for the scope boundary).

## Pick your situation

| Where you are right now | Use this workflow |
|---|---|
| Building or extending your design system — creating a new component intentionally | [Workflow 1 — Component-to-code mapping](#workflow-1--component-to-code-mapping) |
| Implementing a screen on top of an existing design system | [Workflow 2 — Screen-to-code handoff](#workflow-2--screen-to-code-handoff) |
| Looking at messy screens with no real design system yet | [Workflow 3 — Bootstrap a design system from screens](#workflow-3--bootstrap-a-design-system-from-screens) |

These workflows compose. A new project typically starts at Workflow 3 (find the patterns), settles into Workflow 1 (build the system one component at a time), and then runs Workflow 2 (apply the system) for ongoing screen work.

> **Status legend**
> ✅ Available today &nbsp; • &nbsp; 🚧 Partial — see notes &nbsp; • &nbsp; 🗺️ Planned, not yet shipped

## Roadmap

| Phase | Workflow | Status | Tracking epic |
|---|---|---|---|
| 1 | Component-to-code mapping | ✅ Available | [#509](https://github.com/let-sunny/canicode/issues/509) |
| 2 | Screen-to-code handoff | ✅ Largely shipped | [#510](https://github.com/let-sunny/canicode/issues/510) |
| 3 | Bootstrap a design system from screens | ✅ Available | [#508](https://github.com/let-sunny/canicode/issues/508) |

---

## Workflow 1 — Component-to-code mapping

> ✅ Available — `analyze`, `roundtrip`, `doctor`, and the roundtrip's closing Code Connect mapping step (epic [#509](https://github.com/let-sunny/canicode/issues/509)) all ship. End-to-end live verification ran 2026-04-28 against a real Figma component on `npx canicode@0.12.0`; all hard-pass items in [#527](https://github.com/let-sunny/canicode/issues/527) Section A landed (Step 1.5 soft-warn, Step 7 satisfaction prompt + `add_code_connect_map` + `send_code_connect_mappings`, screen-level skip, failure case with verbatim error). v1.5 enhancements landed in subsequent patches: [#526](https://github.com/let-sunny/canicode/issues/526) `unmapped-component` parser + opt-out (v0.12.0–v0.12.1), [#532](https://github.com/let-sunny/canicode/issues/532) doctor publish-status pre-check (v0.12.1), [#542](https://github.com/let-sunny/canicode/issues/542) opt-out write path (v0.12.1), [#548](https://github.com/let-sunny/canicode/issues/548) doctor screen-scope inconclusive + rule fires on INSTANCE (v0.12.2). v0.12.2 verification re-ran #527 Section A v1.5 + Section B Items 1/4/5 cleanly.

**You are**: a designer creating a single component (Button, Card, Input...) on purpose, knowing it should be reused in code.

**Why this matters**: every Figma component without a code mapping forces `figma-implement-design` to regenerate the same markup over and over. A single Code Connect mapping eliminates that drift permanently.

**Prerequisites in your code repo**
- `@figma/code-connect` installed (`pnpm add -D @figma/code-connect`)
- `figma.config.json` configured at the repo root
- A code component corresponding to the Figma component (existing — or one that `figma-implement-design` will generate during the roundtrip)

> Run `canicode doctor` to verify the prerequisites in your repo (`@figma/code-connect` install + `figma.config.json` presence). It exits 0 when everything is in place, 1 with a remediation hint otherwise.

**Today's flow**
1. Finish the Figma main component (with variants if applicable).
2. Run `canicode doctor` once per repo to confirm `@figma/code-connect` and `figma.config.json` are in place.
3. Run `/canicode-roundtrip <component-url>` (Claude Code) or `@ canicode-roundtrip <component-url>` (Cursor). The roundtrip walks you through analyze → gotcha survey → apply → re-analyze → handoff to `figma-implement-design`, then closes with a Code Connect mapping prompt:
   - If prerequisites are missing, the soft warn at the top tells you up front so you can stop and set them up — no time wasted on the survey.
   - After `figma-implement-design` finishes, you confirm whether the generated code is satisfactory. On `y`, canicode calls `add_code_connect_map` + `send_code_connect_mappings` so the next roundtrip on a screen containing this component reuses the code instead of regenerating markup.
4. (Optional) For an existing code component you want to map without regenerating, use Figma's CLI directly (`figma connect create`, `figma connect publish`) — canicode's mapping flow is currently scoped to fresh code from a roundtrip.

**Outcome**: every Figma main component has a 1:1 Code Connect mapping. Downstream `figma-implement-design` calls reuse the mapped code component instead of regenerating markup.

**What canicode does NOT do**: write the code component itself. That belongs to `figma-implement-design` (ADR-013).

---

## Workflow 2 — Screen-to-code handoff

> ✅ Available today — this is canicode's primary, fully-supported flow. Completion bar tracked in epic #510.

**You are**: about to implement a full screen that mostly composes existing design-system components.

**Why this matters**: screens are where information gaps multiply. A screen with 300+ nodes hides dozens of small ambiguities (interaction states, responsive behavior, missing component links) that each cost the AI a guess. canicode surfaces those gaps before code generation, not after.

**Prerequisites**
- A design system with main components in Figma
- (Strongly recommended) Code Connect mappings registered for those components — see Workflow 1
- `FIGMA_TOKEN` saved via `canicode init` or `canicode config set-token`

**Flow**
1. `canicode analyze <figma-screen-url>` — get a development-friendliness report and the gotcha list.
2. `/canicode-roundtrip <url>` (Claude Code) or `@ canicode-roundtrip` (Cursor) — answer survey questions one at a time.
3. canicode writes your answers back into Figma. Under ADR-012's annotate-by-default posture, instance children get scene-level annotations (📝); definition-level writes (🌐) only happen when you opt in upfront.
4. canicode re-analyzes in the same session and reports the issues delta (resolved / annotated / propagated / skipped + remaining).
5. When the design re-analyzes clean (or you accept the remaining gaps), hand off to **Figma's `figma-implement-design`** skill for code generation.

**Outcome**: `figma-implement-design` runs against a Figma file where the answers it would otherwise have to guess are already encoded.

**What canicode does NOT do**: generate code. That handoff is the deliberate end of canicode's scope.

---

## Workflow 3 — Bootstrap a design system from screens

> ✅ Available — `analyze`, `gotcha-survey`, and `roundtrip` together perform end-to-end **componentize+swap** on Stage 3 fingerprint groups (`missing-component:structure-repetition`). The full epic [#508](https://github.com/let-sunny/canicode/issues/508) shipped in five deltas plus one follow-up — see ADR-023 for the design decisions and the deltas table below for PR history. v0.12.3 (npm) is the first release that exposes the apply path; earlier 0.12.x versions only flagged the duplicates.

**You are**: looking at one or more screens with repeated patterns, no real design system yet, and you want canicode to help you find the components hiding inside the screen.

**Why this matters**: the hardest part of starting a design system isn't drawing the first component, it's **noticing** the repetition you've already accepted as normal. A designer who didn't componentize the first time often can't decide on second look either. canicode's job here is to surface the candidates with enough context that the decision becomes makeable.

**Prerequisites in your code repo**
- (Strongly recommended) `@figma/code-connect` installed and `figma.config.json` at the repo root, so the closing Code Connect handoff can register the new component. `npx canicode doctor` verifies this — Workflow 1 (#509) owns the onboarding wall, Workflow 3 just inherits it. Skipping is fine; the componentize+swap still runs and the handoff prompt silently skips per ADR-023 decision E.

**Today's flow**
1. `canicode analyze <figma-screen-url>` — Stage 3 (cross-parent fingerprint pass — #557) flags qualifying groups.
2. `/canicode-roundtrip <url>` (Claude Code) or `@ canicode-roundtrip` (Cursor). The roundtrip walks you through the survey; for each Stage 3 group it asks one question: *"X 외에 동일한 구조의 frame이 N개 더 있습니다 (총 N+1개). 모두 컴포넌트화 할까요?"* (English equivalent in the SKILL prose).
3. On `yes`, canicode componentizes the document-order first member (decision A — refuses if the parent is free-form) and swaps the rest with instances of the new component (decision C — auto-suffixes ` 2` on a name collision, Figma's native duplicate convention).
4. After a successful componentize+swap, canicode prompts to register the new component with **Code Connect** so future roundtrips on screens containing it reuse the mapped code (Workflow 1 close-out, reused). When prereqs are missing, the handoff silently skips with a one-line pointer to Workflow 1.
5. canicode re-analyzes in the same session and reports the issues delta (`structure-repetition` count drops to 0 for the resolved groups; per-target outcome icons surface in the Step 4 line for any free-form-parent rejections).

**Apply primitives** (live as bundled `CanICodeRoundtrip.*` helpers in v0.12.3):
- `applyComponentize` (#553) — wraps `figma.createComponentFromNode` with the #368 instance-child guard and the decision A free-form-parent guard.
- `applyReplaceWithInstance` (#555) — wraps `mainComponent.createInstance()` + `parent.insertChild` + `target.remove()` with an independent swap-site free-form check (decision A clarification).
- `applyGroupComponentize` (#563) — orchestrator that drives the loop from a single user "yes" answer.

**Outcome**: a previously component-less file gets a starter design system, with each new component immediately eligible for Workflow 1 / Code Connect registration via the same roundtrip session.

**Known limits (revisit when real-world friction surfaces)**
- **Per-member opt-out is not yet wired.** The orchestrator treats `groupMembers` as canonical. To exclude a specific frame, edit the design (rename it so its fingerprint differs) before re-running, or run the roundtrip again after manual cleanup.
- **Stage 1 reverse case** (a published component already exists with the same name as the duplicates → swap to existing instances instead of creating a new one) is **not yet wired** — the gotcha question for Stage 1 still uses the standard Strategy C annotation path. ADR-023 decision D records the mode field shape (`"componentize-new" | "use-existing"`) for when this lands.

---

## How the workflows compose

```
Workflow 3 (find candidates)  →  Workflow 1 (build + map components)  →  Workflow 2 (use the system on screens)
        ↑                                                                          │
        └────── new repeating ad-hoc patterns surfaced during Workflow 2 ──────────┘
```

A mature project loops between Workflow 1 and Workflow 2. Workflow 3 reappears only when a new screen reveals patterns the design system hasn't captured yet.

## Where canicode stops

Code generation is **figma-implement-design's** job, not canicode's. Anywhere this guide says "handoff to figma-implement-design," that is the deliberate scope boundary, not a missing canicode feature. ADR-013 records the rationale.

## Related references

- [ADR-012](../.claude/docs/ADR.md) — annotate-by-default vs definition writes
- [ADR-013](../.claude/docs/ADR.md) — scope boundary with `figma-implement-design`
- [Roundtrip protocol](./roundtrip-protocol.md) — Strategy A/B/C/D apply semantics
- [Customization](./CUSTOMIZATION.md) — rule scoring, MCP setup
- Roadmap epics: [#509 Phase 1 — Component-to-code mapping](https://github.com/let-sunny/canicode/issues/509), [#510 Phase 2 — Screen-to-code handoff](https://github.com/let-sunny/canicode/issues/510), [#508 Phase 3 — Bootstrap from screens](https://github.com/let-sunny/canicode/issues/508)
