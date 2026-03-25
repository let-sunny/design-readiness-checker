# Fixture analysis: validity feedback (over- vs under-estimation)

This document records **subjective engineering judgment** on whether `canicode analyze` results **oversell** or **undersell** how hard it is for an AI to implement the UI **pixel-close** from the fixture, and what to do about it.

It is **not** a statistical proof. It assumes: REST fixture JSON + current `rule-config` scoring, and the north-star metric **visual similarity**, not design-system purity alone.

---

## How to read this

| Term | Meaning here |
|------|----------------|
| **Overrated (grade/score)** | The **readiness score looks better** than the likely **implementation + visual-compare** outcome without extra context or cleanup. |
| **Underrated** | The **score looks worse** than how repeatable or implementable the file actually is for an AI (given a strong prompt / repeated patterns). |

**Remedies** split into: **Figma / fixture hygiene**, **prompt & workflow**, **tooling (rules, scoring, scope)**.

---

## Cross-cutting patterns

### A. Invisible layers + raw color clusters (many Simple DS fixtures)

- **Overrated:** Overall **grade can look decent (A / high B)** while the tree still carries many **unnecessary-node** and **raw-color** hits. Severity may keep the headline grade up, but the AI still sees **noise** (extra nodes, ambiguous fills) and may **mis-order or mis-style** visible content. **Pixel outcome** can be worse than the letter grade suggests.
- **Underrated:** Rare for the **same** pattern; occasionally invisible only affects editor hygiene, not export — but REST + rules still complain.
- **Remedies:**
  - **Figma:** Delete or detach truly unused layers; replace raw values with variables where the team cares; reduce hidden decoration.
  - **Workflow:** Feed **`design-tree`** or a **pruned node list** to the AI so it ignores known-noise IDs.
  - **Tooling:** Consider reporting **“visible-only issues”** aggregate for AI-facing summaries; tune `unnecessary-node` / `raw-color` weights after calibration for “impact on visual-compare.”

### B. Unscoped large trees (Material 3 & large Simple DS)

- **Overrated:** **Low grades (C, B)** can look like “this file is terrible to implement” when the real problem is **scope** — mixing many screens/components in one graph. A single scoped frame might be **B+ or A** in isolation.
- **Underrated:** Almost the inverse: **one bad subtree** can dominate issue counts; the rest of the file might be fine — the **average** undervalues “good parts.”
- **Remedies:**
  - **Fixture:** Re-`save-fixture` with a **single `node-id`** per calibration / AI task.
  - **CLI:** Always analyze with the **same scope** you ask the AI to implement.
  - **Tooling:** Surface **root-scoped score** vs **whole-file score** in reports when unscoped.

### C. Design-system spacing / fixed-width spam (`material3-52949-27916`, `material3-51954-18254`)

- **Overrated:** Less common; if spacing issues are **systematic**, fixing one pattern fixes hundreds — headline pain can be **overstated** for a **template-aware** AI.
- **Underrated:** **Underrated for “first-try” AI** without a grid spec — hundred of **inconsistent-spacing** / **fixed-width** hits mean **lots of opportunity for pixel drift**; visual-compare will punish. Score may feel “only B” but failure modes are many.
- **Remedies:**
  - **Prompt:** State **grid base (e.g. 4px)**, max width, breakpoint behavior explicitly.
  - **Figma:** Normalize spacing to the grid; reduce fixed widths or mark responsive intent.
  - **Tooling:** Calibration tied to **visual-compare** on these fixtures so spacing rules track **pixel deltas**.

### D. Numeric / generic naming (Material 3 community)

- **Overrated:** Score can look **OK on layout** while **structure / naming** tanks — sometimes **underweighted** in how much it confuses **less capable** models (variable names, component names in code).
- **Underrated:** For **vision-heavy** codegen (screenshot + structure), **bad names** matter less — score may **undersell** “actually buildable if you ignore names.”
- **Remedies:**
  - **Figma:** Rename critical interactive nodes; keep DS naming convention.
  - **Prompt:** “Map Figma node IDs to React components; names are not authoritative.”
  - **Tooling:** Separate **“semantic naming score”** from **implementation difficulty** in user-facing copy.

### E. `figma-ui3-kit` (token category very weak, few nodes)

- **Overrated:** **Overall B** might **overstate** readiness: **token ~21%** means heavy **raw-color/raw-font** — first **visual-compare** often fails on **font and fill** unless explicitly mocked.
- **Underrated:** Small **node count** — fast iteration; score may **feel harsh** vs effort to **manually** match a tiny scope.
- **Remedies:**
  - **Workflow:** Predeclare **font stack** and **color substitution** in the prompt to absorb raw-font/raw-color.
  - **Tooling:** Optional “**compare mode: ignore typography**” (dangerous but documented) for layout-only checks.

---

## Per-fixture notes (snapshot-oriented)

Names refer to directories under `fixtures/` or `fixtures/done/`. Grades refer to the last batch analyze (v0.8.9); re-run after config changes.

