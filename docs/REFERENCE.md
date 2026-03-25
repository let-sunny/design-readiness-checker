# Customization Guide

CanICode supports two types of customization:

1. **Config overrides** — adjust scores, severity, and node exclusions
2. **Custom rules** — add project-specific checks

---

## Config Overrides

Override built-in rule scores, severity, and filter settings with a JSON file.

```bash
canicode analyze <url> --config ./my-config.json
```

### Full Schema

```json
{
  "excludeNodeTypes": ["VECTOR", "BOOLEAN_OPERATION", "SLICE"],
  "excludeNodeNames": ["chatbot", "ad-banner", "custom-widget"],
  "gridBase": 4,
  "colorTolerance": 5,
  "rules": {
    "no-auto-layout": { "score": -15, "severity": "blocking", "enabled": true },
    "raw-color": { "score": -12 },
    "default-name": { "enabled": false }
  }
}
```

### Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `excludeNodeTypes` | `string[]` | `[]` | Figma node types to skip entirely (node + children) |
| `excludeNodeNames` | `string[]` | `[]` | Name patterns to skip (case-insensitive word match) |
| `gridBase` | `number` | `4` | Spacing grid unit for `inconsistent-spacing` and `magic-number-spacing` |
| `colorTolerance` | `number` | `10` | Color difference tolerance for `multiple-fill-colors` |
| `rules` | `object` | — | Per-rule overrides (see below) |

### Node Exclusions

**`excludeNodeNames`** — Nodes whose name contains any of these words (case-insensitive) will be skipped entirely. The node and all its children are excluded from analysis.

```json
{
  "excludeNodeNames": ["chatbot", "floating-cta", "ad-banner", "legacy"]
}
```

This matches word boundaries, so `"nav"` matches `"Nav Bar"` and `"bottom-nav"` but not `"unavailable"`.

**Built-in exclusions** (always active for conversion candidates):
`icon`, `ico`, `badge`, `indicator`, `image`, `asset`, `chatbot`, `cta`, `gnb`, `navigation`, `nav`, `fab`, `modal`, `dialog`, `popup`, `overlay`, `toast`, `snackbar`, `tooltip`, `dropdown`, `menu`, `sticky`, `bg`, `background`, `divider`, `separator`, `logo`, `avatar`, `thumbnail`, `thumb`, `header`, `footer`, `sidebar`, `toolbar`, `tabbar`, `tab-bar`, `statusbar`, `status-bar`, `spinner`, `loader`, `cursor`, `dot`, `dim`, `dimmed`, `filter`

**`excludeNodeTypes`** — Figma node types to skip.

```json
{
  "excludeNodeTypes": ["VECTOR", "BOOLEAN_OPERATION", "SLICE", "STICKY"]
}
```

Available types: `DOCUMENT`, `CANVAS`, `FRAME`, `GROUP`, `SECTION`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `RECTANGLE`, `ELLIPSE`, `VECTOR`, `TEXT`, `LINE`, `BOOLEAN_OPERATION`, `STAR`, `REGULAR_POLYGON`, `SLICE`, `STICKY`, `TABLE`, `TABLE_CELL`

### Per-Rule Overrides

Override score, severity, or enable/disable individual rules:

```json
{
  "rules": {
    "no-auto-layout": {
      "score": -15,
      "severity": "blocking"
    },
    "default-name": {
      "enabled": false
    }
  }
}
```

| Property | Type | Description |
|----------|------|-------------|
| `score` | `number` (≤ 0) | Penalty score (more negative = harsher) |
| `severity` | `string` | `"blocking"`, `"risk"`, `"missing-info"`, or `"suggestion"` |
| `enabled` | `boolean` | Set `false` to disable the rule |

### All Rule IDs

**Structure (9 rules)**

| Rule ID | Default Score | Default Severity |
|---------|--------------|-----------------|
| `no-auto-layout` | -7 | blocking |
| `absolute-position-in-auto-layout` | -10 | blocking |
| `missing-responsive-behavior` | -4 | risk |
| `group-usage` | -5 | risk |
| `fixed-size-in-auto-layout` | -5 | risk |
| `missing-size-constraint` | -5 | risk |
| `unnecessary-node` | -2 | suggestion |
| `z-index-dependent-layout` | -5 | risk |
| `deep-nesting` | -4 | risk |

