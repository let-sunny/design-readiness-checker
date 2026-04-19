<!--
This template is auto-loaded by GitHub when opening a PR. Delete sections
that don't apply to your PR — the ADR-016 block at the bottom is the only
project-specific gate, the rest is conventional.
-->

## Summary

<!-- 1-3 bullets on what this PR does and why. Link the issue(s) it closes. -->

-

## Test plan

<!-- Checklist of how you / the reviewer can verify this PR works. -->

- [ ]

## ADR-016 checklist (deterministic logic in SKILL.md)

ADR-016 (`.claude/docs/ADR.md`) requires that any deterministic transformation, predicate, accumulator, sort/group/partition, parser, or state-machine asked of the LLM in a `.claude/skills/*/SKILL.md` file lives in TypeScript with vitest coverage — not in SKILL.md prose. CI enforces this via `pnpm check:skill-determinism` (PR #389), but a few patterns the grep gate cannot catch require author judgment.

Tick **one**:

- [ ] This PR does **not** edit any `.claude/skills/*/SKILL.md` file.
- [ ] This PR edits a SKILL.md file, and every prose change I added is purely workflow orchestration / rendering template / branching on a pre-computed field / LLM judgment. Anything with a deterministic input → output mapping has been extracted to `src/core/` with vitest coverage and is consumed via either `helpers.js` (`canicode-roundtrip`, see PR #303) or a `gotcha-survey` response field (`canicode-gotchas`, see PRs #381 / #387 for the pattern).

If I extracted the **computation** side of a deterministic flow, I also extracted the **input collection** and **output rendering** sides on the same flow (the half-extraction lesson from #383 → #386 — extracting `computeRoundtripTally` while leaving the LLM to count its own emoji bullets did not close the drift surface):

- [ ] N/A — no deterministic extraction in this PR.
- [ ] Yes — full cycle is in TS.

If I added an `<!-- adr-016-ack: ... -->` or `// adr-016-ack: ...` marker in any SKILL.md, I justified each one in the **Summary** section above (the grep gate accepts the marker but reviewers should still see why):

- [ ] N/A — no new ACK markers.
- [ ] Yes — each new ACK is explained above.
