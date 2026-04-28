import { vi, type Mock } from "vitest";
import type {
  AnnotationCategory,
  FigmaGlobal,
  FigmaNode,
  FigmaPaint,
  FigmaVariable,
} from "./types.js";

export interface FigmaGlobalMock extends FigmaGlobal {
  getNodeByIdAsync: Mock<(id: string) => Promise<FigmaNode | null>>;
  annotations: {
    getAnnotationCategoriesAsync: Mock<() => Promise<AnnotationCategory[]>>;
    addAnnotationCategoryAsync: Mock<
      (input: { label: string; color: string }) => Promise<AnnotationCategory>
    >;
  };
  variables: {
    getLocalVariablesAsync: Mock<() => Promise<FigmaVariable[]>>;
    setBoundVariableForPaint: Mock<
      (
        paint: FigmaPaint,
        field: "color",
        variable: FigmaVariable | null
      ) => FigmaPaint
    >;
  };
  // Phase 3 (#508 / ADR-023): tests assign or replace this on a per-case basis
  // (`mock.createComponentFromNode = vi.fn(...)`). Marked optional in
  // `FigmaGlobal` because the helper guards on `typeof create !== "function"`.
  createComponentFromNode?:
    | Mock<(node: FigmaNode) => FigmaNode>
    | ((node: FigmaNode) => FigmaNode);
}

export interface CreateFigmaGlobalOptions {
  nodes?: Record<string, FigmaNode>;
  categories?: AnnotationCategory[];
  variables?: FigmaVariable[];
  mixed?: symbol;
}

// Builds a vitest-spied mock of the narrow Figma Plugin API surface used by the
// roundtrip helpers. Tests install it via installFigmaGlobal(mock) and should
// call uninstallFigmaGlobal() in afterEach so globalThis.figma doesn't leak.
export function createFigmaGlobal(
  options: CreateFigmaGlobalOptions = {}
): FigmaGlobalMock {
  const nodes = new Map<string, FigmaNode>(
    Object.entries(options.nodes ?? {})
  );
  const categories: AnnotationCategory[] = [...(options.categories ?? [])];
  const variables: FigmaVariable[] = [...(options.variables ?? [])];
  const mixed = options.mixed ?? Symbol("figma.mixed");

  return {
    mixed,
    getNodeByIdAsync: vi.fn(async (id: string) => nodes.get(id) ?? null),
    annotations: {
      getAnnotationCategoriesAsync: vi.fn(async () => [...categories]),
      addAnnotationCategoryAsync: vi.fn(
        async (input: { label: string; color: string }) => {
          const created: AnnotationCategory = {
            id: `cat-${categories.length + 1}`,
            label: input.label,
            color: input.color,
          };
          categories.push(created);
          return created;
        }
      ),
    },
    variables: {
      getLocalVariablesAsync: vi.fn(async () => [...variables]),
      // Real Plugin API returns a NEW paint object with the binding set —
      // Experiment 08 documented that paint.boundVariables is not mutated in
      // place; the caller must reassign node[prop]. Mirror that contract here
      // so tests fail when helper code forgets to reassign.
      setBoundVariableForPaint: vi.fn(
        (paint: FigmaPaint, _field: "color", variable: FigmaVariable | null) =>
          ({
            ...paint,
            boundVariables: variable
              ? { color: { type: "VARIABLE_ALIAS", id: variable.id } }
              : undefined,
          }) as FigmaPaint
      ),
    },
  };
}

const FIGMA_GLOBAL_KEY = "figma";

type FigmaHost = { [FIGMA_GLOBAL_KEY]?: FigmaGlobal };

export function installFigmaGlobal(mock: FigmaGlobal): void {
  (globalThis as FigmaHost)[FIGMA_GLOBAL_KEY] = mock;
}

export function uninstallFigmaGlobal(): void {
  delete (globalThis as FigmaHost)[FIGMA_GLOBAL_KEY];
}