**Token (7 rules)**

| Rule ID | Default Score | Default Severity |
|---------|--------------|-----------------|
| `raw-color` | -2 | missing-info |
| `raw-font` | -8 | blocking |
| `inconsistent-spacing` | -2 | missing-info |
| `magic-number-spacing` | -3 | missing-info |
| `raw-shadow` | -7 | risk |
| `raw-opacity` | -5 | risk |
| `multiple-fill-colors` | -3 | missing-info |

**Component (4 rules)**

| Rule ID | Default Score | Default Severity |
|---------|--------------|-----------------|
| `missing-component` | -7 | risk |
| `detached-instance` | -5 | risk |
| `missing-component-description` | -2 | missing-info |
| `variant-structure-mismatch` | -4 | risk |

**Naming (5 rules)**

| Rule ID | Default Score | Default Severity |
|---------|--------------|-----------------|
| `default-name` | -2 | missing-info |
| `non-semantic-name` | -2 | missing-info |
| `inconsistent-naming-convention` | -2 | missing-info |
| `numeric-suffix-name` | -2 | missing-info |
| `too-long-name` | -1 | suggestion |

**Behavior (4 rules)**

| Rule ID | Default Score | Default Severity |
|---------|--------------|-----------------|
| `text-truncation-unhandled` | -5 | risk |
| `prototype-link-in-design` | -2 | missing-info |
| `overflow-behavior-unknown` | -3 | missing-info |
| `wrap-behavior-unknown` | -3 | missing-info |

### Example Configs

**Strict (for production-ready designs):**
```json
{
  "rules": {
    "no-auto-layout": { "score": -15 },
    "raw-color": { "score": -10, "severity": "blocking" },
    "default-name": { "score": -8, "severity": "blocking" }
  }
}
```

**Relaxed (for early prototypes):**
```json
{
  "excludeNodeNames": ["prototype", "wip", "draft", "temp"],
  "rules": {
    "default-name": { "enabled": false },
    "non-semantic-name": { "enabled": false },
    "missing-component": { "severity": "suggestion" }
  }
}
```

**Mobile-first (focus on structure):**

```json
{
  "rules": {
    "missing-responsive-behavior": { "score": -10, "severity": "blocking" },
    "fixed-size-in-auto-layout": { "score": -8, "severity": "blocking" },
    "no-auto-layout": { "score": -12 }
  }
}
```


---

## Custom Rules

Add project-specific checks using declarative pattern matching. Custom rules evaluate conditions against each Figma node and flag violations when ALL conditions match.

```bash
canicode analyze <url> --custom-rules ./my-rules.json
```

### Rule Structure

Each custom rule is a JSON object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | `string` | Yes | Unique rule identifier (kebab-case recommended) |
| `category` | `string` | Yes | One of: `structure`, `token`, `component`, `naming`, `behavior` |
| `severity` | `string` | Yes | One of: `blocking`, `risk`, `missing-info`, `suggestion` |
| `score` | `number` | Yes | Penalty score (integer, must be <= 0) |
| `match` | `object` | Yes | Conditions to evaluate (see below) |
| `message` | `string` | No | Custom message template. Supports `{name}` and `{type}` placeholders |
| `why` | `string` | Yes | Why this rule matters |
| `impact` | `string` | Yes | What happens if the issue is not fixed |
| `fix` | `string` | Yes | How to fix the issue |

### Match Conditions

ALL conditions in the `match` object must be satisfied for the rule to fire (AND logic). Omitted conditions are ignored (they always pass).

#### Node Type

| Condition | Type | Description |
|-----------|------|-------------|
| `type` | `string[]` | Node type must be one of these values |
| `notType` | `string[]` | Node type must NOT be one of these values |