### `done/simple-ds-page-sections` — A (86%)

- **Overrated:** **Token/component** weakness (raw color, missing descriptions, invisible layers) is **under-reflected** in a single letter “A” for **naive** AI codegen without DS context.
- **Underrated:** **Small, shallow tree** — easier to reason about than bulk Simple DS fixtures; score is not “too kind” to structure.
- **Remedies:** Add **component description** stub in prompt; clean invisible layers; run **visual-compare** once to validate the A.

### `material3-56615-45927` — C+ (72%), large unscoped

- **Overrated:** Unlikely at file level — **C+** already warns; per-frame might be better.
- **Underrated:** Possible if user only implements **one** repeated component — issue count is **file-wide**.
- **Remedies:** **Mandatory scoping**; treat as multiple fixtures.

### `simple-ds-175-9106` / `175-8591` / `175-7790` / `562-9518` — B ~ B+

- **Overrated:** **raw-color + unnecessary-node** volume — **B/B+** may **overrate** first-shot pixel match.
- **Underrated:** **Detach/instance** and **default-name** sometimes fixable with a strong “use Figma structure as source of truth” prompt.
- **Remedies:** Scope; variable cleanup; explicit **instance** handling in prompt.

### `simple-ds-4333-9262` — A (89%)

- **Overrated:** Still **missing-component-description** and spacing — “A” is **fragile** for **fully autonomous** AI without extra text context.
- **Underrated:** Among the **cleaner** Simple DS slices — good **golden** candidate; score may be **fair or slightly harsh** if issues are mostly doc/metadata.
- **Remedies:** Use as **benchmark**; add descriptions only if product needs them for handoff.

### `material3-52949-27916` — B (79%), 400+ issues

- **Overrated:** Whole-file **B** might **overrate** “one-shot implement whole thing.”
- **Underrated:** For **systematic** spacing tokens, a **macro prompt** might achieve **ok** similarity on repetitive regions — composite grade **undersells** repeatability.
- **Remedies:** Split fixture; calibrate spacing rules on **scoped** chunks.

### `done/simple-ds-panel-sections` — A (87%)

- **Overrated:** Same invisible/raw-color cluster as other Simple DS **done** sets — **A** vs **pixel** needs verification.
- **Underrated:** Low depth, moderate issues — reasonable **hand-implement** cost.

### `material3-51954-18254` — B+ (82%), spacing-dominated

- **Overrated:** Low probability — issue profile is **honest** about layout math risk.
- **Underrated:** If the AI is given **explicit spacing table** extracted once from Figma, difficulty drops **faster** than score implies.
- **Remedies:** Export **spacing tokens** or measurement table alongside `data.json`.

### `done/material3-kit-2` — B+ (81%)

- **Overrated:** **deep-nesting + sibling direction** — **B+** might **overrate** “drop in one prompt” success for junior models.
- **Underrated:** **Narrow node count** (96) — less overwhelming than `82356`.
- **Remedies:** Refactor nesting in Figma for handoff; or implement **section-by-section**.

### `material3-56615-82356` — C (66%)

- **Overrated:** Rare — **C** is already blunt.
- **Underrated:** If scoped to **one** leaf screen, local grade might be **much higher** — file-level **undersells** localized quality.
- **Remedies:** **Never** use as single-scope “implement all”; split into **10+** scoped fixtures.

### `done/material3-kit-1` — A (85%)

- **Overrated:** **Still mixed token/naming/invisible** — **A** is strong; verify with **visual-compare** for **stock** AI.
- **Underrated:** Mature kit — **repeatable patterns** help experienced prompts.
- **Remedies:** Keep as **positive** control next to `kit-2` / `82356`.

### `done/simple-ds-card-grid` — B+ (80%)

- **Overrated:** **Component/naming** weak — **B+** may **overrate** grid+card **pixel** parity without layout hints.
- **Underrated:** **Calibration history** — score may be **well tuned** for this file; trust **relative** more than absolute.
- **Remedies:** Explicit **grid columns/gap** in prompt.

### `done/figma-ui3-kit` — B (76%), token floor

- **Overrated:** **Overall B** with **token 21%** — **readiness for unguided AI** is **overrated** unless fonts/colors are specified in prompt.
- **Underrated:** **20 nodes** — absolute work is small; grade **undersells** “quick human polish.”
- **Remedies:** Font and color contract in README for this fixture; optional webfont load in generated HTML.

---

## Raising “validity” of the metric (product direction)

1. **Always pair** headline grade with **visual-compare** (or explicit “not run”) on the **same scoped node**.
2. **Publish** whether the run was **scoped** and **node count** in JSON (provenance) — avoids comparing whole-file vs framed scores.
3. **Calibrate** rule weights using **pixel delta categories**, not issue count alone — reduces **over/under** gap for AI use cases.
4. **Two summaries** in reports: **“handoff / DS hygiene”** vs **“likely first visual-compare (AI)”** — can diverge.

---

## Revision

Re-evaluate after major `rule-config` or rule-set changes; per-fixture grades will move.
