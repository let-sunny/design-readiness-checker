# Calibration & Rule Discovery Playbook

How to run calibration, review results, and discover new rules. For technical details on the pipeline architecture, see [CALIBRATION.md](./CALIBRATION.md).

---

## 1. Fixture Preparation

Save Figma designs as local JSON fixtures for offline analysis:

```bash
npx canicode save-fixture "https://www.figma.com/design/ABC123/MyDesign?node-id=1-234"
# → fixtures/ABC123/
#     ├── data.json          (node tree + sourceUrl)
#     ├── screenshot.png     (Figma screenshot)
#     └── vectors/           (SVG exports)
```

- One fixture = one scoped section or page (not a full file)
- Add `?node-id=` to scope to a specific section
- Fixture directories in `fixtures/` are active; converged ones get moved to `fixtures/done/`

---

## 2. Single Calibration Run

```
/calibrate-loop fixtures/material3-kit-1
```

### What happens

| Step | Agent | Output | Description |
|------|-------|--------|-------------|
| 0 | Orchestrator | Run directory created | `logs/calibration/<name>--<timestamp>/` |
| 1 | CLI | `analysis.json` | Rule analysis — which rules flagged what |
| 2 | Converter | `output.html`, `figma.png`, `code.png`, `diff.png`, `conversion.json` | Implements the entire design as HTML, runs visual-compare |
| 3 | Gap Analyzer | `gaps.json` | Categorizes pixel differences, appends uncovered gaps to `data/discovery-evidence.json` |
| 4 | Evaluator | `summary.md` | Score vs actual impact comparison, appends to `data/calibration-evidence.json` |
| 5 | Critic | `debate.json` | Reviews proposals: APPROVE / REJECT / REVISE |
| 6 | Arbitrator | `debate.json` (appended), `rule-config.ts` | Makes final decisions, applies approved changes, commits, prunes evidence |

### What you see

```
Arbitrator result:
  applied=2: raw-color (-10 → -7), inconsistent-spacing (-8 → -6)
  rejected=1: missing-token (insufficient evidence)
```

### Your decision

None — fully automatic. Review the commit if you want.

---

## 3. Nightly Calibration (Multiple Fixtures)

### In Claude Code

```bash
/calibrate-night fixtures/
```

Input: fixture directory path. Auto-discovers active fixtures (`fixtures/*/data.json`).

### What happens

```
Scan fixtures/*/data.json → 6 active fixtures found

[1/6] fixtures/material3-kit-1    — Complete (applied=2)
[2/6] fixtures/material3-kit-2    — Complete (applied=0, converged)
  → moved to fixtures/done/
[3/6] fixtures/simple-ds-card-grid — Complete (applied=1)
[4/6] fixtures/simple-ds-page     — Complete (applied=0, converged)
  → moved to fixtures/done/
[5/6] fixtures/simple-ds-panel    — Failed (timeout)
[6/6] fixtures/figma-ui3-kit      — Complete (applied=3)

Phase 2: logs/calibration/REPORT.md generated
```

- `applied=0` means the fixture has converged (scores are stable) → moved to `fixtures/done/`
- Next run automatically skips converged fixtures
- To re-calibrate a converged fixture, move it back from `fixtures/done/` to `fixtures/`

---

## 4. Reviewing the Report

Open `logs/calibration/REPORT.md` the next morning. Key sections:

| Section | What to look for | Action |
|---------|-----------------|--------|
| **Similarity per run** | Low similarity = hard design | Consider adding more rules for that pattern |
| **Repeating patterns** | Same gap in 3+ fixtures | Strong candidate for `/add-rule` |
| **Rule score vs impact** | Overscored (penalty too harsh) or underscored (penalty too mild) | Score will auto-adjust in next calibration |
| **New rule candidates** | `text-alignment-mismatch` in 4/6 | Run `/add-rule` |
| **Never flagged rules** | Rule never triggered | Consider `enabled: false` in `rule-config.ts` |

