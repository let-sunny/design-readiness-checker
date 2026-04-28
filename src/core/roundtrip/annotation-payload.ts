import type {
  AcknowledgmentIntent,
  AcknowledgmentSceneWriteOutcome,
  PropertyAcknowledgmentIntent,
  RuleOptOutAcknowledgmentIntent,
} from "../contracts/acknowledgment.js";

/** Fenced JSON block marker — parsed by `extractAcknowledgmentsFromNode` (ADR-019 / #444). */
export const CANICODE_JSON_FENCE = "```canicode-json";

export interface RoundtripIntentPayload {
  field: string;
  value: unknown;
  scope: "instance" | "definition";
}

export interface CanicodeAnnotationJsonV1 {
  v: 1;
  ruleId: string;
  nodeId?: string;
  intent?: AcknowledgmentIntent;
  sceneWriteOutcome: AcknowledgmentSceneWriteOutcome;
  codegenDirective?: string;
}

function formatIntentValueForDisplay(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return `\`${JSON.stringify(value)}\``;
    } catch {
      return String(value);
    }
  }
  return `\`${String(value)}\``;
}

export function buildCodegenDirective(args: {
  sceneNodeId: string;
  intent: RoundtripIntentPayload;
}): string {
  const { sceneNodeId, intent } = args;
  const val =
    intent.value === undefined
      ? "undefined"
      : JSON.stringify(intent.value);
  return `When generating code for node ${sceneNodeId}, set ${intent.field} to ${val} (user intent, scope: ${intent.scope}). Prefer this over the current Figma scene value when they disagree.`;
}

function sceneOutcomeToAck(
  result: AcknowledgmentSceneWriteOutcome["result"],
  reason?: string
): AcknowledgmentSceneWriteOutcome {
  return reason !== undefined ? { result, reason } : { result };
}

function buildOutcomeHumanLine(args: {
  reason: "silent-ignore" | "override-error" | "non-override-error";
  errorMessage?: string;
  skippedDefinitionDueToAdr012: boolean;
}): string {
  if (args.skippedDefinitionDueToAdr012) {
    const adrHint =
      " Canicode skipped writing the source component without `allowDefinitionWrite: true` (ADR-012 safer default). The instance-level change did not apply as intended in the scene.";
    if (args.reason === "silent-ignore") {
      return (
        "**Scene write outcome:** The write ran, but the property value did not " +
        "change on this instance (silent-ignore)." +
        adrHint
      );
    }
    return (
      "**Scene write outcome:** Figma rejected an instance-level change" +
      (args.errorMessage ? `: ${args.errorMessage}` : "") +
      "." +
      adrHint
    );
  }
  if (args.reason === "silent-ignore") {
    return (
      "**Scene write outcome:** The write ran, but the property value did not " +
      "change on this instance (silent-ignore). No source definition was available to escalate."
    );
  }
  if (args.reason === "override-error") {
    return (
      "**Scene write outcome:** Figma rejected an instance-level change" +
      (args.errorMessage ? `: ${args.errorMessage}` : "") +
      ". No source definition was available to escalate."
    );
  }
  return (
    "**Scene write outcome:** Could not apply automatically" +
    (args.errorMessage ? `: ${args.errorMessage}` : "") +
    "."
  );
}

/** ADR-012 long-form paragraph (component name, fan-out, opt-in hint). */
export function buildAdr012PropagationParagraph(args: {
  componentName: string;
  replicaCount?: number;
}): string {
  const { componentName, replicaCount } = args;
  const fanOutHint =
    typeof replicaCount === "number" && replicaCount >= 2
      ? ` This batched question covers ${replicaCount} instance scenes — changing **${componentName}** at the definition still affects every inheriting instance, not just one row in the batch.`
      : "";
  return (
    `Canicode's safer default (ADR-012) is to skip writing the source component **${componentName}** without explicit opt-in, because that write propagates to every non-overridden instance of **${componentName}** in the file.${fanOutHint} ` +
    `Prefer a manual override on **this** instance when you only need a local fix. ` +
    `Use \`allowDefinitionWrite: true\` only when you intend to change **${componentName}** for all inheriting instances — it is not a neutral shortcut for a single-instance tweak.`
  );
}

