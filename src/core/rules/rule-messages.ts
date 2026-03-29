/**
 * Centralized rule violation messages.
 * All message text lives here so CLI, web, plugin, and MCP share the same strings.
 */

// ── Sub-type definitions ─────────────────────────────────────────────────────

export type RawValueSubType = "color" | "font" | "shadow" | "opacity" | "spacing";
export type NoAutoLayoutSubType = "overlapping" | "nested" | "basic";
export type FixedSizeSubType = "both-axes" | "horizontal";
export type MissingComponentSubType = "unused-component" | "name-repetition" | "structure-repetition" | "style-override";

// ── raw-value ────────────────────────────────────────────────────────────────

export const rawValueMsg = {
  color: (name: string, hex: string) =>
    `"${name}" uses raw fill color ${hex} without style or variable — bind to a color token`,
  font: (name: string, fontDesc: string) =>
    `"${name}" uses raw font${fontDesc} without text style — apply a text style`,
  shadow: (name: string, shadowType: string, details: string) =>
    `"${name}" has ${shadowType}${details} without effect style — apply an effect style`,
  opacity: (name: string, pct: number) =>
    `"${name}" uses raw opacity (${pct}%) without a variable binding — bind opacity to a variable`,
  spacing: (name: string, label: string, value: number) =>
    `"${name}" uses raw ${label} (${value}px) without a variable binding — bind spacing to a variable`,
};

// ── irregular-spacing ────────────────────────────────────────────────────────

export type IrregularSpacingSubType = "padding" | "gap";

export const irregularSpacingMsg = (name: string, spacing: number, gridBase: number, nearest: number) =>
  `"${name}" has spacing ${spacing}px not on ${gridBase}pt grid — round to nearest ${gridBase}pt multiple (${nearest}px)`;

// ── no-auto-layout ───────────────────────────────────────────────────────────

export const noAutoLayoutMsg = {
  overlapping: (name: string) =>
    `"${name}" has overlapping children without Auto Layout — apply auto-layout to separate overlapping children`,
  nested: (name: string) =>
    `"${name}" has nested containers without layout hints — apply auto-layout to organize nested containers`,
  basic: (name: string, arrangement: string, directionHint: string) =>
    `Frame "${name}" has no auto-layout${arrangement}${directionHint ? ` — apply ${directionHint} auto-layout` : " — apply auto-layout"}`,
};

// ── absolute-position-in-auto-layout ─────────────────────────────────────────

export const absolutePositionMsg = (name: string, parentName: string) =>
  `"${name}" uses absolute positioning inside Auto Layout parent "${parentName}" — remove absolute positioning or restructure outside the auto-layout parent`;

// ── fixed-size-in-auto-layout ────────────────────────────────────────────────

export const fixedSizeMsg = {
  bothAxes: (name: string, width: number, height: number) =>
    `Container "${name}" (${width}×${height}) uses fixed size on both axes inside auto-layout — set at least one axis to HUG or FILL`,
  horizontal: (name: string, width: number) =>
    `"${name}" has fixed width (${width}px) inside auto-layout — set horizontal sizing to FILL`,
};

// ── missing-size-constraint ──────────────────────────────────────────────────

export type MissingSizeConstraintSubType = "max-width" | "min-width" | "wrap" | "grid";

export const missingSizeConstraintMsg = {
  maxWidth: (name: string, currentWidth: string) =>
    `"${name}" uses FILL width (currently ${currentWidth}) without max-width — add maxWidth to prevent stretching on large screens`,
  minWidth: (name: string, currentWidth: string) =>
    `"${name}" uses FILL width (currently ${currentWidth}) without min-width — add minWidth to prevent collapsing on small screens`,
  wrap: (name: string) =>
    `"${name}" is in a wrap container without min-width — add minWidth to control when wrapping occurs`,
  grid: (name: string) =>
    `"${name}" is in a grid layout without size constraints — add min/max-width for proper column sizing`,
};

// ── non-layout-container (was group-usage) ───────────────────────────────────

export type NonLayoutContainerSubType = "group" | "section";

export const nonLayoutContainerMsg = {
  group: (name: string) =>
    `"${name}" is a Group — convert to Frame and apply auto-layout`,
  section: (name: string) =>
    `"${name}" is a Section used as layout container — convert to Frame and apply auto-layout`,
};

// ── deep-nesting ─────────────────────────────────────────────────────────────

