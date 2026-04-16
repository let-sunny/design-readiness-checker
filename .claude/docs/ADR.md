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

## ADR-009: Gotcha delivery via Figma MCP skill auto-discovery

**Decision**: Gotcha answers are written as a `.claude/skills/canicode-gotchas/SKILL.md` file in the user's project. No explicit wiring to code generation prompts or skills is needed.
**Why**: Claude Code automatically scans `.claude/skills/` and loads relevant skills based on the `description` field and conversation context. When a user asks "implement this design", Claude Code finds the gotcha skill file (description: "Design gotcha answers for … — reference during code generation") and includes it in the code generation context. This is the standard Figma MCP pattern — gotchas are "debugging guides" that prevent AI from repeating mistakes (e.g., always making badges oval instead of circular). See [From Claude Code to Figma — and Back Again](https://fig-events.figma.com/claude-to-figma/).
**Impact**: Do NOT add explicit gotcha references to code generation prompts, PROMPT.md, or other skills. The skill file with an appropriate description is the complete delivery mechanism. Adding explicit references would bypass the skill system's design and create maintenance coupling.

## ADR-008: Calibration pipeline — explicit claude -p orchestration

**Decision**: Replace single-session delegated orchestrator with TypeScript script (`scripts/calibrate.ts`) that explicitly calls CLI commands for deterministic steps and `claude -p` for judgment steps (converter, gap-analyzer, critic, arbitrator). Strip ablation runs 7 parallel sessions. Delete `orchestrator.ts`.
**Why**: Delegated orchestration accumulates context pressure, can't retry individual steps, and hides flow logic in Claude's head. Explicit orchestration is transparent, debuggable, and gives fresh context per step.
**Impact**: Calibration flow is script-controlled. Each step produces artifacts in run directory with `index.json` state tracking. Agents are judgment-only, CLI handles computation. See #245.
