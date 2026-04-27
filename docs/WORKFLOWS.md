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
| 1 | Component-to-code mapping | 🚧 Partial | [#509](https://github.com/let-sunny/canicode/issues/509) |
| 2 | Screen-to-code handoff | ✅ Largely shipped | [#510](https://github.com/let-sunny/canicode/issues/510) |
| 3 | Bootstrap a design system from screens | 🗺️ Planned | [#508](https://github.com/let-sunny/canicode/issues/508) |

---

## Workflow 1 — Component-to-code mapping

> 🚧 Partial — `analyze`, `roundtrip`, and `doctor` ship today. The roundtrip's closing Code Connect mapping step is the next milestone (epic #509, sub-issue #515).

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

> 🚧 Detection ships today — the recommend / promote / swap loop is on the roadmap (epic #508).

**You are**: looking at one or more screens with repeated patterns, no real design system yet, and you want canicode to help you find the components hiding inside the screen.

**Why this matters**: the hardest part of starting a design system isn't drawing the first component, it's **noticing** the repetition you've already accepted as normal. A designer who didn't componentize the first time often can't decide on second look either. canicode's job here is to surface the candidates with enough context that the decision becomes makeable.

**Today's flow**
1. `canicode analyze` on each screen.
2. The `missing-component` rule (Stage 3 — structural fingerprint) flags repeated structural patterns across siblings.
3. For each flagged group, decide manually whether to promote it. Then go to Workflow 1 for each promoted component.

**Planned flow (#508)**
1. Same first two steps.
2. canicode + LLM judgment proposes which flagged groups deserve componentization, with rationale (shared name pattern, semantic similarity, layout match) and the suggested component name.
3. You confirm, modify, or skip per group.
4. canicode runs `createComponentFromNode` on the chosen Frame and swaps the siblings to instances of the new main.
5. You continue into Workflow 1 to register the Code Connect mapping for each promoted component.

**Outcome (planned)**: a previously component-less file gets a starter design system, with each new component eligible for Workflow 1 immediately.

**Open questions on this workflow**
- LLM recommendation quality has not been measured against real designs yet.
- Base rate (how often Stage 3 fires meaningfully on real screens) has not been audited.
- Both gate the heavier promote/swap implementation.

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
