# canicode Positioning

A one-pager that captures **who canicode is for, what it does for them, and why it is not Claude Design**. This is the source of truth for README copy, Show HN pitch, future feature decisions ("should we add X?"), and 6-months-from-now self-check on whether the project still fits its declared niche.

Treat as living. When the answer to a real-world question contradicts a line here, fix the line — not the user.

---

## Positioning statement (Geoffrey Moore template)

> **For** designers with craft instinct who care that their design ships exactly as intended,
> **Who** can articulate visual taste but not the technical concerns underneath (viewports, breakpoints, component boundaries, interaction states),
> **canicode is** a pre-implementation interview layer between Figma and AI codegen
> **That** asks the questions a developer would ask before they implement — in plain language the designer can answer — and persists those answers back into the Figma file so subsequent codegen runs no longer have to guess.
> **Unlike** Claude Design, which makes the designer redundant by generating layouts from prompts,
> **canicode** keeps the designer in Figma as the source of truth and surfaces the technical intent already implicit in their craft.

---

## Target persona

**The craft-instinct designer.**

| Has | Lacks |
|---|---|
| Strong visual taste; notices when one card padding is 14px and the rest are 16px | Vocabulary for the technical concern underneath (CSS, breakpoints, container queries) |
| Cares that their design ships exactly as intended | Time and motivation to learn front-end development |
| Owns the Figma file end to end | Confidence to write the implementation spec themselves |
| Aesthetic conviction — "I want it this way for a reason" | Articulation of the reason in dev-speak |

A grounded example:

> A designer marks three card frames as "this should stack on small screens" in their head — but the Figma file just shows three frames at desktop width. They never typed "media query" or "flex-direction: column" because they don't think in those words. When the AI-generated implementation lands, the cards stay side-by-side and clip the viewport. The designer says "that's not what I designed" — but they have no language to explain *what they designed* in technical terms.

canicode's job is to turn that mental "this should stack on small screens" into a structured answer the codegen can read, **without making the designer learn CSS**.

---

## Problem (in the persona's own words)

- *"This isn't what I designed."* — implementation drifts from intent, but the designer can't pinpoint which Figma property they should have set.
- *"Do I need to learn React just to get my own design built?"* — feels they have to choose between learning dev or accepting drift.
- *"AI just guesses, and it guesses wrong half the time."* — current AI codegen tools take the Figma file and infer technical intent that isn't actually there.
- *"I tried explaining responsive in the chat but they keep getting it wrong."* — designer attempts to bridge the gap with prose, gets garbled spec.
- *"I don't want AI to design it for me. I designed it. I just want it built."* — explicit rejection of "AI does design" tools (Claude Design, v0, etc.).

---

## Value proposition

canicode provides three stacked layers. Each layer is useful alone; together they form the pre-implementation interview.

### Layer 1 — Linter (entry point, not the headline)
17 rules across 6 categories surface gaps that the designer's craft instinct senses but cannot name. Examples in the designer's voice:
- *"Something's off with the spacing here."* → `irregular-spacing` finds the one card with 14px padding.
- *"I'm not sure this will work on mobile."* → `fixed-size-in-auto-layout` and `missing-size-constraint` flag it.
- *"This component looks the same as that one but I made it twice."* → `missing-component:structure-repetition` (Phase 3).

The linter alone is read-only. Its value is unblocking the next layer — the designer cannot answer a question about a problem they didn't notice.

### Layer 2 — Question / Answer scaffolding ⭐ the headline
For each gap the linter finds, canicode emits a question in the designer's vocabulary, not the developer's:
- ❌ *"Set `flex-direction: column` for viewports below 768px."*
- ✅ *"The three cards are side-by-side at desktop width — what should happen when the screen is narrow?"*

The designer answers in plain language ("좁아지면 한 줄에 하나씩"). canicode translates that into the exact technical spec the codegen needs. The interview surfaces an intent the designer already had but never had words for.

### Layer 3 — Roundtrip persistence
Answers are written back into the Figma file as structured annotations. The next analysis run sees them and does not re-ask. The next designer / developer who opens the file sees them as Dev Mode notes. The implementation hand-off carries them automatically.

The persistence layer is what makes canicode an investment, not a one-time fix.

---

## Differentiation matrix

