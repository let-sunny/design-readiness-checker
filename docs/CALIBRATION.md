# Calibration Pipeline

CanICode's rule scores and severity levels are not arbitrary — they are continuously validated against actual code conversion difficulty through an automated 4-agent debate pipeline.

## Why Calibrate?

Initial rule scores were intuition-based estimates. A rule flagged as "blocking" with score -10 might turn out to be trivial to work around in practice (overscored), or a "suggestion" at -2 might actually cause significant conversion difficulty (underscored).

The calibration pipeline validates scores by:
1. Converting flagged Figma nodes to production code
2. Measuring how much each rule actually impacted conversion difficulty
3. Proposing score adjustments when predicted and actual difficulty diverge

## Pipeline Structure

```
/calibrate-loop <fixture>

Step 1 — Analysis (CLI)
  Run canicode calibrate-analyze to identify issues and group by node.

Step 2 — Converter (Subagent)
  Convert the top 5 flagged nodes to production CSS/HTML/React code.
  Assess actual conversion difficulty: easy | moderate | hard | failed.
  For each flagged rule, note whether it actually made conversion harder.

Step 3 — Evaluation (CLI)
  Compare predicted difficulty (from rule scores) vs actual difficulty.
  Generate score adjustment proposals.

Step 4 — Critic (Subagent)
  Challenge each proposal against rejection rules:
  - Rule 1: Low confidence + fewer than 2 supporting cases → reject
  - Rule 2: Change exceeds 50% of current value → cap at midpoint
  - Rule 3: Severity change without high confidence → reject

Step 5 — Arbitrator (Subagent)
  Make final decisions:
  - Both approve → apply Runner's value
  - Critic rejects → keep current score
  - Critic revises → apply Critic's conservative value
  Commits approved changes to rule-config.ts.
```

## Agents

| Agent | Role | Can edit rule-config.ts? |
|-------|------|------------------------|
| **Runner** | Runs analysis, extracts proposals | No |
| **Converter** | Converts Figma nodes to code, assesses difficulty | No |
| **Critic** | Applies rejection heuristics, caps excessive changes | No |
| **Arbitrator** | Makes final decisions, commits changes | Yes |

## Scoring Weights

### Density vs Diversity (0.7 / 0.3)

```
Final Score = (Density × 0.7) + (Diversity × 0.3)
```

- **Density (70%)** — How many issues per node? A file with 100 issues across 10 nodes is worse than 100 issues across 1000 nodes.
- **Diversity (30%)** — How many different rule types are violated? Failing 5 different rules is worse than failing the same rule 5 times.

The 70/30 split was chosen because density is a stronger signal of implementation difficulty — a node with many overlapping issues is genuinely harder to convert than a node that triggers one rule repeatedly.

### Severity Weights

| Severity | Weight | Rationale |
|----------|--------|-----------|
| Blocking | 3x | Cannot implement correctly without fixing. Direct impact on code output. |
| Risk | 2x | Implementable but will break or cost more later. |
| Missing Info | 1x | Developer must guess, but can still produce working code. |
| Suggestion | 0.5x | Nice to have, minimal conversion impact. |

These weights were validated through calibration: rules rated "blocking" consistently corresponded to "hard" conversion difficulty (3+ on a 1-4 scale), while "suggestion" rules rarely impacted conversion.

### Grade Scale

| Grade | Range | Meaning |
|-------|-------|---------|
| S | 95-100% | Production-ready, excellent structure |
| A+ | 90-94% | Minor improvements possible |
| A | 85-89% | Good, few issues |
| B+ | 80-84% | Above average |
| B | 75-79% | Average, some work needed |
| C+ | 70-74% | Below average |
| C | 65-69% | Significant issues |
| D | 50-64% | Major rework needed |
| F | 0-49% | Fundamental structural problems |

## Score Adjustment History

Rule scores in `src/rules/rule-config.ts` have been adjusted through multiple calibration cycles across different fixture files (Material 3 Design Kit, HTTP Design, Simple DS Card Grid, Simple DS Panel Sections, Simple DS Page Sections).

Each adjustment requires:
- Minimum 2 supporting cases at medium+ confidence
- Change magnitude within 50% of current value per cycle
- Severity changes require high confidence
- All changes committed with fixture source and reasoning

The full calibration log is auto-generated via `/calibrate-loop` and stored in `logs/activity/`.

## Running Calibration

Calibration runs inside Claude Code using the `/calibrate-loop` command:

```bash
# In Claude Code:
/calibrate-loop fixtures/my-design.json
```

For live Figma data with MCP:
```bash
/calibrate-loop-deep https://www.figma.com/design/ABC123/MyDesign?node-id=1-234
```

Calibration is an internal development tool — it is not exposed to end users.
