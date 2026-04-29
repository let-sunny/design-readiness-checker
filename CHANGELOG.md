# Changelog

All notable changes to this project are documented here. This project adheres
to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and, once
published as v1, will follow [Semantic Versioning](https://semver.org/).
While in v0.x, minor versions may carry breaking changes — they are called
out explicitly in the relevant entry.

Each entry summarises the user-visible change. Per-PR detail lives in the
[GitHub release notes](https://github.com/let-sunny/canicode/releases) for
the corresponding tag, and architecture rationale lives in
[ADR.md](.claude/docs/ADR.md).

## [Unreleased]

## [0.12.3] - 2026-04-29

### Added

- **Phase 3 — bootstrap a design system from screens** (Workflow 3 epic
  [#508](https://github.com/let-sunny/canicode/issues/508)) shipped GA. After
  upgrading, `canicode-roundtrip` performs the full **componentize+swap loop**
  end-to-end on any Stage 3 (`missing-component:structure-repetition`) group:
  one `yes` answer componentizes the document-order first member and swaps
  the rest with instances of the new component. Optional Code Connect
  registration follows automatically when prereqs are present.
- `applyComponentize` apply primitive — wraps `figma.createComponentFromNode`
  with the #368 instance-child guard and the ADR-023 decision A free-form
  parent guard. Annotate-fallback on every rejection.
- `applyReplaceWithInstance` apply primitive — wraps
  `mainComponent.createInstance()` + `parent.insertChild` + `target.remove()`
  with an independent swap-site free-form check.
- `applyGroupComponentize` orchestrator — drives the full loop from a
  single user `yes` answer; aggregates per-target outcomes into a single
  Step 4 line.
- `groupMembers` field on `RuleViolation` and `GotchaSurveyQuestion` —
  every node id in a Stage 3 fingerprint group surfaces in the survey
  output so the apply step can iterate the whole group.
- `RuleContext.analysisRoot` — Stage 3 (and now Stage 1/2) walks the
  active analysis subtree instead of the full file, fixing a silent scope
  leak under `--target-node-id` analysis.
- ADR-023 — Phase 3 design decisions A–E (free-form parent guard, no
  override threshold, name-collision auto-suffix in Figma's native ` 2`
  pattern, shared question UI for Forward/Reverse with `mode` field on the
  answer, silent-skip Code Connect handoff).

### Changed

- Stage 3 `missing-component:structure-repetition` is now **scope-wide**:
  duplicates spread across different parents within the analysis scope
  fold into the same fingerprint group instead of being missed by the old
  sibling-only walk. Message wording updates from `N sibling frame(s)` to
  `N other frame(s)`.
- Stage 1 (`unused-component`) and Stage 2 (`name-repetition`) now also
  honour `analysisRoot` for the frame-name walk — fixes the same
  silent-skip pattern when `--target-node-id` scopes the run.

### Documentation

- WORKFLOWS.md Workflow 3 promoted to ✅ Available with the new Today's
  flow, the bundled apply primitives, and two known limits (per-member
  opt-out, Stage 1 reverse case).

## [0.12.2] - 2026-04-28

### Fixed

- canicode-roundtrip Phase 2 live-verification follow-ups
  ([#545](https://github.com/let-sunny/canicode/issues/545),
  [#546](https://github.com/let-sunny/canicode/issues/546),
  [#547](https://github.com/let-sunny/canicode/issues/547),
  [#548](https://github.com/let-sunny/canicode/issues/548)) bundled into a
  single SKILL prose update — one batch per message pacing, output
  language detection, grade-movement attribution, and Step 1.5 doctor
  inconclusive handling on screen-scope FRAME URLs.

## [0.12.1] - 2026-04-28

### Added

- `canicode doctor --figma-url <url>` publish-status pre-check
  ([#532](https://github.com/let-sunny/canicode/issues/532)) — verifies
  the target Figma component is published in a library before the
  roundtrip's closing Code Connect mapping step asks the satisfaction
  prompt. Surfaces inconclusive when `FIGMA_TOKEN` is not configured or
  the URL has no node-id; failure cases print remediation hints.
- `unmapped-component` v1.5 — parser-driven main check
  ([#526](https://github.com/let-sunny/canicode/issues/526)) and
  acknowledgment-channel opt-out write path
  ([#543](https://github.com/let-sunny/canicode/issues/543)) so designers
  can mark a component "intentionally unmapped" and have the rule
  silently skip it on subsequent roundtrips.
- ADR-022 — `unmapped-component` opt-out via the existing acknowledgment
  channel + the REST private-beta annotations field gating that limits
  standalone analyze visibility.

### Fixed

- Bridge `CanICodeRoundtrip` onto `globalThis` inside `eval`
  ([#533](https://github.com/let-sunny/canicode/issues/533)) so the
  bundled IIFE survives Plugin API hosts that wrap the script in a
  shadowed scope.

### Documentation

- SKILL Step 4 inline-staging guidance + Step 7d single-mapping path
  ([#531](https://github.com/let-sunny/canicode/issues/531),
  [#534](https://github.com/let-sunny/canicode/issues/534)).

## [0.12.0] - 2026-04-27

### Added

- **Phase 1 — component-to-code mapping** roundtrip closing step
  ([#515](https://github.com/let-sunny/canicode/issues/515)): after
  `figma-implement-design` finishes, the roundtrip prompts for
  satisfaction and registers a Code Connect mapping
  (`add_code_connect_map` + `send_code_connect_mappings`) so future
  roundtrips on screens containing the same component reuse the
  generated code instead of regenerating markup.
- `canicode doctor` — verifies `@figma/code-connect` install and
  `figma.config.json` presence in the user's repo before the roundtrip
  reaches the mapping step
  ([#512](https://github.com/let-sunny/canicode/issues/512)).
- `unmapped-component` analyze rule
  ([#520](https://github.com/let-sunny/canicode/issues/520)) — flags
  Figma components that have no Code Connect mapping yet, with the
  optional Workflow 1 onboarding pointer.
- New `note` severity tier (zero score impact) for annotation-primary
  rules whose value is the nudge, not the score
  ([#519](https://github.com/let-sunny/canicode/issues/519)). Backfills
  `missing-prototype`, `missing-interaction-state`,
  `missing-size-constraint`, `unmapped-component`.
- ADR-021 — handoff carriers and conflict resolution between
  `canicode-roundtrip` and `figma-implement-design`.
- WORKFLOWS.md — new 3-phase canicode bootstrap roadmap document
  ([#511](https://github.com/let-sunny/canicode/issues/511)).

### Changed

- `canicode init` split into interactive setup + a separate
  `canicode config set-token` subcommand
  ([#506](https://github.com/let-sunny/canicode/issues/506)). Existing
  users who relied on the old combined flow should move the token-only
  step to `config set-token`.
- Stripped internal issue / ADR refs from user-facing surfaces
  ([#504](https://github.com/let-sunny/canicode/issues/504)) so the
  README and SKILL prose read cleanly to a first-time user.

## [0.11.5] - 2026-04-25

### Added

- Claude Code marketplace manifest
  ([#497](https://github.com/let-sunny/canicode/issues/497)) so canicode
  appears in Claude Code's plugin/skill catalogue.
- "Other agents" install guide for non-Claude/Cursor hosts
  ([#502](https://github.com/let-sunny/canicode/issues/502)) — manual
  skill copy instructions for hosts that do not auto-discover skills.

### Documentation

- Polished `canicode init` path docs
  ([#499](https://github.com/let-sunny/canicode/issues/499)) following
  user-flow testing.

[Unreleased]: https://github.com/let-sunny/canicode/compare/v0.12.3...HEAD
[0.12.3]: https://github.com/let-sunny/canicode/compare/v0.12.2...v0.12.3
[0.12.2]: https://github.com/let-sunny/canicode/compare/v0.12.1...v0.12.2
[0.12.1]: https://github.com/let-sunny/canicode/compare/v0.12.0...v0.12.1
[0.12.0]: https://github.com/let-sunny/canicode/compare/v0.11.5...v0.12.0
[0.11.5]: https://github.com/let-sunny/canicode/compare/v0.11.4...v0.11.5
