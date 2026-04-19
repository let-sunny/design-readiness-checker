// Narrow, duck-typed interfaces for the slice of the Figma Plugin API that the
// roundtrip helpers touch. We keep these local instead of pulling
// `@figma/plugin-typings` into tsconfig `types` because that package works via
// `declare global` and would leak `figma: PluginAPI` into every file under
// src/, polluting code that has nothing to do with the Plugin API.

export interface AnnotationProperty {
  type: string;
}

export interface AnnotationEntry {
  label?: string;
  labelMarkdown?: string;
  categoryId?: string;
  properties?: AnnotationProperty[];
}

export interface AnnotationCategory {
  id: string;
  label: string;
  color?: string;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  // `remote` is only observable on InstanceNode / ComponentNode /
  // ComponentSetNode. On any other node type it is `undefined`. The probe
  // walks `parent` up to the containing COMPONENT/COMPONENT_SET to read it.
  remote?: boolean;
  parent?: FigmaNode | null;
  annotations?: readonly AnnotationEntry[];
  fills?: unknown;
  strokes?: unknown;
  [key: string]: unknown;
}

export interface FigmaVariable {
  id: string;
  name: string;
}

export interface FigmaPaint {
  type: string;
  [key: string]: unknown;
}

export interface FigmaAnnotationsAPI {
  getAnnotationCategoriesAsync(): Promise<AnnotationCategory[]>;
  addAnnotationCategoryAsync(input: {
    label: string;
    color: string;
  }): Promise<AnnotationCategory>;
}

export interface FigmaVariablesAPI {
  getLocalVariablesAsync(): Promise<FigmaVariable[]>;
  setBoundVariableForPaint(
    paint: FigmaPaint,
    field: "color",
    variable: FigmaVariable | null
  ): FigmaPaint;
}

export interface FigmaGlobal {
  mixed: symbol;
  getNodeByIdAsync(id: string): Promise<FigmaNode | null>;
  annotations: FigmaAnnotationsAPI;
  variables: FigmaVariablesAPI;
}

export interface CanicodeCategories {
  gotcha: string;
  // Renamed from `autoFix` per #355 — the previous name read as
  // "canicode auto-fixed something" but the category actually means
  // "canicode auto-flagged something it could not fix".
  flag: string;
  fallback: string;
  // Pre-rename installations may still carry a `canicode:auto-fix` category
  // populated by older runs. When present, expose its id here so the Step 5
  // cleanup filter can sweep old annotations alongside the new ones. The new
  // code path never WRITES to this id — read-only on the canicode side.
  legacyAutoFix?: string;
}

export interface RoundtripInstanceContext {
  parentInstanceNodeId?: string;
  sourceNodeId?: string;
  sourceComponentId?: string;
  sourceComponentName?: string;
}

export interface RoundtripQuestion {
  nodeId: string;
  ruleId: string;
  sourceChildId?: string;
  targetProperty?: string | string[];
  instanceContext?: RoundtripInstanceContext;
  [key: string]: unknown;
}

export type RoundtripResultIcon = "✅" | "🌐" | "📝";

export interface RoundtripResult {
  icon: RoundtripResultIcon;
  label: string;
}

export type WriteFn = (
  target: FigmaNode
) => Promise<boolean | void> | boolean | void;
