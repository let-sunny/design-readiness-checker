/**
 * Centralized rule violation messages.
 * All message text lives here so CLI, web, plugin, and MCP share the same strings.
 *
 * Each message function returns { message, suggestion, guide? }:
 * - message: what's wrong (node-specific, dynamic)
 * - suggestion: how to fix it (node-specific, dynamic)
 * - guide: exemption hint (optional, when the rule auto-excludes certain cases)
 */

// ── Message return type ─────────────────────────────────────────────────────

export interface ViolationMsg {
  message: string;
  suggestion: string;
  guide?: string;
}

// ── Sub-type definitions ─────────────────────────────────────────────────────

export type RawValueSubType = "color" | "font" | "shadow" | "opacity" | "spacing";
export type NoAutoLayoutSubType = "overlapping" | "nested" | "basic";
export type FixedSizeSubType = "both-axes" | "horizontal";
export type MissingComponentSubType = "unused-component" | "name-repetition" | "structure-repetition" | "style-override";

// ── raw-value ────────────────────────────────────────────────────────────────

export const rawValueMsg = {
  color: (name: string, hex: string): ViolationMsg => ({
    message: `"${name}" uses raw fill color ${hex} without style or variable`,
    suggestion: `Bind to a color token`,
  }),
  font: (name: string, fontDesc: string): ViolationMsg => ({
    message: `"${name}" uses raw font${fontDesc} without text style`,
    suggestion: `Apply a text style`,
  }),
  shadow: (name: string, shadowType: string, details: string): ViolationMsg => ({
    message: `"${name}" has ${shadowType}${details} without effect style`,
    suggestion: `Apply an effect style`,
  }),
  opacity: (name: string, pct: number): ViolationMsg => ({
    message: `"${name}" uses raw opacity (${pct}%) without a variable binding`,
    suggestion: `Bind opacity to a variable`,
  }),
  spacing: (name: string, label: string, value: number): ViolationMsg => ({
    message: `"${name}" uses raw ${label} (${value}px) without a variable binding`,
    suggestion: `Bind spacing to a variable`,
  }),
};

// ── irregular-spacing ────────────────────────────────────────────────────────

export type IrregularSpacingSubType = "padding" | "gap";

export const irregularSpacingMsg = (name: string, spacing: number, gridBase: number, nearest: number): ViolationMsg => ({
  message: `"${name}" has spacing ${spacing}px not on ${gridBase}pt grid`,
  suggestion: `Round to nearest ${gridBase}pt multiple (${nearest}px)`,
});

// ── no-auto-layout ───────────────────────────────────────────────────────────

export const noAutoLayoutMsg = {
  overlapping: (name: string): ViolationMsg => ({
    message: `"${name}" has overlapping children without Auto Layout`,
    suggestion: `Apply auto-layout to separate overlapping children`,
    guide: `If this is an intentional overlay (e.g., badge on avatar), this can be ignored`,
  }),
  nested: (name: string): ViolationMsg => ({
    message: `"${name}" has nested containers without layout hints`,
    suggestion: `Apply auto-layout to organize nested containers`,
    guide: `Icon wrappers containing only vectors are automatically excluded`,
  }),
  basic: (name: string, arrangement: string, directionHint: string): ViolationMsg => ({
    message: `Frame "${name}" has no auto-layout${arrangement}`,
    suggestion: directionHint ? `Apply ${directionHint} auto-layout` : `Apply auto-layout`,
    guide: `Single-child wrappers and icon containers are automatically excluded`,
  }),
};

// ── absolute-position-in-auto-layout ─────────────────────────────────────────

export const absolutePositionMsg = (name: string, parentName: string): ViolationMsg => ({
  message: `"${name}" uses absolute positioning inside Auto Layout parent "${parentName}"`,
  suggestion: `Remove absolute positioning or restructure outside the auto-layout parent`,
  guide: `If this is a badge or overlay, name it with "badge", "overlay", or "icon" to auto-exclude`,
});

// ── fixed-size-in-auto-layout ────────────────────────────────────────────────

export const fixedSizeMsg = {
  bothAxes: (name: string, width: number, height: number): ViolationMsg => ({
    message: `Container "${name}" (${width}×${height}) uses fixed size on both axes inside auto-layout`,
    suggestion: `Set at least one axis to HUG or FILL`,
  }),
  horizontal: (name: string, width: number): ViolationMsg => ({
    message: `"${name}" has fixed width (${width}px) inside auto-layout`,
    suggestion: `Set horizontal sizing to FILL`,
  }),
};

