# Calibration Pipeline

CanICode's rule scores and severity levels are not arbitrary — they are continuously validated against actual code conversion difficulty through an automated 6-step calibration pipeline.

## Why Calibrate?

Initial rule scores were intuition-based estimates. A rule flagged as "blocking" with score -10 might turn out to be trivial to work around in practice (overscored), or a "suggestion" at -2 might actually cause significant conversion difficulty (underscored).

The calibration pipeline validates scores by:
1. Implementing the entire scoped design as one HTML page
2. Measuring pixel-level similarity against the Figma screenshot (`visual-compare`)
3. Analyzing diff images to categorize pixel gaps
4. Proposing score adjustments when predicted and actual difficulty diverge

## Pipeline Structure

```
/calibrate-loop <fixture>

Step 1 — Analysis (CLI)
  Run canicode calibrate-analyze to identify issues and group by node.

Step 2 — Converter (Subagent)
  Implement the ENTIRE scoped design as one HTML page.
  Run visual-compare for pixel-level similarity against Figma screenshot.

Step 3 — Gap Analyzer (Subagent)
  Analyze the diff image between Figma screenshot and generated code.
  Categorize each pixel difference (spacing, color, typography, layout, etc.).
  Append uncovered gaps to data/discovery-evidence.json.

Step 4 — Evaluation (CLI)
  Compare predicted difficulty (from rule scores) vs actual difficulty.
  Generate score adjustment proposals.
  Append overscored/underscored findings to data/calibration-evidence.json.

Step 5 — Critic (Subagent)
  Challenge each proposal against rejection rules:
  - Rule 1: Low confidence + fewer than 2 supporting cases → reject
  - Rule 2: Change exceeds 50% of current value → cap at midpoint
  - Rule 3: Severity change without high confidence → reject

Step 6 — Arbitrator (Subagent)
  Make final decisions:
  - Both approve → apply Runner's value
  - Critic rejects → keep current score
  - Critic revises → apply Critic's conservative value
  Commits approved changes to rule-config.ts.

Step 6.5 — Prune Evidence
  Remove evidence for rules that were just adjusted from
  data/calibration-evidence.json (applied rules) and
  data/discovery-evidence.json (covered gaps).
```

### Tiered Approach

Not all fixtures go through the full pipeline. The tier is based on the current grade:

| Grade | Pipeline | Rationale |
|-------|----------|-----------|
| A+ and above | Full pipeline (Converter + Gap Analysis) | High-quality designs benefit from gap analysis |
| Below A | Converter + visual-compare only (skip gap analysis) | Low-scoring designs need score validation the most |

**Always run the Converter** regardless of grade. Skipping visual-compare on low-scoring designs means scores can never be validated.

## Agents

| Agent | Role | Can edit rule-config.ts? |
|-------|------|------------------------|
| **Runner** | Runs analysis, extracts proposals | No |
| **Converter** | Implements entire design as HTML, runs visual-compare | No |
| **Gap Analyzer** | Categorizes pixel differences from diff image | No |
| **Evaluator** | Compares predicted vs actual difficulty | No |
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

## Cross-Run Evidence

Evidence accumulates across calibration sessions in `data/`:

- **`data/calibration-evidence.json`** — Overscored/underscored rules. Fed back to the Evaluator in subsequent runs for stronger proposals.
- **`data/discovery-evidence.json`** — Uncovered gaps not covered by existing rules. Fed to the `/add-rule` Researcher to find recurring patterns worth turning into new rules.

Discovery evidence is filtered to exclude environment/tooling noise (font CDN differences, retina/DPI scaling, network artifacts, CI constraints). Evidence is pruned after rules are applied (calibration) or new rules are created (discovery).

## Score Adjustment History

Rule scores in `src/core/rules/rule-config.ts` have been adjusted through multiple calibration cycles across different fixture files (Material 3 Design Kit, HTTP Design, Simple DS Card Grid, Simple DS Panel Sections, Simple DS Page Sections).

Each adjustment requires:
- Minimum 2 supporting cases at medium+ confidence
- Change magnitude within 50% of current value per cycle
- Severity changes require high confidence
- All changes committed with fixture source and reasoning

The full calibration log is auto-generated via `/calibrate-loop` and stored in `logs/calibration/<name>--<timestamp>/activity.jsonl`.

## Running Calibration

Calibration runs inside Claude Code using the `/calibrate-loop` command:

```bash
# In Claude Code:
/calibrate-loop fixtures/my-design
```

For live Figma data with MCP:
```bash
/calibrate-loop-deep https://www.figma.com/design/ABC123/MyDesign?node-id=1-234
```

Calibration is an internal development tool — it is not exposed to end users.

---

## Appendix: Debate Highlights

Real excerpts from calibration debates across 5 fixtures and 7+ rounds.

### deep-nesting: -10 → -4 (over 4 rounds)

**Round 1 — Runner proposed -10 → -2:**
> Converter: "deep-nesting flagged on all 5 nodes but actual impact was easy — depth alone is not the primary conversion barrier."

**Critic rejected (-80% change):**
> "Rule 2: proposed change exceeds 50% cap. Midpoint -6 applied."

**Round 2 — Runner proposed -6 → -2 again:**
> Critic: "Same excessive reduction. Conversion log shows mixed difficulty — easy for well-structured auto-layout, moderate for layout containers. Revised to -4."