Available node types: `FRAME`, `GROUP`, `SECTION`, `COMPONENT`, `COMPONENT_SET`, `INSTANCE`, `RECTANGLE`, `ELLIPSE`, `VECTOR`, `TEXT`, `LINE`, `BOOLEAN_OPERATION`, `STAR`, `REGULAR_POLYGON`, `SLICE`, `STICKY`, `TABLE`, `TABLE_CELL`

#### Node Name

| Condition | Type | Description |
|-----------|------|-------------|
| `nameContains` | `string` | Node name contains this substring (case-insensitive) |
| `nameNotContains` | `string` | Node name does NOT contain this substring (case-insensitive) |
| `namePattern` | `string` | Regex pattern to test against node name (case-insensitive) |

#### Size

| Condition | Type | Description |
|-----------|------|-------------|
| `minWidth` | `number` | Minimum width (node must have a bounding box) |
| `maxWidth` | `number` | Maximum width |
| `minHeight` | `number` | Minimum height |
| `maxHeight` | `number` | Maximum height |

#### Layout

| Condition | Type | Description |
|-----------|------|-------------|
| `hasAutoLayout` | `boolean` | `true` = node must have Auto Layout; `false` = must not |
| `hasChildren` | `boolean` | `true` = must have children; `false` = must not |
| `minChildren` | `number` | Minimum number of children |
| `maxChildren` | `number` | Maximum number of children |

#### Component

| Condition | Type | Description |
|-----------|------|-------------|
| `isComponent` | `boolean` | `true` = node type is COMPONENT or COMPONENT_SET |
| `isInstance` | `boolean` | `true` = node type is INSTANCE |
| `hasComponentId` | `boolean` | `true` = node has a componentId property |

#### Visibility

| Condition | Type | Description |
|-----------|------|-------------|
| `isVisible` | `boolean` | `true` = node is visible; `false` = node is hidden |

#### Style

| Condition | Type | Description |
|-----------|------|-------------|
| `hasFills` | `boolean` | `true` = node has fills; `false` = no fills |
| `hasStrokes` | `boolean` | `true` = node has strokes; `false` = no strokes |
| `hasEffects` | `boolean` | `true` = node has effects; `false` = no effects |

#### Depth

| Condition | Type | Description |
|-----------|------|-------------|
| `minDepth` | `number` | Minimum tree depth |
| `maxDepth` | `number` | Maximum tree depth |

### Examples

#### Flag icons that are not components

Small frames/groups named "icon" that should be componentized:

```json
{
  "id": "icon-not-component",
  "category": "component",
  "severity": "blocking",
  "score": -10,
  "match": {
    "type": ["FRAME", "GROUP"],
    "maxWidth": 48,
    "maxHeight": 48,
    "hasChildren": true,
    "nameContains": "icon"
  },
  "message": "\"{name}\" is an icon but not a component — should be componentized",
  "why": "Icons that are not components cannot be reused consistently across the design system.",
  "impact": "Developers will hardcode icon SVGs instead of using a shared component.",
  "fix": "Convert this icon to a component and publish it to the design system library."
}
```

#### Flag large frames without Auto Layout

Frames with many children that should have Auto Layout applied:

```json
{
  "id": "large-frame-no-auto-layout",
  "category": "structure",
  "severity": "risk",
  "score": -5,
  "match": {
    "type": ["FRAME"],
    "minWidth": 200,
    "minHeight": 200,
    "minChildren": 3,
    "hasAutoLayout": false
  },
  "message": "\"{name}\" is a large frame with {type} children but no Auto Layout",
  "why": "Large frames with multiple children should use Auto Layout for maintainability.",
  "impact": "Layout changes require manual repositioning of every child element.",
  "fix": "Apply Auto Layout with appropriate direction and spacing."
}
```

#### Flag deeply nested hidden layers

Hidden nodes buried deep in the tree that add noise:

```json
{
  "id": "deep-hidden-layer",
  "category": "structure",
  "severity": "suggestion",
  "score": -2,
  "match": {
    "isVisible": false,
    "minDepth": 4
  },
  "message": "\"{name}\" is hidden at depth {type} — consider removing it",
  "why": "Hidden layers deep in the tree add noise and confuse AI code generators.",
  "impact": "AI tools may generate unnecessary conditional rendering for hidden elements.",
  "fix": "Delete hidden layers that are no longer needed, or move them to a separate page."
}
```