export function buildDefinitionWriteSkippedBody(args: {
  ruleId: string;
  sceneNodeId: string;
  componentName: string;
  reason: "silent-ignore" | "override-error";
  errorMessage?: string;
  replicaCount?: number;
  intent?: RoundtripIntentPayload;
}): string {
  const {
    ruleId,
    sceneNodeId,
    componentName,
    reason,
    errorMessage,
    replicaCount,
    intent,
  } = args;

  const ackIntent: PropertyAcknowledgmentIntent | undefined = intent
    ? {
        kind: "property",
        field: intent.field,
        value: intent.value,
        scope: intent.scope,
      }
    : undefined;

  const sceneWriteOutcome = sceneOutcomeToAck("user-declined-propagation", "adr-012-opt-in-disabled");
  const codegenDirective =
    intent !== undefined
      ? buildCodegenDirective({ sceneNodeId, intent })
      : undefined;

  const jsonBlock: CanicodeAnnotationJsonV1 = {
    v: 1,
    ruleId,
    nodeId: sceneNodeId,
    ...(ackIntent ? { intent: ackIntent } : {}),
    sceneWriteOutcome,
    ...(codegenDirective ? { codegenDirective } : {}),
  };

  const userAnswerLine =
    intent !== undefined
      ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).`
      : null;

  const outcomeLine = buildOutcomeHumanLine({
    reason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    skippedDefinitionDueToAdr012: true,
  });

  const adrBlock = buildAdr012PropagationParagraph({
    componentName,
    ...(replicaCount !== undefined ? { replicaCount } : {}),
  });

  const proseParts = [userAnswerLine, outcomeLine, adrBlock].filter(
    (p): p is string => p !== null
  );
  const prose = proseParts.join("\n\n");

  return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
}

export function buildNoDefinitionFallbackBody(args: {
  ruleId: string;
  sceneNodeId: string;
  reason: "silent-ignore" | "override-error" | "non-override-error";
  errorMessage?: string;
  intent?: RoundtripIntentPayload;
}): string {
  const { ruleId, sceneNodeId, reason, errorMessage, intent } = args;

  const ackIntent: PropertyAcknowledgmentIntent | undefined = intent
    ? { kind: "property", field: intent.field, value: intent.value, scope: intent.scope }
    : undefined;

  const outcomeResult: AcknowledgmentSceneWriteOutcome["result"] =
    reason === "silent-ignore"
      ? "silent-ignored"
      : reason === "override-error"
        ? "api-rejected"
        : "api-rejected";

  const sceneWriteOutcome = sceneOutcomeToAck(
    outcomeResult,
    reason === "silent-ignore" ? "silent-ignore-no-definition" : "no-definition-escalation"
  );

  const codegenDirective =
    intent !== undefined
      ? buildCodegenDirective({ sceneNodeId, intent })
      : undefined;

  const jsonBlock: CanicodeAnnotationJsonV1 = {
    v: 1,
    ruleId,
    nodeId: sceneNodeId,
    ...(ackIntent ? { intent: ackIntent } : {}),
    sceneWriteOutcome,
    ...(codegenDirective ? { codegenDirective } : {}),
  };

  const userAnswerLine =
    intent !== undefined
      ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).`
      : null;

  const outcomeLine = buildOutcomeHumanLine({
    reason,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    skippedDefinitionDueToAdr012: false,
  });

  const prose = [userAnswerLine, outcomeLine].filter((p): p is string => p !== null).join("\n\n");

  return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
}