export const deepNestingMsg = (name: string, depth: number, maxDepth: number) =>
  `"${name}" is nested ${depth} levels deep within its component (max: ${maxDepth}) — extract into a sub-component to reduce depth`;

// ── missing-component ────────────────────────────────────────────────────────

export const missingComponentMsg = {
  unusedComponent: (componentName: string, count: number) =>
    `Component "${componentName}" exists — use instances instead of repeated frames (${count} found) — replace frames with component instances`,
  nameRepetition: (name: string, count: number) =>
    `"${name}" appears ${count} times — extract as a reusable component`,
  structureRepetition: (name: string, siblingCount: number) =>
    `"${name}" and ${siblingCount} sibling frame(s) share the same internal structure — extract a shared component from the repeated structure`,
  styleOverride: (componentName: string, overrides: string[]) =>
    `"${componentName}" instance has style overrides (${overrides.join(", ")}) — create a new variant for this style combination`,
};

// ── detached-instance ────────────────────────────────────────────────────────

export const detachedInstanceMsg = (name: string, componentName: string) =>
  `"${name}" may be a detached instance of component "${componentName}" — restore as an instance of "${componentName}" or create a new variant`;

// ── variant-structure-mismatch ───────────────────────────────────────────────

export const variantStructureMismatchMsg = (name: string, mismatchCount: number, totalVariants: number) =>
  `"${name}" has ${mismatchCount}/${totalVariants} variants with different child structures — unify variant structures using visibility toggles for optional elements`;

// ── default-name ─────────────────────────────────────────────────────────────

export type DefaultNameSubType = "frame" | "group" | "vector" | "shape" | "text" | "image" | "component" | "instance";

const DEFAULT_NAME_SUBTYPE_MAP: Record<string, DefaultNameSubType> = {
  FRAME: "frame",
  GROUP: "group",
  RECTANGLE: "shape",
  ELLIPSE: "shape",
  VECTOR: "vector",
  LINE: "vector",
  STAR: "shape",
  REGULAR_POLYGON: "shape",
  TEXT: "text",
  IMAGE: "image",
  COMPONENT: "component",
  COMPONENT_SET: "component",
  INSTANCE: "instance",
};

export function getDefaultNameSubType(nodeType: string): DefaultNameSubType {
  return DEFAULT_NAME_SUBTYPE_MAP[nodeType] ?? "frame";
}

export const defaultNameMsg = (type: string, name: string) =>
  `${type} "${name}" has a default name — rename to describe its purpose (e.g., "Header", "ProductCard")`;

// ── non-semantic-name ────────────────────────────────────────────────────────

export const nonSemanticNameMsg = (type: string, name: string) =>
  `${type} "${name}" is a non-semantic name — rename to describe its role (e.g., "Divider", "Background")`;

// ── missing-interaction-state ─────────────────────────────────────────────────

export type MissingInteractionStateSubType = "hover" | "disabled" | "active" | "focus";

export const missingInteractionStateMsg = {
  hover: (name: string) =>
    `"${name}" looks interactive but has no Hover state variant — add a State=Hover variant`,
  disabled: (name: string) =>
    `"${name}" looks interactive but has no Disabled state variant — add a State=Disabled variant`,
  active: (name: string) =>
    `"${name}" looks interactive but has no Active state variant — add a State=Active variant`,
  focus: (name: string) =>
    `"${name}" looks interactive but has no Focus state variant — add a State=Focus variant`,
};

// ── missing-prototype ─────────────────────────────────────────────────────────

export type MissingPrototypeSubType = "navigation" | "tab" | "dropdown";

export const missingPrototypeMsg = {
  navigation: (name: string) =>
    `"${name}" looks like a navigation link but has no click prototype — add an ON_CLICK interaction to define the destination`,
  tab: (name: string) =>
    `"${name}" looks like a tab but has no click prototype — add an ON_CLICK interaction to define tab switching behavior`,
  dropdown: (name: string) =>
    `"${name}" looks like a dropdown but has no click prototype — add an ON_CLICK interaction to define open/close behavior`,
};

// ── inconsistent-naming-convention ───────────────────────────────────────────

export const inconsistentNamingMsg = (name: string, nodeConvention: string, dominantConvention: string) =>
  `"${name}" uses ${nodeConvention} while siblings use ${dominantConvention} — rename to match ${dominantConvention} convention`;
