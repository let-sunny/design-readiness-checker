import { upsertCanicodeAnnotation } from "./annotations.js";
import type {
  CanicodeCategories,
  FigmaGlobal,
  FigmaNode,
  RoundtripQuestion,
  RoundtripResult,
  WriteFn,
} from "./types.js";

declare const figma: FigmaGlobal;

export interface ApplyWithInstanceFallbackContext {
  categories?: CanicodeCategories;
}

interface RouteContext {
  question: RoundtripQuestion;
  scene: FigmaNode;
  categories: CanicodeCategories | undefined;
  reason: "silent-ignore" | "override-error" | "non-override-error";
  errorMessage?: string;
}

// Shared failure path: definition write attempted and annotated on throw.
// Unifies the silent-ignore fallback branch and the override-error branch so
// an external-library throw (Experiment 10, `remote === true` / read-only)
// annotates cleanly in both cases instead of aborting the use_figma batch —
// the silent-ignore path was missing a try/catch before this extraction.
async function routeToDefinitionOrAnnotate(
  definition: FigmaNode | null,
  writeFn: WriteFn,
  ctx: RouteContext
): Promise<RoundtripResult> {
  if (!definition) {
    if (ctx.categories) {
      const markdown =
        ctx.reason === "silent-ignore"
          ? "write accepted but value unchanged; no definition available"
          : ctx.reason === "override-error"
            ? `could not apply automatically: ${ctx.errorMessage ?? ""}`
            : `could not apply automatically: ${ctx.errorMessage ?? ""}`;
      upsertCanicodeAnnotation(ctx.scene, {
        ruleId: ctx.question.ruleId,
        markdown,
        categoryId: ctx.categories.fallback,
      });
    }
    return ctx.reason === "silent-ignore"
      ? { icon: "📝", label: "silent-ignore, annotated" }
      : { icon: "📝", label: `error: ${ctx.errorMessage ?? ""}` };
  }

  try {
    await writeFn(definition);
    return {
      icon: "🌐",
      label:
        ctx.reason === "silent-ignore"
          ? "source definition (silent-ignore fallback)"
          : "source definition",
    };
  } catch (defErr) {
    const defMsg = String((defErr as { message?: unknown })?.message ?? defErr);
    // Experiment 10: external libraries surface either via
    // `definition.remote === true` OR a "read-only" error message. Both
    // branches must annotate-and-move-on instead of aborting the batch.
    const isRemoteReadOnly =
      definition.remote === true || /read-only/i.test(defMsg);
    if (ctx.categories) {
      upsertCanicodeAnnotation(ctx.scene, {
        ruleId: ctx.question.ruleId,
        markdown: isRemoteReadOnly
          ? "source component lives in an external library and is read-only from this file — apply the fix in the library file itself."
          : `could not apply at source definition: ${defMsg}`,
        categoryId: ctx.categories.fallback,
      });
    }
    return {
      icon: "📝",
      label: isRemoteReadOnly
        ? "external library (read-only)"
        : `definition error: ${defMsg}`,
    };
  }
}

// Three-tier write policy with silent-ignore detection (B matrix finding).
// writeFn contract: may read `target[prop]` before/after to detect silent
// ignore and return `false` to signal "no change" — caller routes to the
// definition fallback. Pre-condition: the orchestrator has already collected a
// batch-level confirmation that writes targeting a source-component definition
// may fan out to every instance of that component in the file. This helper
// never prompts.
export async function applyWithInstanceFallback(
  question: RoundtripQuestion,
  writeFn: WriteFn,
  context: ApplyWithInstanceFallbackContext = {}
): Promise<RoundtripResult> {
  const { categories } = context;
  const scene = await figma.getNodeByIdAsync(question.nodeId);
  if (!scene) return { icon: "📝", label: "missing node" };

  const definition = question.sourceChildId
    ? await figma.getNodeByIdAsync(question.sourceChildId)
    : null;

  try {
    const changed = await writeFn(scene);
    if (changed === false) {
      return routeToDefinitionOrAnnotate(definition, writeFn, {
        question,
        scene,
        categories,
        reason: "silent-ignore",
      });
    }
    return { icon: "✅", label: "instance/scene" };
  } catch (e) {
    const msg = String((e as { message?: unknown })?.message ?? e);
    // Canonical match from Experiment 08: "This property cannot be overridden
    // in an instance". The broader /override/i fallback catches variant
    // wording from other properties but is narrow enough that unrelated
    // errors (file missing, network, etc.) won't false-match. Do not add
    // /instance/i — many unrelated messages mention "instance" and it
    // over-routes.
    const looksLikeInstanceOverride =
      /cannot be overridden/i.test(msg) || /override/i.test(msg);
    if (!looksLikeInstanceOverride) {
      return routeToDefinitionOrAnnotate(null, writeFn, {
        question,
        scene,
        categories,
        reason: "non-override-error",
        errorMessage: msg,
      });
    }
    return routeToDefinitionOrAnnotate(definition, writeFn, {
      question,
      scene,
      categories,
      reason: "override-error",
      errorMessage: msg,
    });
  }
}