export function buildDefinitionTierFailureBody(args: {
  ruleId: string;
  sceneNodeId: string;
  intent?: RoundtripIntentPayload;
  kind: "read-only-library" | "definition-error";
  errorMessage: string;
}): string {
  const { ruleId, sceneNodeId, intent, kind, errorMessage } = args;

  const sceneWriteOutcome = sceneOutcomeToAck(
    kind === "read-only-library" ? "api-rejected" : "api-rejected",
    kind === "read-only-library" ? "definition-read-only" : "definition-write-failed"
  );

  const codegenDirective =
    intent !== undefined
      ? buildCodegenDirective({ sceneNodeId, intent })
      : undefined;

  const jsonBlock: CanicodeAnnotationJsonV1 = {
    v: 1,
    ruleId,
    nodeId: sceneNodeId,
    ...(intent
      ? {
          intent: {
            kind: "property" as const,
            field: intent.field,
            value: intent.value,
            scope: intent.scope,
          },
        }
      : {}),
    sceneWriteOutcome,
    ...(codegenDirective ? { codegenDirective } : {}),
  };

  const human =
    kind === "read-only-library"
      ? "source component lives in an external library and is read-only from this file — apply the fix in the library file itself."
      : `could not apply at source definition: ${errorMessage}`;

  const userAnswerLine =
    intent !== undefined
      ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).`
      : null;

  const outcomeLine = `**Scene write outcome:** ${human}`;

  const prose = [userAnswerLine, outcomeLine].filter((p): p is string => p !== null).join("\n\n");

  return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
}

function appendJsonFenceAndFooter(
  prose: string,
  jsonBlock: CanicodeAnnotationJsonV1,
  ruleId: string
): string {
  const footer = `— *${ruleId}*`;
  const hasIntent = jsonBlock.intent !== undefined;
  if (!hasIntent) {
    return `${prose}\n\n${footer}`;
  }
  const jsonText = JSON.stringify(jsonBlock, null, 0);
  return `${prose}\n\n${CANICODE_JSON_FENCE}\n${jsonText}\n\`\`\`\n\n${footer}`;
}

/**
 * ADR-022 / #526 sub-task 2: build the body for a `canicode:intentionally-unmapped`
 * annotation. The user marked this component as intentionally unmapped during
 * a roundtrip gotcha — the annotation carries an opt-out signal that the
 * `unmapped-component` rule reads on the next analyze pass and short-circuits
 * on. There is no scene write or codegen directive: opt-out is a *don't-emit*
 * marker, not a value override.
 *
 * Body shape: one explanatory sentence, the canicode-json fence with
 * `intent.kind === "rule-opt-out"`, and the footer `— *<ruleId>*` so
 * `extractAcknowledgmentsFromNode` recognises it as a canicode-authored
 * annotation.
 */
export function buildIntentionallyUnmappedAnnotationBody(args: {
  /** The Figma node id of the component being opted out (`COMPONENT` / `COMPONENT_SET`). */
  sceneNodeId: string;
  /**
   * Rule the annotation opts out of. Currently always `"unmapped-component"`
   * — kept as a parameter so downstream rule-level opt-outs can reuse the
   * same builder without duplicating the body shape.
   */
  ruleId: string;
}): string {
  const { sceneNodeId, ruleId } = args;

  const intent: RuleOptOutAcknowledgmentIntent = {
    kind: "rule-opt-out",
    ruleId,
  };

  const jsonBlock: CanicodeAnnotationJsonV1 = {
    v: 1,
    ruleId,
    nodeId: sceneNodeId,
    intent,
    sceneWriteOutcome: { result: "succeeded", reason: "rule-opt-out" },
  };

  const prose =
    "User marked this component as intentionally unmapped — canicode will skip the unmapped-component check for this node on subsequent analyze runs.";

  return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
}

const FENCED_JSON_RE = new RegExp(
  `${CANICODE_JSON_FENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([\\s\\S]*?)\\s*\`\`\``,
  "m"
);

/**
 * Extract ADR-019 JSON payload from annotation markdown, if present.
 * Returns undefined when no fence or invalid JSON.
 */
export function parseCanicodeJsonPayloadFromMarkdown(
  text: string
): CanicodeAnnotationJsonV1 | undefined {
  const m = FENCED_JSON_RE.exec(text);
  if (!m?.[1]) return undefined;
  try {
    const raw = JSON.parse(m[1].trim()) as unknown;
    if (!raw || typeof raw !== "object") return undefined;
    const o = raw as { v?: unknown; ruleId?: unknown };
    if (o.v !== 1 || typeof o.ruleId !== "string") return undefined;
    return raw as CanicodeAnnotationJsonV1;
  } catch {
    return undefined;
  }
}
