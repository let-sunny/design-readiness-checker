# Score Calibration

Rule scores started as intuition-based estimates. The calibration pipeline validates them against actual code conversion difficulty measured by pixel-level visual comparison.

## Process

1. Run analysis on real Figma files (`canicode calibrate-analyze`)
2. Implement the entire scoped design as one HTML page (`Converter`)
3. **Strip ablation** (#194): For each of 6 info types in `DESIGN_TREE_INFO_TYPES`, strip from design-tree -> convert -> measure similarity delta vs baseline -> objective difficulty per rule category
4. Run `canicode visual-compare` — pixel-level comparison against Figma screenshot
5. Analyze the diff image to categorize pixel gaps (`Gap Analyzer`)
6. Compare conversion difficulty vs rule scores (`canicode calibrate-evaluate`) — strip deltas override Converter self-assessment
7. Debate pipeline (`scripts/calibrate.ts`): Analysis -> Converter (baseline + 6 strips, 7 parallel `claude -p` sessions) -> Measurements -> Gap Analyzer -> Evaluation -> Critic -> Arbitrator. Each step tracked in `index.json` for resume-from-failure.
8. **Multi-fixture mode** (`--all`): Discovers active fixtures, runs the 14-step pipeline sequentially for each, checks convergence via `fixture-done`, runs regression check, and generates aggregate gap report.

## Critic structured evidence (#144)

- Proposals from evaluation
- Converter's `ruleImpactAssessment` (actual implementation difficulty per rule)
- Gap analysis (actionable pixel gaps)
- Prior cross-run evidence for proposed rules
- Outputs structured pro/con arguments + confidence level per proposal

## Early-stop and self-consistency (#144)

- All proposals rejected with high confidence -> Arbitrator skipped (early-stop)
- Low-confidence decisions -> held (not applied), evidence accumulates for future runs (self-consistency)
- `stoppingReason` recorded in debate.json for traceability

## Cross-run evidence

Accumulates across sessions in `data/`:
- `calibration-evidence.json` — overscored/underscored rules with confidence, pro/con, decision (fed to Critic for informed review)
- Evidence is pruned after rules are applied (calibration)

Final score adjustments in `rule-config.ts` are always reviewed by the developer via the Arbitrator's decisions.

## Ablation experiments (`src/experiments/ablation/`)

Two scripts, shared helpers:

### `run-strip.ts` — Strip experiments

```bash
ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-strip.ts
ABLATION_FIXTURES=desktop-product-detail ABLATION_TYPES=component-references npx tsx ...
```

- Strips info from design-tree -> implements via Claude API -> renders -> compares vs Figma screenshot
- Strip types follow `DESIGN_TREE_INFO_TYPES`: layout-direction-spacing, size-constraints, component-references, node-names-hierarchy, variable-references, style-references
- Output: `data/ablation/phase1/{config-version}/{fixture}/{type}/run-{n}/`
- Metrics recorded: pixel similarity, input/output tokens, HTML bytes/lines, CSS class count, CSS variable count
- Cache: versioned by config hash. Never delete — previous versions preserved automatically.

### `run-condition.ts` — Condition experiments

```bash
ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-condition.ts --type size-constraints
ANTHROPIC_API_KEY=sk-... npx tsx src/experiments/ablation/run-condition.ts --type hover-interaction
```

- **size-constraints**: strip size info -> implement via API -> `removeRootFixedWidth` (1200px->100%, min-width->0) -> render at 1920px (desktop) or 768px (mobile) -> compare vs screenshot-1920/768.png. Both baseline and stripped get same treatment.
- **hover-interaction**: implement with vs without `[hover]:` data -> compare :hover CSS rules and values
- Output: `data/ablation/conditions/{type}/{fixture}/`

### `helpers.ts` — Shared utilities

- API call with retry (429/529), HTML parsing/sanitization, local font injection
- CSS metrics, render+compare+crop pipeline, fixture validation

### Parallel execution across agents

- Results saved to `data/ablation/` (git-tracked) so multiple cloud agents can contribute
- Same config-version -> same directory. Split work by fixture or type:
  ```
  Agent A: ABLATION_BASELINE_ONLY=true                              # baseline only
  Agent B: ABLATION_TYPES=layout-direction-spacing,component-references
  Agent C: ABLATION_TYPES=node-names-hierarchy,variable-references,style-references
  ```
- **Do NOT assign the same fixture+type+run to multiple agents** — results will conflict
- After all agents finish, re-run the script (cached results reused) to generate combined summary.json
