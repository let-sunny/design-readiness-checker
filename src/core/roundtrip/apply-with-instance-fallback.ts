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

// Telemetry event name for skipped definition writes. Mirrored (as a typed
// constant) in src/core/monitoring/events.ts — this helper passes the literal
// string so the IIFE bundle that runs in the Figma Plugin sandbox stays free
// of any `core/monitoring` import.
const DEFINITION_WRITE_SKIPPED_EVENT =
  "cic_roundtrip_definition_write_skipped";

export interface ApplyWithInstanceFallbackContext {
  categories?: CanicodeCategories;
  // ADR-012: definition writes are opt-in. When false (the default), a
  // recognized instance-override failure (override-error or silent-ignore)
  // routes to a scene-level annotation naming the source component instead
  // of propagating the write to the definition.
  allowDefinitionWrite?: boolean;
  // Fires once per skipped definition write so a Node-side orchestrator can
  // track opt-in usage (ADR-012 Q5 data). Callback is optional; stays undefined
  // inside the Figma Plugin sandbox where `fetch`/PostHog is unavailable.
  telemetry?: (event: string, props?: Record<string, unknown>) => void;
}

interface RouteContext {
  question: RoundtripQuestion;
  scene: FigmaNode;
  categories: CanicodeCategories | undefined;
  reason: "silent-ignore" | "override-error" | "non-override-error";
  errorMessage?: string;
  allowDefinitionWrite: boolean;
  telemetry:
    | ((event: string, props?: Record<string, unknown>) => void)
    | undefined;
}

/**
 * ADR-012 default path: scene annotation when the orchestrator has not opted
 * into definition writes. Names the cause (silent-ignore vs override-error),
 * explains why definition writes are gated, and warns that
 * `allowDefinitionWrite` is fan-out — not a neutral retry (#443).
 */
function formatDefinitionWriteSkippedMarkdown(args: {
  componentName: string;
  reason: "silent-ignore" | "override-error";
  errorMessage?: string;
  replicaCount?: number;
}): string {
  const { componentName, reason, errorMessage, replicaCount } = args;

  const cause =
    reason === "silent-ignore"
      ? "The write ran, but the property value did not change on this instance (silent-ignore)."
      : `Figma rejected an instance-level change${errorMessage ? `: ${errorMessage}` : ""}.`;

  const fanOutHint =
    typeof replicaCount === "number" && replicaCount >= 2
      ? ` This batched question covers ${replicaCount} instance scenes — changing **${componentName}** at the definition still affects every inheriting instance, not just one row in the batch.`
      : "";

  return (
    `${cause} Canicode's safer default (ADR-012) is to skip writing the source component **${componentName}** without explicit opt-in, because that write propagates to every non-overridden instance of **${componentName}** in the file.${fanOutHint} ` +
    `Prefer a manual override on **this** instance when you only need a local fix. ` +
    `Use \`allowDefinitionWrite: true\` only when you intend to change **${componentName}** for all inheriting instances — it is not a neutral shortcut for a single-instance tweak.`
  );
}

function resolveSourceComponentName(
  definition: FigmaNode | null,
  question: RoundtripQuestion
): string {
  if (definition && typeof definition.name === "string" && definition.name) {
    return definition.name;
  }
  const ic = question.instanceContext;
  if (ic && typeof ic.sourceComponentName === "string" && ic.sourceComponentName) {
    return ic.sourceComponentName;
  }
  return "the source component";
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
  // ADR-012: when the caller has not opted into definition writes, recognized
  // instance-override failures route to a scene-level annotation naming the
  // source component instead of propagating. The non-override-error branch
  // already annotates-only (definition === null on entry), so the guard
  // intentionally excludes that reason — the flag would change nothing there.
  if (
    definition &&
    !ctx.allowDefinitionWrite &&
    ctx.reason !== "non-override-error"
  ) {
    const componentName = resolveSourceComponentName(definition, ctx.question);
    const replicaCount =
      typeof ctx.question.replicas === "number" &&
      Number.isInteger(ctx.question.replicas)
        ? ctx.question.replicas
        : undefined;
    if (ctx.categories) {
      const markdownArgs: Parameters<typeof formatDefinitionWriteSkippedMarkdown>[0] =
        {
          componentName,
          reason: ctx.reason,
          ...(ctx.errorMessage !== undefined
            ? { errorMessage: ctx.errorMessage }
            : {}),
          ...(replicaCount !== undefined ? { replicaCount } : {}),
        };
      upsertCanicodeAnnotation(ctx.scene, {
        ruleId: ctx.question.ruleId,
        markdown: formatDefinitionWriteSkippedMarkdown(markdownArgs),
        categoryId: ctx.categories.fallback,
      });
    }
    ctx.telemetry?.(DEFINITION_WRITE_SKIPPED_EVENT, {
      ruleId: ctx.question.ruleId,
      reason: ctx.reason,
    });
    return {
      icon: "📝",
      label: "definition write skipped (opt-in disabled)",
    };
  }

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
// Default policy (ADR-012): scene → annotate. Definition writes require
// `context.allowDefinitionWrite: true`, which the orchestrator flips on only
// after a batch-level confirmation naming the propagation set.
// writeFn contract: may read `target[prop]` before/after to detect silent
// ignore and return `false` to signal "no change" — caller routes to the
// definition tier or (under the default) to the annotation fallback.
export async function applyWithInstanceFallback(
  question: RoundtripQuestion,
  writeFn: WriteFn,
  context: ApplyWithInstanceFallbackContext = {}
): Promise<RoundtripResult> {
  const { categories, allowDefinitionWrite = false, telemetry } = context;
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
        allowDefinitionWrite,
        telemetry,
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
        allowDefinitionWrite,
        telemetry,
      });
    }
    return routeToDefinitionOrAnnotate(definition, writeFn, {
      question,
      scene,
      categories,
      reason: "override-error",
      errorMessage: msg,
      allowDefinitionWrite,
      telemetry,
    });
  }
}