// ── missing-size-constraint ──────────────────────────────────────────────────

export type MissingSizeConstraintSubType = "max-width" | "min-width" | "wrap" | "grid";

export const missingSizeConstraintMsg = {
  maxWidth: (name: string, currentWidth: string): ViolationMsg => ({
    message: `"${name}" uses FILL width (currently ${currentWidth}) without max-width`,
    suggestion: `Add maxWidth to prevent stretching on large screens`,
  }),
  minWidth: (name: string, currentWidth: string): ViolationMsg => ({
    message: `"${name}" uses FILL width (currently ${currentWidth}) without min-width`,
    suggestion: `Add minWidth to prevent collapsing on small screens`,
  }),
  wrap: (name: string): ViolationMsg => ({
    message: `"${name}" is in a wrap container without min-width`,
    suggestion: `Add minWidth to control when wrapping occurs`,
  }),
  grid: (name: string): ViolationMsg => ({
    message: `"${name}" is in a grid layout without size constraints`,
    suggestion: `Add min/max-width for proper column sizing`,
  }),
};

// ── non-layout-container (was group-usage) ───────────────────────────────────

export type NonLayoutContainerSubType = "group" | "section";

export const nonLayoutContainerMsg = {
  group: (name: string): ViolationMsg => ({
    message: `"${name}" is a Group`,
    suggestion: `Convert to Frame and apply auto-layout`,
  }),
  section: (name: string): ViolationMsg => ({
    message: `"${name}" is a Section used as layout container`,
    suggestion: `Convert to Frame and apply auto-layout`,
  }),
};

// ── deep-nesting ─────────────────────────────────────────────────────────────

export const deepNestingMsg = (name: string, depth: number, maxDepth: number): ViolationMsg => ({
  message: `"${name}" is nested ${depth} levels deep within its component (max: ${maxDepth})`,
  suggestion: `Extract into a sub-component to reduce depth`,
});

// ── missing-component ────────────────────────────────────────────────────────

export const missingComponentMsg = {
  unusedComponent: (componentName: string, count: number): ViolationMsg => ({
    message: `Component "${componentName}" exists but ${count} repeated frames found instead of instances`,
    suggestion: `Replace frames with component instances`,
  }),
  nameRepetition: (name: string, count: number): ViolationMsg => ({
    message: `"${name}" appears ${count} times`,
    suggestion: `Extract as a reusable component`,
  }),
  structureRepetition: (name: string, siblingCount: number): ViolationMsg => ({
    message: `"${name}" and ${siblingCount} sibling frame(s) share the same internal structure`,
    suggestion: `Extract a shared component from the repeated structure`,
  }),
  styleOverride: (componentName: string, overrides: string[]): ViolationMsg => ({
    message: `"${componentName}" instance has style overrides (${overrides.join(", ")})`,
    suggestion: `Create a new variant for this style combination`,
  }),
};

// ── detached-instance ────────────────────────────────────────────────────────

export const detachedInstanceMsg = (name: string, componentName: string): ViolationMsg => ({
  message: `"${name}" may be a detached instance of component "${componentName}"`,
  suggestion: `Restore as an instance of "${componentName}" or create a new variant`,
});

// ── variant-structure-mismatch ───────────────────────────────────────────────

export const variantStructureMismatchMsg = (name: string, mismatchCount: number, totalVariants: number): ViolationMsg => ({
  message: `"${name}" has ${mismatchCount}/${totalVariants} variants with different child structures`,
  suggestion: `Unify variant structures using visibility toggles for optional elements`,
});

// ── non-standard-naming ──────────────────────────────────────────────────────

export type NonStandardNamingSubType = "state-name";

export const nonStandardNamingMsg = {
  stateName: (name: string, nonStandard: string, suggested: string): ViolationMsg => ({
    message: `"${name}" has non-standard state name "${nonStandard}"`,
    suggestion: `Use "${suggested}" for dev-friendly naming`,
  }),
};

// ── non-semantic-name (merged: default-name + non-semantic-name) ─────────────

export type NonSemanticNameSubType = "frame" | "group" | "vector" | "shape" | "text" | "image" | "component" | "instance" | "shape-name";

