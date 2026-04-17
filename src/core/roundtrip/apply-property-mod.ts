import {
  applyWithInstanceFallback,
  type ApplyWithInstanceFallbackContext,
} from "./apply-with-instance-fallback.js";
import type {
  FigmaGlobal,
  FigmaNode,
  FigmaPaint,
  FigmaVariable,
  RoundtripQuestion,
  RoundtripResult,
} from "./types.js";

declare const figma: FigmaGlobal;

// Exact-name match against local variables. Scope is LOCAL variables only;
// library variables already imported into this file appear here, but variables
// in an unimported remote library return null (caller must fall back). Slash-
// path names work only when the variable's `name` field literally contains
// the slash.
export async function resolveVariableByName(
  name: string
): Promise<FigmaVariable | null> {
  const locals = await figma.variables.getLocalVariablesAsync();
  return locals.find((v) => v.name === name) ?? null;
}

interface VariableAnswer {
  variable: string;
  fallback?: unknown;
}

interface FallbackAnswer {
  fallback: unknown;
}

type Parsed =
  | { kind: "binding"; name: string; fallback?: unknown }
  | { kind: "scalar"; scalar: unknown };

function parseValue(raw: unknown): Parsed {
  if (raw && typeof raw === "object" && "variable" in raw) {
    const v = raw as VariableAnswer;
    const parsed: Parsed = { kind: "binding", name: v.variable };
    if ("fallback" in v) parsed.fallback = v.fallback;
    return parsed;
  }
  if (raw && typeof raw === "object" && "fallback" in raw) {
    return { kind: "scalar", scalar: (raw as FallbackAnswer).fallback };
  }
  return { kind: "scalar", scalar: raw };
}

function isPaintProp(prop: string): boolean {
  return prop === "fills" || prop === "strokes";
}

function applyPropertyBinding(
  target: FigmaNode,
  prop: string,
  variable: FigmaVariable
): boolean {
  // Experiment 08: Paint arrays (fills, strokes) need the Paint-specific
  // binding API. `target.setBoundVariable` silently no-ops (or throws) on
  // these — the fix is to call setBoundVariableForPaint for each paint,
  // which RETURNS a new paint object, then reassign the whole array onto
  // target[prop]. Reassignment is load-bearing — mutating paint.boundVariables
  // in place does nothing.
  if (isPaintProp(prop)) {
    const current = (target as Record<string, unknown>)[prop];
    // Mixed fills/strokes — no single array to iterate. Skip cleanly; the
    // designer must un-mix before a variable binding can apply uniformly.
    if (current === figma.mixed || !Array.isArray(current)) return false;
    const paints = current as FigmaPaint[];
    const bound = paints.map((paint) =>
      figma.variables.setBoundVariableForPaint(paint, "color", variable)
    );
    (target as Record<string, unknown>)[prop] = bound;
    return true;
  }
  (
    target as unknown as {
      setBoundVariable(name: string, v: FigmaVariable): void;
    }
  ).setBoundVariable(prop, variable);
  return true;
}

function applyPropertyScalar(
  target: FigmaNode,
  prop: string,
  scalar: unknown
): boolean {
  const rec = target as Record<string, unknown>;
  const before = rec[prop];
  rec[prop] = scalar;
  // B matrix: some instance children silently ignore writes (e.g. layoutMode).
  // Signal "no change" so the caller routes to the definition fallback.
  if (rec[prop] === before && before !== scalar) return false;
  return true;
}

export async function applyPropertyMod(
  question: RoundtripQuestion,
  answerValue: unknown,
  context: ApplyWithInstanceFallbackContext = {}
): Promise<RoundtripResult> {
  const props = Array.isArray(question.targetProperty)
    ? question.targetProperty
    : question.targetProperty !== undefined
      ? [question.targetProperty]
      : [];

  return applyWithInstanceFallback(
    question,
    async (target) => {
      if (!target) return undefined;
      let changed: boolean | undefined = undefined;
      for (const prop of props) {
        if (!(prop in target)) continue;
        // Multi-property rules (e.g. no-auto-layout → [layoutMode, itemSpacing])
        // expect an object answer: { layoutMode: "VERTICAL", itemSpacing: 16 }.
        // Variable-binding single answers keep the { variable } shape.
        const perProp =
          answerValue &&
          typeof answerValue === "object" &&
          !("variable" in (answerValue as object)) &&
          !Array.isArray(answerValue)
            ? (answerValue as Record<string, unknown>)[prop]
            : answerValue;

        const parsed = parseValue(perProp);
        if (parsed.kind === "binding") {
          const variable = await resolveVariableByName(parsed.name);
          if (variable) {
            applyPropertyBinding(target, prop, variable);
            continue;
          }
          if (parsed.fallback !== undefined) {
            if (!applyPropertyScalar(target, prop, parsed.fallback)) {
              changed = false;
            }
          }
          continue;
        }
        // parsed.kind === "scalar" — apply directly.
        if (parsed.scalar === undefined) continue;
        if (!applyPropertyScalar(target, prop, parsed.scalar)) {
          changed = false;
        }
      }
      return changed;
    },
    context
  );
}
