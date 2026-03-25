# Scoring Model

canicode scores designs on a 0-100% scale across 5 categories:
**structure**, **token**, **component**, **naming**, **behavior**.

## How Scores Are Calculated

Each category score combines two signals:

### 1. Density (70% weight)

Measures issue volume relative to design size.

```
density_score = 100 - (weighted_issues / node_count) * 100
```

A design with many issues per node scores lower. Issues are weighted by severity (see below), so a single blocking issue has more impact than several suggestions.

### 2. Diversity (30% weight)

Measures how many different rule types triggered.

```
diversity_score = (1 - unique_rules / total_category_rules) * 100
```

Issues concentrated in one rule type are easier to fix than scattered issues across many rules. A design that triggers 1 rule 50 times is more fixable than one triggering 10 different rules.

### Combined Score

```
category_score = density * 0.7 + diversity * 0.3
overall_score  = average of all 5 category scores (equal weight)
```

The 70:30 ratio prioritizes volume over variety. A design with a single systemic problem (e.g., all frames missing auto-layout) is still very hard to implement even though diversity is low.

## Severity Weights

Issues are weighted by severity when computing density:

| Severity | Weight | Meaning |
|----------|--------|---------|
| **blocking** | 3.0x | Cannot implement correctly without fixing |
| **risk** | 2.0x | Implementable now but will break or increase cost later |
| **missing-info** | 1.0x | Information absent, forcing developers to guess |
| **suggestion** | 0.5x | Not immediately problematic, improves systemization |

A single blocking issue counts as much as 6 suggestions.

## Grade Thresholds

| Grade | Threshold | Grade | Threshold |
|-------|-----------|-------|-----------|
| S | >= 95% | C+ | >= 70% |
| A+ | >= 90% | C | >= 65% |
| A | >= 85% | D | >= 50% |
| B+ | >= 80% | F | < 50% |
| B | >= 75% | | |

## Score Floor

Minimum score is **5%**. Any Figma file with visible nodes provides some structural information, so 0% ("completely unimplementable") is avoided.

## Category Weights

All categories are weighted equally (1.0). No category is inherently more important than another — individual rule scores within each category already encode relative importance.

## Calibration Status

> **These values are initial estimates, not yet validated by calibration data.**

The severity weights, density/diversity ratio, and grade thresholds started as intuition-based values. The [`/calibrate-loop`](CALIBRATION.md) pipeline validates them against pixel-level visual comparison:

1. Convert a Figma design to code
2. Compare the result against the original screenshot (`visual-compare`)
3. Check if designs with low scores are actually harder to implement accurately

Calibration evidence accumulates across runs in `data/calibration-evidence.json`. As more evidence is collected, these constants will be adjusted to better reflect actual implementation difficulty.

## Overriding Scores

Individual rule scores can be overridden via `--config`:

```json
{
  "rules": {
    "no-auto-layout": { "score": 20, "severity": "blocking" },
    "raw-color": { "enabled": false }
  }
}
```

```bash
canicode analyze ./my-design --config ./my-config.json
```

See the [config override reference](REFERENCE.md) for full options.