**Round 4 — Stabilized at -4 (risk):**
> Arbitrator: "Confirmed at -4. Cross-fixture evidence consistently shows depth adds verbosity but rarely blocks conversion."

### raw-color: -10 → -2 (over 3 rounds)

**Round 1 — Runner proposed -10 → -2:**
> Converter: "raw-color flagged on 4 nodes with `visible: false` fills — these are Figma ghost layers. Actual impact: easy."

**Critic approved direction, capped magnitude:**
> "High confidence, 4 cases. But -10 → -2 is 80% change. Revised to -6."

**Round 2 — -6 → -4:**
> "4 easy-difficulty cases again. High confidence. Midpoint -4 approved."

**Round 3 — -4 → -2:**
> Runner: "4 cases, all easy. raw-color on invisible fills is noise, not a real conversion difficulty."
> Critic: "Approved. 50% change within limit. Severity to missing-info approved at high confidence."

### no-auto-layout: oscillation between -5 and -8

**The problem:** Icon nodes scored "easy" (overscored), but layout containers scored "hard" (underscored). Same rule, opposite signals.

**Round 3 — Critic caught the conflict:**
> "Runner proposes -2 (overscored) and -10 (underscored) for the same rule simultaneously. Both rejected — contradictory evidence."

**Resolution:** After applying the node filter to exclude icons from conversion candidates, the rule stabilized at -5 → -7. Only layout containers were evaluated, giving consistent "hard" signals.

### group-usage: -6 → -8 → -5

**Round 1 — Raised to -8 (blocking):**
> Converter: "GROUP nodes prevent auto-layout. All 4 icon nodes rated hard because GROUP forces absolute positioning."
> Critic: "High confidence, 4 cases. Approved. Severity risk → blocking."

**Round 2 — Reduced to -5 (risk):**
> Converter (with filtered nodes): "GROUP inside a real UI component causes moderate difficulty, not hard. The hard ratings were from icon nodes."
> Critic: "High confidence, 3 cases. 37.5% change within limit. Severity back to risk."

### no-auto-layout: validated with absorbed rules

**After absorbing `ambiguous-structure` and `missing-layout-hint`:**
> Converter: "Children named 'Path', 'Path', 'Path' with no semantic distinction — programmatic conversion is impossible without visual rendering."
> Critic: "4 cases, all hard. The merged `no-auto-layout` rule now covers these structure clarity signals. Score -7 at blocking confirmed."

### New rule proposals: VECTOR no path data

**Proposed 5 times across 4 fixtures, approved 4 times:**
> Converter (Round 1): "VECTOR nodes contain no SVG path data in the REST API response. Accurate icon reproduction is impossible."
> Critic (Round 1): "Approved. 5 cases, all hard, blocking severity justified."
> Critic (Round 2): "Second-fixture corroboration. Cross-fixture threshold satisfied."
> Arbitrator: "Saved to proposals log. Awaiting rule logic implementation before adding to rule-config.ts."

### Critic rejection patterns

Most rejections fell into two categories:

**1. Insufficient evidence (Rule 1) — 70% of rejections:**
> "Low confidence + 1 case. Minimum threshold is 2 cases at medium confidence."

**2. Excessive change (Rule 2) — 25% of rejections:**
> "Proposed change of 67% exceeds the 50% per-round cap. Midpoint applied."

The Critic's conservatism prevented score whiplash — without it, `no-auto-layout` would have oscillated between -2 and -10 indefinitely.

---

## Gap Analysis

The Gap Analyzer (Step 3) examines the diff image between Figma screenshot and AI-generated code. Each gap is categorized (spacing, color, typography, layout, etc.) and assessed:
- **Covered by existing rule?** — validates that rule's relevance
- **Actionable but no rule?** — candidate for rule discovery (appended to `data/discovery-evidence.json`)
- **Rendering artifact?** — not actionable (font smoothing, anti-aliasing, retina/DPI)

Gap data is also saved per run in `logs/calibration/*/gaps.json`.

---

## Rule Discovery Pipeline

New rules are added through a 6-agent pipeline (`/add-rule`). See [CALIBRATION-PLAYBOOK.md](./CALIBRATION-PLAYBOOK.md) for operational details.

```bash
/add-rule "concept" fixtures/path

Step 1 — Researcher: explore fixture data + data/discovery-evidence.json
Step 2 — Designer: propose rule spec (ID, category, severity, score)
Step 3 — Implementer: write rule code + tests
Step 4 — A/B Visual Validation: implement design with/without the rule's data, compare similarity
Step 5 — Evaluator: measure impact, false positives, visual improvement
Step 6 — Critic: decide KEEP / ADJUST / DROP
```

After KEEP or ADJUST, discovery evidence for the rule's category is pruned from `data/discovery-evidence.json`.

### Known Limitations

1. **A/B validation requires AI to generate "missing" data.** For metadata rules (e.g., component descriptions), Test B needs AI-generated descriptions as proxy. This introduces noise — the comparison measures "AI-generated context" benefit, not "human-authored context" benefit.

2. **Test fixtures with both positive and negative cases needed.** Current fixtures tend to be all-or-nothing (e.g., 0% description coverage). Effective evaluation requires controlled fixtures.

3. **Font rendering differences.** Playwright uses system fonts; Figma renders with embedded fonts. This creates a baseline similarity gap (~3-5%) that is not actionable.