### Decisions you make

- **"This pattern should be a rule"** → Go to Step 5 (Rule Discovery)
- **"This rule is overscored"** → Next nightly will auto-adjust, or manually edit `rule-config.ts`
- **"This rule never fires"** → Set `enabled: false` in `rule-config.ts`

---

## 5. Rule Discovery

When the report identifies a new pattern worth codifying:

```
/add-rule "text-alignment-mismatch" fixtures/material3-kit-1
```

### What happens

| Step | Agent | Output | Description |
|------|-------|--------|-------------|
| 0 | Orchestrator | Run directory | `logs/rule-discovery/<concept>--<date>/` |
| 1 | Researcher | `research.json` | Checks fixture data + `data/discovery-evidence.json` for recurring patterns |
| 2 | Designer | `design.json` | Proposes rule spec: ID, category, severity, score, trigger logic |
| 3 | Implementer | Source code | Writes rule code + tests, builds |
| 4 | Orchestrator | `visual-a.html`, `visual-b.html` | A/B test: implements design with/without the rule's data, compares pixel similarity |
| 5 | Evaluator | `evaluation.json` | Measures false positive rate, visual improvement |
| 6 | Critic | `decision.json` | Final verdict |

### Possible outcomes

| Decision | Meaning | What happens |
|----------|---------|-------------|
| **KEEP** | Rule is valuable | Auto-committed: `feat: add rule <id>` |
| **ADJUST** | Good idea, tweak needed | Score/severity adjusted, then committed |
| **DROP** | Not worth it | All source changes reverted |

### Early stops

- **Researcher says not feasible** → Pipeline stops at Step 1
- **Build/test fails** → Implementer attempts fix; if can't, pipeline stops
- **A/B shows no improvement** → Evaluator likely recommends DROP

### Evidence pruning

After KEEP or ADJUST, discovery evidence for the rule's category is pruned from `data/discovery-evidence.json`. This prevents the same pattern from being proposed again.

### Your decision

None during execution — fully automatic. After completion:
- If KEEP/ADJUST: review the commit, revert if you disagree
- If DROP: nothing to do, code was already reverted

---

## 6. Inspecting a Run

Every run is a self-contained directory. Open it to see everything:

```bash
ls logs/calibration/material3-kit-1--2026-03-24-0800/
```

```
analysis.json       # Which rules flagged what
conversion.json     # Conversion result + similarity score
output.html         # Generated HTML (open in browser)
design-tree.txt     # Design tree used for conversion
figma.png           # Original Figma screenshot
code.png            # AI-generated code screenshot
diff.png            # Pixel diff (red = differences)
gaps.json           # Why differences exist, categorized
debate.json         # Critic + Arbitrator decisions
activity.jsonl      # Step-by-step timeline with durations
summary.md          # Human-readable summary
```

For rule discovery:

```bash
ls logs/rule-discovery/text-alignment-mismatch--2026-03-25/
```

```
research.json       # Researcher findings
design.json         # Rule specification
evaluation.json     # Test results + verdict
decision.json       # Critic's KEEP/ADJUST/DROP
activity.jsonl      # Timeline
summary.md          # Human-readable summary
```

---

## 7. Full Cycle

```
 Prepare fixtures (save-fixture)
         ↓
 Nightly (/calibrate-night) ←────────────────┐
   scan fixtures/*/data.json                       │
   run /calibrate-loop per fixture            │
   converged → fixtures/done/                 │
   generate REPORT.md                         │
         ↓                                    │
 Morning review (REPORT.md)                   │
   repeating gaps → new rule candidates       │
   overscored rules → auto-adjusted next run  │
   never-flagged → disable manually           │
         ↓                                    │
 Rule discovery (/add-rule)                   │
   6-agent pipeline                           │
   KEEP / ADJUST / DROP                       │
         ↓                                    │
 New rule included in next calibration ───────┘
```