#### Flag instances without component binding

Detached instances that lost their component reference:

```json
{
  "id": "detached-instance-custom",
  "category": "component",
  "severity": "risk",
  "score": -5,
  "match": {
    "isInstance": true,
    "hasComponentId": false
  },
  "message": "\"{name}\" is an INSTANCE without a component reference",
  "why": "Detached instances cannot receive updates from the source component.",
  "impact": "Design changes in the library will not propagate to this instance.",
  "fix": "Re-link this instance to its source component or convert it to a new component."
}
```

#### Flag frames with default Figma names

Frames with auto-generated names like "Frame 1", "Group 2":

```json
{
  "id": "default-frame-name",
  "category": "naming",
  "severity": "missing-info",
  "score": -2,
  "match": {
    "type": ["FRAME", "GROUP"],
    "namePattern": "^(Frame|Group|Rectangle|Ellipse)\\s\\d+$"
  },
  "message": "\"{name}\" has a default Figma name — rename it semantically",
  "why": "Default names provide no context about the element's purpose.",
  "impact": "Developers must guess what this element represents in the UI.",
  "fix": "Rename to a descriptive, semantic name (e.g., 'Header', 'Card', 'NavItem')."
}
```

### How to Write Custom Rules

Custom rules use AND logic: every condition in the `match` object must be satisfied for the rule to fire. Think of it as describing the exact node you want to catch.

**Step 1: Identify what you want to flag.** Be specific. "Small frames named icon that aren't components" is better than "bad icons."

**Step 2: Choose the right conditions.** Start with `type` to narrow down node types, then add name/size/layout conditions to refine.

**Step 3: Write the message.** Use `{name}` and `{type}` placeholders so the message is specific to each flagged node.

**Step 4: Classify severity and score.** Use `blocking` for things that prevent correct implementation, `risk` for maintainability issues, `missing-info` for missing context, and `suggestion` for nice-to-haves. Scores range from -1 (minor) to -15 (severe).

### LLM Prompt Template

Give this template to an LLM to generate rules from a natural language description:

```
I want a custom rule for CanICode that checks: [DESCRIBE WHAT TO CHECK]

Generate a JSON rule object with these fields:
- id: kebab-case identifier
- category: one of structure, token, component, naming, behavior
- severity: one of blocking, risk, missing-info, suggestion
- score: negative integer (more negative = more severe)
- match: object with conditions (ALL must match). Available conditions:
  - type/notType: array of node type strings
  - nameContains/nameNotContains: substring match (case-insensitive)
  - namePattern: regex pattern
  - minWidth/maxWidth/minHeight/maxHeight: size constraints
  - hasAutoLayout: boolean
  - hasChildren: boolean, minChildren/maxChildren: number
  - isComponent/isInstance/hasComponentId: boolean
  - isVisible: boolean
  - hasFills/hasStrokes/hasEffects: boolean
  - minDepth/maxDepth: number
- message: string with {name} and {type} placeholders
- why: why this matters
- impact: what happens if not fixed
- fix: how to fix it
```

---

## Telemetry

CanICode collects anonymous usage analytics via [PostHog](https://posthog.com) and error tracking via [Sentry](https://sentry.io). This helps improve the tool by understanding which features are used and catching errors early.

### What is tracked

- Event names only (e.g. `analysis_completed`, `cli_command`)
- Aggregate metadata: node count, issue count, grade, duration
- Error messages (stack traces for debugging)

### What is NOT tracked

- No design data, file contents, or Figma tokens
- No personally identifiable information
- No file names or URLs

### How to opt out

```bash
canicode config --no-telemetry    # disable telemetry
canicode config --telemetry       # re-enable telemetry
```

Telemetry is enabled by default. When disabled, all monitoring functions become silent no-ops.

### Dependencies

PostHog (`posthog-node`) and Sentry (`@sentry/node`) are optional peer dependencies. If they are not installed, monitoring degrades gracefully with no impact on functionality.