const DEFAULT_NAME_SUBTYPE_MAP: Record<string, NonSemanticNameSubType> = {
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

export function getDefaultNameSubType(nodeType: string): NonSemanticNameSubType {
  return DEFAULT_NAME_SUBTYPE_MAP[nodeType] ?? "frame";
}

const NON_SEMANTIC_EXAMPLES: Record<string, string> = {
  FRAME: '"Header", "ProductCard", "Sidebar"',
  GROUP: '"NavItems", "ButtonGroup", "CardContent"',
  VECTOR: '"ArrowIcon", "CheckMark", "LogoSymbol"',
  LINE: '"Divider", "Separator", "Underline"',
  RECTANGLE: '"Background", "Divider", "Overlay"',
  ELLIPSE: '"AvatarShape", "StatusDot", "Badge"',
  STAR: '"RatingIcon", "FavoriteIcon", "StarBadge"',
  REGULAR_POLYGON: '"PlayIcon", "WarningIcon", "ShapeDecor"',
  TEXT: '"PageTitle", "Description", "Price"',
  IMAGE: '"Avatar", "ProductPhoto", "Banner"',
  COMPONENT: '"PrimaryButton", "InputField", "CardTemplate"',
  COMPONENT_SET: '"Button", "Input", "Card"',
  INSTANCE: '"CloseButton", "UserAvatar", "StarIcon"',
};

export const nonSemanticNameMsg = (type: string, name: string): ViolationMsg => {
  const examples = NON_SEMANTIC_EXAMPLES[type] ?? '"Header", "ProductCard", "Icon"';
  return {
    message: `${type} "${name}" is a non-semantic name`,
    suggestion: `Rename to describe its role (e.g., ${examples})`,
  };
};

// ── missing-interaction-state ─────────────────────────────────────────────────

export type MissingInteractionStateSubType = "hover" | "disabled" | "active" | "focus";

export const missingInteractionStateMsg = {
  hover: (name: string): ViolationMsg => ({
    message: `"${name}" looks interactive but has no Hover state variant`,
    suggestion: `Add a State=Hover variant`,
  }),
  disabled: (name: string): ViolationMsg => ({
    message: `"${name}" looks interactive but has no Disabled state variant`,
    suggestion: `Add a State=Disabled variant`,
  }),
  active: (name: string): ViolationMsg => ({
    message: `"${name}" looks interactive but has no Active state variant`,
    suggestion: `Add a State=Active variant`,
  }),
  focus: (name: string): ViolationMsg => ({
    message: `"${name}" looks interactive but has no Focus state variant`,
    suggestion: `Add a State=Focus variant`,
  }),
};

// ── missing-prototype ─────────────────────────────────────────────────────────

export type MissingPrototypeSubType = "button" | "navigation" | "tab" | "overlay" | "carousel" | "input" | "toggle";

export const missingPrototypeMsg = {
  button: (name: string): ViolationMsg => ({
    message: `"${name}" looks like a button but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define the click behavior`,
  }),
  navigation: (name: string): ViolationMsg => ({
    message: `"${name}" looks like a navigation link but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define the destination`,
  }),
  tab: (name: string): ViolationMsg => ({
    message: `"${name}" looks like a tab but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define tab switching behavior`,
  }),
  overlay: (name: string): ViolationMsg => ({
    message: `"${name}" looks like an overlay trigger but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define open/close behavior`,
  }),
  carousel: (name: string): ViolationMsg => ({
    message: `"${name}" looks like a carousel but has no interaction prototype`,
    suggestion: `Add an ON_CLICK or ON_DRAG interaction to define slide navigation`,
  }),
  input: (name: string): ViolationMsg => ({
    message: `"${name}" looks like an input but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define focus/interaction behavior`,
  }),
  toggle: (name: string): ViolationMsg => ({
    message: `"${name}" looks like a toggle but has no click prototype`,
    suggestion: `Add an ON_CLICK interaction to define on/off behavior`,
  }),
};

// ── inconsistent-naming-convention ───────────────────────────────────────────

export const inconsistentNamingMsg = (name: string, nodeConvention: string, dominantConvention: string, suggested: string): ViolationMsg => ({
  message: `"${name}" uses ${nodeConvention} while siblings use ${dominantConvention}`,
  suggestion: `Rename to "${suggested}"`,
  guide: `This checks sibling layers at the same level — you don't have to follow the exact suggestion, just keep naming consistent across siblings`,
});
