# Scoring Model

canicode scores designs on a 0-100% scale across 5 categories:
**structure**, **token**, **component**, **naming**, **behavior**.

## What the Score Measures

The score reflects **how well AI can implement this design** — combining pixel accuracy, responsive readiness, and implementation efficiency.

Empirical validation (ablation experiments, 270+ node fixtures):

| Category | Impact on pixel accuracy | Impact on responsive | Empirical rank |
|---|---|---|---|
| **structure** | -10%p when missing | -32%p at different viewport | **#1 — dominant** |
| **token** | -4%p when missing | none | #2 |
| **component** | -3%p when missing | none | #3 |
| **naming** | 0%p | none | #4 (affects token cost) |
| **behavior** | 0%p | not measurable with static analysis | #5 |

See [experiment results](https://github.com/let-sunny/canicode/wiki) for full data.

## How Scores Are Calculated

Each category score combines two signals:

### 1. Density (70% weight)

Measures issue volume relative to design size.

```
density_score = 100 - (weighted_issues / node_count) * 100
```

Issues are weighted by their calibrated per-rule score (`calculatedScore` from rule-config.ts), which incorporates both the base score and depth weight.

### 2. Diversity (30% weight)

Measures how many different rule types triggered, weighted by per-rule score magnitude.

```text
diversity_ratio = sum(|score| of triggered rules) / sum(|score| of all category rules)
diversity_score = (1 - diversity_ratio) * 100
```

Each triggered rule contributes its absolute `score` value (from `rule-config.ts`), not a flat count. A rule with score -10 penalizes diversity more than one with score -1. This prevents a single concentrated high-impact problem from getting a misleadingly high diversity score.

### Combined Score

```
category_score = density * 0.7 + diversity * 0.3
overall_score  = average of all 5 category scores (equal weight)
```

## Severity Levels

| Severity | Meaning |
|----------|---------|
| **blocking** | Cannot implement correctly without fixing. Direct impact on pixel accuracy. |
| **risk** | Implementable now but will break or increase cost later |
| **missing-info** | Information absent, forcing developers to guess |
| **suggestion** | Not immediately problematic, improves systemization |

## Grade Thresholds

| Grade | Threshold | Grade | Threshold |
|-------|-----------|-------|-----------|
| S | >= 95% | C+ | >= 70% |
| A+ | >= 90% | C | >= 65% |
| A | >= 85% | D | >= 50% |
| B+ | >= 80% | F | < 50% |
| B | >= 75% | | |

## Score Floor

Minimum score is **5%**. Any Figma file with visible nodes provides some structural information.

## Category Weights

Currently all categories are weighted equally (1.0). Ablation experiments suggest structure should be weighted higher (ΔV -10% vs token -4%), but this requires validation across more fixtures before adjusting.

## Calibration

Rule scores are continuously refined through two methods:

### 1. Calibration loop (`/calibrate-loop`)

The primary calibration pipeline — runs within Claude Code:

1. Analyze a real Figma fixture
2. Implement the entire design as one HTML page (Converter)
3. Compare pixel-level accuracy against Figma screenshot (`visual-compare`)
4. Analyze diff images to categorize pixel gaps (Gap Analyzer)
5. 6-agent debate loop: Analysis → Converter → Gap Analyzer → Evaluation → Critic → Arbitrator

Cross-run evidence accumulates in `data/calibration-evidence.json`. Score adjustments in `rule-config.ts` are always reviewed by the developer.

### 2. Ablation experiments

Controlled experiments that measure the impact of each design category:

1. Create good/bad fixture pairs (each breaking exactly one category)
2. Implement via AI and measure pixel accuracy
3. Test at multiple viewports (375px, 500px) for responsive impact
4. Compare input methods (design-tree vs raw JSON vs MCP)

Results are documented in the [Experiment Wiki](https://github.com/let-sunny/canicode/wiki).

## Overriding Scores

Individual rule scores can be overridden via `--config`:

```json
{
  "rules": {
    "no-auto-layout": { "score": -15, "severity": "blocking" },
    "raw-color": { "enabled": false }
  }
}
```

```bash
canicode analyze ./my-design --config ./my-config.json
```

See the [config override reference](REFERENCE.md) for full options.
