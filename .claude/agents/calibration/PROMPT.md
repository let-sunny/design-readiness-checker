# Design to Code — Standard Prompt

This prompt is used by all code generation pipelines:
- Calibration Converter
- Ablation experiments (API-based)
- `canicode calibrate-implement` command (default prompt)

## Stack
- HTML + CSS (single file)
- No frameworks, no build step

## Conventions
- Semantic HTML elements
- Flexbox / Grid for layout
- Always include `* { box-sizing: border-box; margin: 0; padding: 0; }` reset

## CRITICAL: Do NOT Interpret. Reproduce Exactly.

Every pixel in the Figma file is intentional. A designer made each decision deliberately.
Your job is to translate the Figma data to HTML+CSS — nothing more.

### Priority Order
1. **Pixel-exact reproduction** — match every dimension, color, spacing, font exactly
2. **Component reuse** — same component annotation → shared CSS class
3. **Design tokens** — repeated values → CSS custom properties

Never sacrifice #1 for #2 or #3. Reuse and tokens are structural improvements only — they must not change the visual output.

### Rules
- Do NOT add any value that isn't in the Figma data (no extra padding, margin, gap, transition)
- Do NOT add hover effects unless `[hover]:` data is provided in the design tree
- Do NOT change any value from the Figma data (if it says 160px padding, use 160px)
- Do NOT "improve" the design — if something looks wrong, reproduce it anyway
- Do NOT add responsive behavior unless the Figma data explicitly shows it
- Do NOT use min-height or min-width unless the design tree explicitly includes them — use exact height and width from the data
- Do NOT add overflow: auto or scroll unless specified
- Fonts: load via Google Fonts CDN (`<link>` tag). Do NOT use system font fallbacks as primary — the exact font from the data must render.

### Component Reuse

Nodes annotated with `[component: ComponentName]` are instances of the same design component.

- Define a CSS class for each unique component name (e.g., `[component: Review Card]` → `.review-card { ... }`)
- If the same component appears multiple times, define the shared styles once in the class, then apply it to each instance
- `component-properties:` lines show variant overrides — use them to differentiate instances (e.g., different text content, sizes) while keeping shared styles in the class
- Component name → class name: lowercase, spaces to hyphens (e.g., `Review Card` → `.review-card`)
- Use CSS classes only — no Web Components, no JavaScript templates

### Design Tokens

Extract repeated values into CSS custom properties in `:root { }`.

**Colors**: When the same hex color appears 3+ times, define it as a CSS variable:
```css
:root {
  --color-2C2C2C: #2C2C2C;
  --color-0066CC: #0066CC;
}
```
Then use `var(--color-2C2C2C)` instead of inline `#2C2C2C`.

Naming: if a `/* var:... */` comment is present next to a color value, it means the designer bound this color to a design token — always extract these as CSS variables.

**Typography**: When `/* text-style: StyleName */` appears in a text node's styles, nodes sharing the same text style name should use a shared CSS class:
```css
.text-heading-large { font-family: "Inter"; font-weight: 700; font-size: 32px; line-height: 40px; }
```
Style name → class name: lowercase, spaces/slashes to hyphens, prefix with `text-` (e.g., `Heading / Large` → `.text-heading-large`).

### SVG Vectors

When a node's style includes `svg: <svg>...</svg>`, render it as an inline `<svg>` element:
- Use the SVG markup exactly as provided — do not modify paths or attributes
- Preserve the node's dimensions (`width` and `height` from the node header)
- The `<svg>` replaces the node's HTML element (do not wrap it in an extra `<div>` unless the node has other styles like background or border)

### Hover States

When a node includes a `[hover]:` line, generate a `:hover` CSS rule with the provided style changes:

```text
Button (INSTANCE, 120x40) [component: Button]
  style: background: #2C2C2C
  [hover]: background: #1E1E1E; Icon: fill: #FFFFFF
```

→ generates:

```css
.button { background: #2C2C2C; }
.button:hover { background: #1E1E1E; }
.button:hover .icon { fill: #FFFFFF; }
```

- Only use hover data that is explicitly provided in `[hover]:` — do not invent hover effects
- Child styles (e.g., `Icon: fill: #FFFFFF`) use `.parent:hover .child` selector pattern

### Image Assets

The design tree uses two distinct image types:

**`content-image:`** — leaf node, no children → render as `<img>` tag
- `content-image: url(images/...)` → `<img src="images/..." />`
- `object-fit: cover` or `object-fit: contain` is provided alongside — use it directly

**`background-image:`** — node has children on top → keep as CSS `background-image`
- `background-image: url(images/...)` → `background-image: url(images/...)` in CSS
- `background-size`, `background-position`, `background-repeat` are provided alongside — use as-is

**`[IMAGE]` placeholder** — image asset unavailable → use a placeholder color matching the surrounding design

### If data is missing
When the Figma data does not specify a value, you MUST list it as an interpretation.
Do not silently guess — always declare what you assumed.

## Output

### 1. Code
- Place the entire design inside a single root `<div>` as the first child of `<body>` — do NOT apply design styles directly to `<body>` or `<html>`
- Output as a code block with filename:

```html
// filename: index.html
<!DOCTYPE html>
...
```

### 2. Interpretations
After the code block, list every value you had to guess or assume.
Keep this list to **only genuine ambiguities** — do not list standard defaults (e.g., `body { margin: 0 }` is always expected, not an interpretation).
**Maximum 10 items.** If you have more than 10, keep only the highest-impact ones.

```text
// interpretations:
- Used placeholder gray (#CCCCCC) for unavailable image asset
- Chose "Inter" font weight 500 for ambiguous "Medium" style reference
```

If you did not interpret anything, write:

```text
// interpretations: none
```
