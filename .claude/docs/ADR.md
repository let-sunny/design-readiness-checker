# Architecture Decision Records

Core decisions that shape every session. For full history see [GitHub Wiki Decision Log](https://github.com/let-sunny/canicode/wiki/Decision-Log).

## ADR-001: design-tree > raw Figma JSON

**Decision**: Use curated design-tree format for AI/codegen inputs. Do not feed raw Figma JSON into AI/codegen. Ingestion pipelines (loader, FigmaFileLoader) accept raw JSON and transform it into design-tree before any codegen use.
**Why**: design-tree 94% vs raw 79% pixel accuracy with 5x fewer tokens. Information curation > information abundance.
**Impact**: All code generation pipelines use design-tree as input. Raw JSON is only for ingestion/transformation, never passed directly to AI.

## ADR-002: Ablation + visual-compare for calibration, not LLM self-report

**Decision**: Measure rule impact by stripping info from design-tree and comparing visual output. Do not ask LLM what helped.
**Why**: LLM self-assessment is unreliable — self-attribution bias (87.76% self-preference), weak counterfactual reasoning (25-40% accuracy drop), post-hoc rationalization. Academic evidence is clear.
**Impact**: Calibration pipeline uses strip ablation (6 types) + pixel-level visual-compare. No survey-based scoring.

## ADR-003: No custom rules

**Decision**: Removed `--custom-rules` option entirely (-1,465 lines). Only `--config` for threshold tuning.
**Why**: "We provide the perfect set." Custom rules added complexity (diversity denominator issues) without value.
**Impact**: Do not add extensibility points for user-defined rules.

## ADR-004: Score = gotcha burden prediction

**Decision**: Analysis score predicts how many gotchas (manual annotations) a design needs for correct implementation.
**Why**: Roundtrip pivot — canicode diagnoses, then elicits gotchas from users. S-grade = no gotchas needed, D-grade = many needed.
**Impact**: Score/lint framing should always connect to gotcha burden. See [Round-Trip Integration wiki](https://github.com/let-sunny/canicode/wiki/Round-Trip-Integration).

## ADR-005: Platform standards cover web + app

**Decision**: Rules recognize CSS (hover, focused), Material Design (pressed), and UIKit (highlighted) standards equally.
**Why**: Figma designs target web and mobile. Web-only standards would produce false positives for app designs.
**Impact**: Rule detection patterns must accept all platform interaction state names.

## ADR-006: Large fixtures (270+ nodes) only for calibration

**Decision**: Only use large-scale fixtures for calibration. Small fixtures (50-100 nodes) are invalid.
**Why**: Small fixtures produce misleading results — AI can guess layout at small scale. At 270+ nodes, information gaps become measurable (structure strip: -10% similarity).
**Impact**: Never lower component-related rule scores based on small fixture calibration.

## ADR-007: npm publish is CI only

**Decision**: Never run `npm publish` manually. Tags trigger GitHub Actions.
**Why**: Ensures provenance, consistent build environment, and review gate.
**Impact**: Local `npm publish` is blocked by safety hooks.

## ADR-009: Gotcha delivery via orchestration skill

**Decision**: Deliver gotcha answers to code generation via an orchestration skill (`canicode-roundtrip`), not via auto-discovery of a separate skill file.
**Why**: Analysis of all 7 official Figma skills shows cross-skill references are **explicit links** (`[figma-use](../figma-use/SKILL.md)`), not auto-discovery. `figma-implement-design` is a built-in skill that cannot be modified to reference `canicode-gotchas`. Therefore, a single orchestration skill handles the full flow: analyze → gotcha survey → code generation with gotcha context. This follows the established pattern: `figma-generate-design` builds on `figma-use`, and community skill `bridge-ds` orchestrates 6 skills + a knowledge-base with a recipe system. See #277.
**Impact**: `canicode-gotchas` (standalone survey) is preserved, but code generation delivery is handled by `canicode-roundtrip`. Do not rely on auto-discovery to connect separate skill files — Figma skills only support explicit references.
**References**:
- [Figma skills for MCP](https://help.figma.com/hc/en-us/articles/39166810751895-Figma-skills-for-MCP) — official skill structure
- [Figma community skills](https://www.figma.com/community/skills) — third-party skill ecosystem
- [figma/mcp-server-guide/skills](https://github.com/figma/mcp-server-guide/tree/main/skills) — 7 official skill sources, explicit cross-skill reference pattern
- [figma/community-resources/agent_skills](https://github.com/figma/community-resources/tree/main/agent_skills) — community skills (bridge-ds: recipe system, ds-compliance-audit)
- [noemuch/bridge](https://github.com/noemuch/bridge) — bridge-ds source, learning-from-corrections pattern
- [From Claude Code to Figma — and Back Again](https://fig-events.figma.com/claude-to-figma/) — gotcha pattern (49:36–50:17), skill auto-loading (42:26–42:43)

## ADR-010: Roundtrip — gotcha answers applied back to Figma design

**Decision**: Apply gotcha answers back to the Figma design via `use_figma` (Plugin API), not just pass them as code generation context. Three strategies by rule type: (1) property modification for 8 rules (naming, spacing, sizing, variables), (2) structural modification for 4 rules (nesting, components) with user confirmation, (3) annotations for 4 rules that cannot be auto-fixed (absolute positioning, variant structure, interaction states, prototypes).
**Why**: One-way flow (analyze → gotcha → code gen) is not a true roundtrip. Applying answers to the design means the next analysis passes without gotchas — the design itself improves. PoC confirmed all three strategies work via Figma Plugin API: `node.name`, `itemSpacing`, `setBoundVariable()`, `layoutSizingHorizontal`, `node.annotations`. Annotations enable designer communication for issues that require manual judgment.
**Impact**: `canicode-roundtrip` becomes a true roundtrip: analyze → gotcha → apply to Figma → re-analyze → pass → code gen. All 16 rules are covered (modify or annotate). Requires Full seat + file edit permission. See #281.

## ADR-011: Instance-child writes — try scene, then source definition, then annotate

**Decision**: For gotcha apply (`use_figma` / Plugin API), attempt property writes on the scene node from `question.nodeId` first. On instance-override errors, resolve the source definition using `question.instanceContext.sourceNodeId` (and `getMainComponentAsync()` when needed) and apply there **only after explicit user confirmation**, because definition edits propagate to every instance of that component in the file. If the source is in an external library (`mainComponent` null) or the write still fails, fall back to annotations on the scene node.
**Why**: Roundtrip Experiment 07 showed most violations sit under `INSTANCE` subtrees; many properties (for example `minWidth` / `maxWidth`) cannot be overridden on instance children, so naive `getNodeById` writes stall at D→C-style gains. Server-side `instanceContext` on `gotcha-survey` questions plus this three-tier policy unlocks meaningful fixes without silently reshaping shared components.
**Impact**: `canicode-roundtrip` SKILL documents the matrix, `applyWithInstanceFallback`, and confirmation for definition-level changes. TypeScript adds `resolveGotchaApplyTarget` for programmatic consumers. See #286 and [Roundtrip Experiment 07](https://github.com/let-sunny/canicode/wiki/Roundtrip-Experiment-2026-04-17).
**References**: [InstanceNode#mainComponent](https://www.figma.com/plugin-docs/api/InstanceNode/#maincomponent)

## ADR-008: Calibration pipeline — explicit claude -p orchestration

**Decision**: Replace single-session delegated orchestrator with TypeScript script (`scripts/calibrate.ts`) that explicitly calls CLI commands for deterministic steps and `claude -p` for judgment steps (converter, gap-analyzer, critic, arbitrator). Strip ablation runs 7 parallel sessions. Delete `orchestrator.ts`.
**Why**: Delegated orchestration accumulates context pressure, can't retry individual steps, and hides flow logic in Claude's head. Explicit orchestration is transparent, debuggable, and gives fresh context per step.
**Impact**: Calibration flow is script-controlled. Each step produces artifacts in run directory with `index.json` state tracking. Agents are judgment-only, CLI handles computation. See #245.