| Concern | canicode | Claude Design | figma-implement-design alone | No tool (designer + dev chat) |
|---|---|---|---|---|
| Who designs | Designer (in Figma) | AI (from prompt) | Designer (in Figma) | Designer |
| Who articulates technical intent | canicode pulls it out via Q&A | AI infers from prompt | AI infers from Figma | Designer types prose; dev re-interprets |
| Designer learning curve | Answers plain questions | Learns prompt engineering | None | None |
| Design tool | Figma (existing investment preserved) | Claude Design (new tool) | Figma | Figma |
| Iteration loop | Edit Figma → roundtrip again | New prompt | Edit Figma → re-codegen | Async chat / Slack |
| Intent persistence | Annotations in Figma file | Conversation history | None | Slack scrollback |
| Cost | Free, open source | Pro / Max / Team / Enterprise plans | Free (with Claude Code) | Engineer time |
| Best fit | Designer-led, craft-driven | Solo founder, MVP velocity | Skilled designer + skilled dev | Small team with strong rapport |

---

## NOT for

Naming the anti-target sharpens the position. canicode is **not the right tool** if you are:

- **A solo founder shipping an MVP fast.** Use Claude Design — prompts → app in minutes. canicode's interview would be friction.
- **A designer who likes "AI, make me a thing."** Use Claude Design or v0. canicode assumes you have a finished Figma you care about, not a request.
- **A senior designer who already speaks dev fluently.** Use figma-implement-design alone. canicode's questions would be obvious to you.
- **A team with no design system and no plan to build one.** canicode's component-mapping value evaporates without the system to map into.
- **A codegen-skeptic team that re-implements every Figma by hand.** The whole roundtrip is downstream of "we use AI codegen."

If three of the above are true, canicode is wrong for you. Honest.

---

## Why Claude Design does not eat this niche

Claude Design (Anthropic, launched 2026-04-17) overlaps with canicode on the surface — Figma input is supported, codegen output goes to Claude Code, Code Connect-style design system inference is in scope. But the **workflow assumption is structurally different**:

- Claude Design assumes the *AI designs*. The designer is either absent or supervising. Their craft instinct is a constraint Claude Design must reverse-engineer from a prompt or imported file.
- canicode assumes the *designer designs*. Their craft instinct is the input, not the constraint. canicode pulls technical intent out of an already-finished Figma without asking the designer to re-do anything.

Anthropic can patch Claude Design's responsive bugs, polish its mobile output, accept richer Figma imports — none of those moves change the workflow assumption. The designer who wants to *be* the designer is structurally not a Claude Design user.

This is the niche. It is small but durable.

---

## Honest open questions

Items we have **not** validated. Each is a hypothesis Show HN + first-user feedback should answer:

1. **Does the persona exist at scale?** "Craft designer who can't / won't code" is a real archetype, but the addressable count outside enterprise design teams (Linear, Vercel, Notion-scale) is unknown. May be a few thousand globally — useful but not a venture-scale market.
2. **Will designers actually answer in plain language?** The interview pattern depends on the designer engaging. If the gotcha questions feel like homework, abandon rate goes through the roof. Needs first-user telemetry.
3. **Is 5–10 questions per design too many?** Phase 2 / 3 designs surface dozens of gaps. Batching mitigates but does not solve.
4. **Does the designer-developer rapport canicode replaces actually want to be replaced?** Some teams *like* the async chat loop — it is also where requirements clarification happens. canicode bypassing that may erode collaboration.
5. **What is the right pricing model long-term?** Open source is correct for v0.x adoption. If the niche turns out to be enterprise design teams, support / customisation / private rule packs may become the revenue surface.

---

## North-star metric (aspirational, not yet measured)

**% of designs where the designer says "the implementation matches my intent" without further iteration.**

Today: unmeasured (no real-world users).
Telemetry hook: PostHog `cic_roundtrip_completed` event + post-handoff designer survey.

When this number is consistently above ~60% across diverse fixtures and real-world cases, canicode has earned its niche.

---

## Why this document exists

- **Decision filter**: every "should we build X?" check goes through "does X serve the persona above?"
- **README discipline**: keeps the README from drifting into "AI tool for everyone" generic copy.
- **Show HN pitch**: the first comment on the Show HN post will draw directly from the positioning statement at the top.
- **Future-self check**: in 6 months, re-read this doc and ask whether canicode still fits the niche or whether the niche has shifted.
- **External signal**: a public positioning brief tells contributors and curious users that the project has a thesis, not just code.

---

*Last updated: 2026-04-29 (after the v0.12.3 / Phase 3 GA + Claude Design landscape check).*
