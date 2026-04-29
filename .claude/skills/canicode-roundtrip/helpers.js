var CanICodeRoundtrip = (function (exports) {
  'use strict';

  // src/core/roundtrip/annotations.ts
  function stripAnnotations(annotations) {
    const input = annotations ?? [];
    const out = [];
    for (const a of input) {
      const hasLM = typeof a.labelMarkdown === "string" && a.labelMarkdown.length > 0;
      const hasLabel = typeof a.label === "string" && a.label.length > 0;
      if (!hasLM && !hasLabel) continue;
      const base = hasLM ? { labelMarkdown: a.labelMarkdown } : { label: a.label };
      if (a.categoryId) base.categoryId = a.categoryId;
      if (Array.isArray(a.properties) && a.properties.length > 0) {
        base.properties = a.properties;
      }
      out.push(base);
    }
    return out;
  }
  async function ensureCanicodeCategories() {
    const api = figma.annotations;
    const existing = await api.getAnnotationCategoriesAsync();
    const byLabel = new Map(existing.map((c) => [c.label, c.id]));
    async function ensure(label, color) {
      const cached = byLabel.get(label);
      if (cached) return cached;
      const created = await api.addAnnotationCategoryAsync({ label, color });
      byLabel.set(label, created.id);
      return created.id;
    }
    const result = {
      gotcha: await ensure("canicode:gotcha", "blue"),
      flag: await ensure("canicode:flag", "green"),
      fallback: await ensure("canicode:fallback", "yellow")
    };
    const legacyAutoFix = byLabel.get("canicode:auto-fix");
    if (legacyAutoFix) result.legacyAutoFix = legacyAutoFix;
    return result;
  }
  function upsertCanicodeAnnotation(node, input) {
    if (!node || !("annotations" in node)) return false;
    const { ruleId, markdown, categoryId, properties } = input;
    const legacyPrefix = `**[canicode] ${ruleId}**`;
    const footer = `\u2014 *${ruleId}*`;
    let bodyText = markdown;
    if (bodyText.startsWith(legacyPrefix)) {
      bodyText = bodyText.slice(legacyPrefix.length).replace(/^\s*\n+/, "");
    }
    const trimmed = bodyText.replace(/\s+$/, "");
    const body = trimmed.endsWith(footer) ? trimmed : `${trimmed}

${footer}`;
    const existing = stripAnnotations(node.annotations);
    const entry = { labelMarkdown: body };
    if (categoryId) entry.categoryId = categoryId;
    if (properties && properties.length > 0) entry.properties = properties;
    const matchesRuleId = (text) => {
      if (typeof text !== "string") return false;
      return text.startsWith(legacyPrefix) || text.includes(footer);
    };
    const idx = existing.findIndex(
      (a) => matchesRuleId(a.labelMarkdown) || matchesRuleId(a.label)
    );
    if (idx >= 0) existing[idx] = entry;
    else existing.push(entry);
    try {
      node.annotations = existing;
      return true;
    } catch (e) {
      const msg = String(e?.message ?? e);
      const isNodeTypeReject = /invalid property .+ for a .+ node/i.test(msg);
      if (!entry.properties || !isNodeTypeReject) throw e;
      delete entry.properties;
      if (idx >= 0) existing[idx] = entry;
      node.annotations = existing;
      return true;
    }
  }

  // src/core/roundtrip/annotation-payload.ts
  var CANICODE_JSON_FENCE = "```canicode-json";
  function formatIntentValueForDisplay(value) {
    if (value === void 0) return "undefined";
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
  function buildCodegenDirective(args) {
    const { sceneNodeId, intent } = args;
    const val = intent.value === void 0 ? "undefined" : JSON.stringify(intent.value);
    return `When generating code for node ${sceneNodeId}, set ${intent.field} to ${val} (user intent, scope: ${intent.scope}). Prefer this over the current Figma scene value when they disagree.`;
  }
  function sceneOutcomeToAck(result, reason) {
    return reason !== void 0 ? { result, reason } : { result };
  }
  function buildOutcomeHumanLine(args) {
    if (args.skippedDefinitionDueToAdr012) {
      const adrHint = " Canicode skipped writing the source component without `allowDefinitionWrite: true` (ADR-012 safer default). The instance-level change did not apply as intended in the scene.";
      if (args.reason === "silent-ignore") {
        return "**Scene write outcome:** The write ran, but the property value did not change on this instance (silent-ignore)." + adrHint;
      }
      return "**Scene write outcome:** Figma rejected an instance-level change" + (args.errorMessage ? `: ${args.errorMessage}` : "") + "." + adrHint;
    }
    if (args.reason === "silent-ignore") {
      return "**Scene write outcome:** The write ran, but the property value did not change on this instance (silent-ignore). No source definition was available to escalate.";
    }
    if (args.reason === "override-error") {
      return "**Scene write outcome:** Figma rejected an instance-level change" + (args.errorMessage ? `: ${args.errorMessage}` : "") + ". No source definition was available to escalate.";
    }
    return "**Scene write outcome:** Could not apply automatically" + (args.errorMessage ? `: ${args.errorMessage}` : "") + ".";
  }
  function buildAdr012PropagationParagraph(args) {
    const { componentName, replicaCount } = args;
    const fanOutHint = typeof replicaCount === "number" && replicaCount >= 2 ? ` This batched question covers ${replicaCount} instance scenes \u2014 changing **${componentName}** at the definition still affects every inheriting instance, not just one row in the batch.` : "";
    return `Canicode's safer default (ADR-012) is to skip writing the source component **${componentName}** without explicit opt-in, because that write propagates to every non-overridden instance of **${componentName}** in the file.${fanOutHint} Prefer a manual override on **this** instance when you only need a local fix. Use \`allowDefinitionWrite: true\` only when you intend to change **${componentName}** for all inheriting instances \u2014 it is not a neutral shortcut for a single-instance tweak.`;
  }
  function buildDefinitionWriteSkippedBody(args) {
    const {
      ruleId,
      sceneNodeId,
      componentName,
      reason,
      errorMessage,
      replicaCount,
      intent
    } = args;
    const ackIntent = intent ? {
      kind: "property",
      field: intent.field,
      value: intent.value,
      scope: intent.scope
    } : void 0;
    const sceneWriteOutcome = sceneOutcomeToAck("user-declined-propagation", "adr-012-opt-in-disabled");
    const codegenDirective = intent !== void 0 ? buildCodegenDirective({ sceneNodeId, intent }) : void 0;
    const jsonBlock = {
      v: 1,
      ruleId,
      nodeId: sceneNodeId,
      ...ackIntent ? { intent: ackIntent } : {},
      sceneWriteOutcome,
      ...codegenDirective ? { codegenDirective } : {}
    };
    const userAnswerLine = intent !== void 0 ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).` : null;
    const outcomeLine = buildOutcomeHumanLine({
      reason,
      ...errorMessage !== void 0 ? { errorMessage } : {},
      skippedDefinitionDueToAdr012: true
    });
    const adrBlock = buildAdr012PropagationParagraph({
      componentName,
      ...replicaCount !== void 0 ? { replicaCount } : {}
    });
    const proseParts = [userAnswerLine, outcomeLine, adrBlock].filter(
      (p) => p !== null
    );
    const prose = proseParts.join("\n\n");
    return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
  }
  function buildNoDefinitionFallbackBody(args) {
    const { ruleId, sceneNodeId, reason, errorMessage, intent } = args;
    const ackIntent = intent ? { kind: "property", field: intent.field, value: intent.value, scope: intent.scope } : void 0;
    const outcomeResult = reason === "silent-ignore" ? "silent-ignored" : reason === "override-error" ? "api-rejected" : "api-rejected";
    const sceneWriteOutcome = sceneOutcomeToAck(
      outcomeResult,
      reason === "silent-ignore" ? "silent-ignore-no-definition" : "no-definition-escalation"
    );
    const codegenDirective = intent !== void 0 ? buildCodegenDirective({ sceneNodeId, intent }) : void 0;
    const jsonBlock = {
      v: 1,
      ruleId,
      nodeId: sceneNodeId,
      ...ackIntent ? { intent: ackIntent } : {},
      sceneWriteOutcome,
      ...codegenDirective ? { codegenDirective } : {}
    };
    const userAnswerLine = intent !== void 0 ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).` : null;
    const outcomeLine = buildOutcomeHumanLine({
      reason,
      ...errorMessage !== void 0 ? { errorMessage } : {},
      skippedDefinitionDueToAdr012: false
    });
    const prose = [userAnswerLine, outcomeLine].filter((p) => p !== null).join("\n\n");
    return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
  }
  function buildDefinitionTierFailureBody(args) {
    const { ruleId, sceneNodeId, intent, kind, errorMessage } = args;
    const sceneWriteOutcome = sceneOutcomeToAck(
      kind === "read-only-library" ? "api-rejected" : "api-rejected",
      kind === "read-only-library" ? "definition-read-only" : "definition-write-failed"
    );
    const codegenDirective = intent !== void 0 ? buildCodegenDirective({ sceneNodeId, intent }) : void 0;
    const jsonBlock = {
      v: 1,
      ruleId,
      nodeId: sceneNodeId,
      ...intent ? {
        intent: {
          kind: "property",
          field: intent.field,
          value: intent.value,
          scope: intent.scope
        }
      } : {},
      sceneWriteOutcome,
      ...codegenDirective ? { codegenDirective } : {}
    };
    const human = kind === "read-only-library" ? "source component lives in an external library and is read-only from this file \u2014 apply the fix in the library file itself." : `could not apply at source definition: ${errorMessage}`;
    const userAnswerLine = intent !== void 0 ? `**User answered:** ${formatIntentValueForDisplay(intent.value)} for **${intent.field}** (scope: ${intent.scope}).` : null;
    const outcomeLine = `**Scene write outcome:** ${human}`;
    const prose = [userAnswerLine, outcomeLine].filter((p) => p !== null).join("\n\n");
    return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
  }
  function appendJsonFenceAndFooter(prose, jsonBlock, ruleId) {
    const footer = `\u2014 *${ruleId}*`;
    const hasIntent = jsonBlock.intent !== void 0;
    if (!hasIntent) {
      return `${prose}

${footer}`;
    }
    const jsonText = JSON.stringify(jsonBlock, null, 0);
    return `${prose}

${CANICODE_JSON_FENCE}
${jsonText}
\`\`\`

${footer}`;
  }
  function buildIntentionallyUnmappedAnnotationBody(args) {
    const { sceneNodeId, ruleId } = args;
    const intent = {
      kind: "rule-opt-out",
      ruleId
    };
    const jsonBlock = {
      v: 1,
      ruleId,
      nodeId: sceneNodeId,
      intent,
      sceneWriteOutcome: { result: "succeeded", reason: "rule-opt-out" }
    };
    const prose = "User marked this component as intentionally unmapped \u2014 canicode will skip the unmapped-component check for this node on subsequent analyze runs.";
    return appendJsonFenceAndFooter(prose, jsonBlock, ruleId);
  }
  var FENCED_JSON_RE = new RegExp(
    `${CANICODE_JSON_FENCE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*([\\s\\S]*?)\\s*\`\`\``,
    "m"
  );
  function parseCanicodeJsonPayloadFromMarkdown(text) {
    const m = FENCED_JSON_RE.exec(text);
    if (!m?.[1]) return void 0;
    try {
      const raw = JSON.parse(m[1].trim());
      if (!raw || typeof raw !== "object") return void 0;
      const o = raw;
      if (o.v !== 1 || typeof o.ruleId !== "string") return void 0;
      return raw;
    } catch {
      return void 0;
    }
  }

  // src/core/roundtrip/apply-with-instance-fallback.ts
  var DEFINITION_WRITE_SKIPPED_EVENT = "cic_roundtrip_definition_write_skipped";
  function categoryIdForAnnotate(categories, kind, roundtripIntent) {
    if (kind === "adr012-definition-skipped") {
      return categories.fallback;
    }
    if (roundtripIntent !== void 0) {
      return categories.gotcha;
    }
    return categories.flag;
  }
  function resolveSourceComponentName(definition, question) {
    if (definition && typeof definition.name === "string" && definition.name) {
      return definition.name;
    }
    const ic = question.instanceContext;
    if (ic && typeof ic.sourceComponentName === "string" && ic.sourceComponentName) {
      return ic.sourceComponentName;
    }
    return "the source component";
  }
  async function routeToDefinitionOrAnnotate(definition, writeFn, ctx) {
    if (definition && !ctx.allowDefinitionWrite && ctx.reason !== "non-override-error") {
      const componentName = resolveSourceComponentName(definition, ctx.question);
      const replicaCount = typeof ctx.question.replicas === "number" && Number.isInteger(ctx.question.replicas) ? ctx.question.replicas : void 0;
      if (ctx.categories) {
        upsertCanicodeAnnotation(ctx.scene, {
          ruleId: ctx.question.ruleId,
          markdown: buildDefinitionWriteSkippedBody({
            ruleId: ctx.question.ruleId,
            sceneNodeId: ctx.scene.id,
            componentName,
            reason: ctx.reason,
            ...ctx.errorMessage !== void 0 ? { errorMessage: ctx.errorMessage } : {},
            ...replicaCount !== void 0 ? { replicaCount } : {},
            ...ctx.roundtripIntent !== void 0 ? { intent: ctx.roundtripIntent } : {}
          }),
          categoryId: categoryIdForAnnotate(
            ctx.categories,
            "adr012-definition-skipped",
            ctx.roundtripIntent
          )
        });
      }
      ctx.telemetry?.(DEFINITION_WRITE_SKIPPED_EVENT, {
        ruleId: ctx.question.ruleId,
        reason: ctx.reason
      });
      return {
        icon: "\u{1F4DD}",
        label: "definition write skipped (opt-in disabled)"
      };
    }
    if (!definition) {
      if (ctx.categories) {
        const markdown = buildNoDefinitionFallbackBody({
          ruleId: ctx.question.ruleId,
          sceneNodeId: ctx.scene.id,
          reason: ctx.reason,
          ...ctx.errorMessage !== void 0 ? { errorMessage: ctx.errorMessage } : {},
          ...ctx.roundtripIntent !== void 0 ? { intent: ctx.roundtripIntent } : {}
        });
        upsertCanicodeAnnotation(ctx.scene, {
          ruleId: ctx.question.ruleId,
          markdown,
          categoryId: categoryIdForAnnotate(
            ctx.categories,
            "other-failure",
            ctx.roundtripIntent
          )
        });
      }
      return ctx.reason === "silent-ignore" ? { icon: "\u{1F4DD}", label: "silent-ignore, annotated" } : { icon: "\u{1F4DD}", label: `error: ${ctx.errorMessage ?? ""}` };
    }
    try {
      await writeFn(definition);
      return {
        icon: "\u{1F310}",
        label: ctx.reason === "silent-ignore" ? "source definition (silent-ignore fallback)" : "source definition"
      };
    } catch (defErr) {
      const defMsg = String(defErr?.message ?? defErr);
      const isRemoteReadOnly = definition.remote === true || /read-only/i.test(defMsg);
      if (ctx.categories) {
        upsertCanicodeAnnotation(ctx.scene, {
          ruleId: ctx.question.ruleId,
          markdown: buildDefinitionTierFailureBody({
            ruleId: ctx.question.ruleId,
            sceneNodeId: ctx.scene.id,
            ...ctx.roundtripIntent !== void 0 ? { intent: ctx.roundtripIntent } : {},
            kind: isRemoteReadOnly ? "read-only-library" : "definition-error",
            errorMessage: defMsg
          }),
          categoryId: categoryIdForAnnotate(
            ctx.categories,
            "other-failure",
            ctx.roundtripIntent
          )
        });
      }
      return {
        icon: "\u{1F4DD}",
        label: isRemoteReadOnly ? "external library (read-only)" : `definition error: ${defMsg}`
      };
    }
  }
  async function applyWithInstanceFallback(question, writeFn, context = {}) {
    const { categories, allowDefinitionWrite = false, telemetry, roundtripIntent } = context;
    const scene = await figma.getNodeByIdAsync(question.nodeId);
    if (!scene) return { icon: "\u{1F4DD}", label: "missing node" };
    const definition = question.sourceChildId ? await figma.getNodeByIdAsync(question.sourceChildId) : null;
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
          ...roundtripIntent !== void 0 ? { roundtripIntent } : {}
        });
      }
      return { icon: "\u2705", label: "instance/scene" };
    } catch (e) {
      const msg = String(e?.message ?? e);
      const looksLikeInstanceOverride = /cannot be overridden/i.test(msg) || /override/i.test(msg);
      if (!looksLikeInstanceOverride) {
        return routeToDefinitionOrAnnotate(null, writeFn, {
          question,
          scene,
          categories,
          reason: "non-override-error",
          errorMessage: msg,
          allowDefinitionWrite,
          telemetry,
          ...roundtripIntent !== void 0 ? { roundtripIntent } : {}
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
        ...roundtripIntent !== void 0 ? { roundtripIntent } : {}
      });
    }
  }

  // src/core/roundtrip/apply-property-mod.ts
  async function resolveVariableByName(name) {
    const locals = await figma.variables.getLocalVariablesAsync();
    return locals.find((v) => v.name === name) ?? null;
  }
  function parseValue(raw) {
    if (raw && typeof raw === "object" && "variable" in raw) {
      const v = raw;
      const parsed = { kind: "binding", name: v.variable };
      if ("fallback" in v) parsed.fallback = v.fallback;
      return parsed;
    }
    if (raw && typeof raw === "object" && "fallback" in raw) {
      return { kind: "scalar", scalar: raw.fallback };
    }
    return { kind: "scalar", scalar: raw };
  }
  function isPaintProp(prop) {
    return prop === "fills" || prop === "strokes";
  }
  function applyPropertyBinding(target, prop, variable) {
    if (isPaintProp(prop)) {
      const current = target[prop];
      if (current === figma.mixed || !Array.isArray(current)) return false;
      const paints = current;
      const bound = paints.map(
        (paint) => figma.variables.setBoundVariableForPaint(paint, "color", variable)
      );
      target[prop] = bound;
      return true;
    }
    target.setBoundVariable(prop, variable);
    return true;
  }
  function buildRoundtripIntentFromPropertyAnswer(question, answerValue) {
    const raw = question.targetProperty;
    if (raw === void 0) return void 0;
    const props = Array.isArray(raw) ? raw : [raw];
    if (props.length === 0) return void 0;
    if (props.length === 1) {
      const prop = props[0];
      const perProp = answerValue && typeof answerValue === "object" && !("variable" in answerValue) && !Array.isArray(answerValue) ? answerValue[prop] : answerValue;
      const parsed = parseValueForIntent(perProp);
      if (parsed === void 0) return void 0;
      return { field: prop, value: parsed, scope: "instance" };
    }
    const obj = answerValue && typeof answerValue === "object" && !("variable" in answerValue) && !Array.isArray(answerValue) ? answerValue : void 0;
    const picked = {};
    for (const p of props) {
      if (obj && p in obj && obj[p] !== void 0) picked[p] = obj[p];
    }
    if (Object.keys(picked).length === 0) return void 0;
    return {
      field: props.join(", "),
      value: picked,
      scope: "instance"
    };
  }
  function parseValueForIntent(raw) {
    if (raw && typeof raw === "object" && "variable" in raw) {
      return { variable: raw.variable };
    }
    if (raw && typeof raw === "object" && "fallback" in raw) {
      return raw.fallback;
    }
    return raw;
  }
  function applyPropertyScalar(target, prop, scalar) {
    const rec = target;
    const before = rec[prop];
    rec[prop] = scalar;
    if (rec[prop] === before && before !== scalar) return false;
    return true;
  }
  async function applyPropertyMod(question, answerValue, context = {}) {
    const roundtripIntent = buildRoundtripIntentFromPropertyAnswer(
      question,
      answerValue
    );
    const props = Array.isArray(question.targetProperty) ? question.targetProperty : question.targetProperty !== void 0 ? [question.targetProperty] : [];
    return applyWithInstanceFallback(
      question,
      async (target) => {
        if (!target) return void 0;
        let changed = void 0;
        for (const prop of props) {
          if (!(prop in target)) continue;
          const perProp = answerValue && typeof answerValue === "object" && !("variable" in answerValue) && !Array.isArray(answerValue) ? answerValue[prop] : answerValue;
          const parsed = parseValue(perProp);
          if (parsed.kind === "binding") {
            const variable = await resolveVariableByName(parsed.name);
            if (variable) {
              applyPropertyBinding(target, prop, variable);
              continue;
            }
            if (parsed.fallback !== void 0) {
              if (!applyPropertyScalar(target, prop, parsed.fallback)) {
                changed = false;
              }
            }
            continue;
          }
          if (parsed.scalar === void 0) continue;
          if (!applyPropertyScalar(target, prop, parsed.scalar)) {
            changed = false;
          }
        }
        return changed;
      },
      {
        ...context,
        ...roundtripIntent !== void 0 ? { roundtripIntent } : {}
      }
    );
  }

  // src/core/roundtrip/probe-definition-writability.ts
  async function probeDefinitionWritability(questions) {
    const verdict = /* @__PURE__ */ new Map();
    const unwritableNames = [];
    const seenName = /* @__PURE__ */ new Set();
    for (const q of questions) {
      const id = q.sourceChildId;
      if (!id) continue;
      if (verdict.has(id)) continue;
      const node = await figma.getNodeByIdAsync(id);
      const writability = resolveWritability(node);
      const isUnwritable = writability.isUnwritable;
      verdict.set(id, isUnwritable ? "unwritable" : "writable");
      if (isUnwritable) {
        const name = typeof writability.componentName === "string" && writability.componentName || typeof node?.name === "string" && node.name || q.instanceContext?.sourceComponentName || id;
        if (!seenName.has(name)) {
          seenName.add(name);
          unwritableNames.push(name);
        }
      }
    }
    const totalCount = verdict.size;
    let unwritableCount = 0;
    for (const v of verdict.values()) if (v === "unwritable") unwritableCount++;
    return {
      totalCount,
      unwritableCount,
      unwritableSourceNames: unwritableNames,
      allUnwritable: totalCount > 0 && unwritableCount === totalCount,
      partiallyUnwritable: unwritableCount > 0 && unwritableCount < totalCount
    };
  }
  function resolveWritability(node) {
    if (node === null) return { isUnwritable: true };
    if ("remote" in node && typeof node.remote === "boolean") {
      return { isUnwritable: node.remote === true };
    }
    const containing = findContainingComponent(node);
    if (!containing) {
      return { isUnwritable: false };
    }
    const isUnwritable = "remote" in containing && containing.remote === true;
    return {
      isUnwritable,
      ...isUnwritable && typeof containing.name === "string" ? { componentName: containing.name } : {}
    };
  }
  function findContainingComponent(node) {
    let cur = node;
    for (let i = 0; i < 100 && cur; i++) {
      if (cur.type === "COMPONENT" || cur.type === "COMPONENT_SET") return cur;
      cur = cur.parent ?? null;
    }
    return null;
  }

  // src/core/roundtrip/read-acknowledgments.ts
  var FOOTER_RE = /—\s+\*([A-Za-z0-9-]+)\*\s*$/;
  var LEGACY_PREFIX_RE = /^\*\*\[canicode\]\s+([A-Za-z0-9-]+)\*\*/;
  function extractAcknowledgmentsFromNode(node, canicodeCategoryIds) {
    if (!node || !("annotations" in node)) return [];
    const annotations = node.annotations ?? [];
    if (annotations.length === 0) return [];
    const out = [];
    for (const a of annotations) {
      const text = (typeof a.labelMarkdown === "string" && a.labelMarkdown.length > 0 ? a.labelMarkdown : "") || (typeof a.label === "string" && a.label.length > 0 ? a.label : "");
      if (!text) continue;
      if (canicodeCategoryIds) {
        if (!a.categoryId || !canicodeCategoryIds.has(a.categoryId)) continue;
      }
      const ruleId = extractRuleId(text);
      if (!ruleId) continue;
      const payload = parseCanicodeJsonPayloadFromMarkdown(text);
      const payloadAligned = payload && payload.ruleId === ruleId;
      out.push({
        nodeId: node.id,
        ruleId,
        ...payloadAligned && payload.intent ? { intent: payload.intent } : {},
        ...payloadAligned && payload.sceneWriteOutcome ? { sceneWriteOutcome: payload.sceneWriteOutcome } : {},
        ...payloadAligned && payload.codegenDirective ? { codegenDirective: payload.codegenDirective } : {}
      });
    }
    return out;
  }
  function extractRuleId(text) {
    const footer = FOOTER_RE.exec(text);
    if (footer) return footer[1] ?? null;
    const legacy = LEGACY_PREFIX_RE.exec(text);
    if (legacy) return legacy[1] ?? null;
    return null;
  }
  async function readCanicodeAcknowledgments(rootNodeId, categories) {
    const root = await figma.getNodeByIdAsync(rootNodeId);
    if (!root) return [];
    const canicodeCategoryIds = categories ? new Set(
      [
        categories.gotcha,
        categories.flag,
        categories.fallback,
        categories.legacyAutoFix
      ].filter((id) => typeof id === "string" && id.length > 0)
    ) : void 0;
    const out = [];
    walk(root, canicodeCategoryIds, out);
    return out;
  }
  function safeChildren(node) {
    try {
      const c = node.children;
      return Array.isArray(c) ? c : [];
    } catch {
      return [];
    }
  }
  function walk(node, canicodeCategoryIds, out) {
    try {
      const local = extractAcknowledgmentsFromNode(node, canicodeCategoryIds);
      for (const a of local) out.push(a);
    } catch {
    }
    for (const child of safeChildren(node)) {
      if (child && typeof child === "object") walk(child, canicodeCategoryIds, out);
    }
  }

  // src/core/roundtrip/apply-unmapped-component-opt-out.ts
  async function applyUnmappedComponentOptOut(input, context) {
    const { nodeId, ruleId } = input;
    const { categories } = context;
    const scene = await figma.getNodeByIdAsync(nodeId);
    if (!scene) {
      return { icon: "\u{1F4DD}", label: `missing node \u2014 ${ruleId}` };
    }
    const markdown = buildIntentionallyUnmappedAnnotationBody({
      sceneNodeId: scene.id,
      ruleId
    });
    upsertCanicodeAnnotation(scene, {
      ruleId,
      markdown,
      categoryId: categories.gotcha
    });
    return { icon: "\u{1F4DD}", label: `opt-out annotation written \u2014 ${ruleId}` };
  }

  // src/core/roundtrip/compute-roundtrip-tally.ts
  function computeRoundtripTally(args) {
    const { stepFourReport, reanalyzeResponse } = args;
    const { resolved, annotated, definitionWritten, skipped } = stepFourReport;
    const { issueCount, acknowledgedCount } = reanalyzeResponse;
    if (acknowledgedCount > issueCount) {
      throw new Error(
        `computeRoundtripTally: reanalyzeResponse.acknowledgedCount (${acknowledgedCount}) cannot exceed issueCount (${issueCount}). Acknowledged issues are a subset of remaining issues.`
      );
    }
    return {
      X: resolved,
      Y: annotated,
      Z: definitionWritten,
      W: skipped,
      N: resolved + annotated + definitionWritten + skipped,
      V: issueCount,
      V_ack: acknowledgedCount,
      V_open: issueCount - acknowledgedCount
    };
  }

  // src/core/roundtrip/apply-auto-fix.ts
  function pickNodeName(issue, resolved) {
    if (resolved && typeof resolved.name === "string" && resolved.name.length > 0) {
      return resolved.name;
    }
    if (typeof issue.nodePath === "string" && issue.nodePath.length > 0) {
      const segments = issue.nodePath.split(/\s*[›>/]\s*/);
      const tail = segments[segments.length - 1];
      if (tail && tail.length > 0) return tail;
    }
    return issue.nodeId;
  }
  function mapInstanceFallbackIcon(result) {
    if (result.icon === "\u2705") return "\u{1F527}";
    return result.icon;
  }
  async function applyAutoFix(issue, context) {
    const { categories } = context;
    const ruleId = issue.ruleId;
    if (issue.targetProperty === "name" && typeof issue.suggestedName === "string") {
      const suggestedName = issue.suggestedName;
      const question = {
        nodeId: issue.nodeId,
        ruleId,
        ...issue.sourceChildId ? { sourceChildId: issue.sourceChildId } : {}
      };
      const result = await applyWithInstanceFallback(
        question,
        (target) => {
          if (target) {
            target.name = suggestedName;
          }
        },
        {
          categories,
          ...context.allowDefinitionWrite !== void 0 ? { allowDefinitionWrite: context.allowDefinitionWrite } : {},
          ...context.telemetry !== void 0 ? { telemetry: context.telemetry } : {}
        }
      );
      const sceneAfter = await figma.getNodeByIdAsync(issue.nodeId);
      return {
        outcome: mapInstanceFallbackIcon(result),
        nodeId: issue.nodeId,
        nodeName: pickNodeName(issue, sceneAfter),
        ruleId,
        label: result.label
      };
    }
    const scene = await figma.getNodeByIdAsync(issue.nodeId);
    const markdown = issue.message ?? `Auto-flagged: ${ruleId}`;
    if (scene) {
      upsertCanicodeAnnotation(scene, {
        ruleId,
        markdown,
        categoryId: categories.flag,
        ...issue.annotationProperties && issue.annotationProperties.length > 0 ? { properties: issue.annotationProperties } : {}
      });
    }
    return {
      outcome: "\u{1F4DD}",
      nodeId: issue.nodeId,
      nodeName: pickNodeName(issue, scene),
      ruleId,
      label: scene ? `annotation added to canicode:flag \u2014 ${ruleId}` : `missing node (annotation skipped) \u2014 ${ruleId}`
    };
  }
  async function applyAutoFixes(issues, context) {
    const out = [];
    for (const issue of issues) {
      if (issue.applyStrategy !== "auto-fix") {
        out.push({
          outcome: "\u23ED\uFE0F",
          nodeId: issue.nodeId,
          nodeName: pickNodeName(issue, null),
          ruleId: issue.ruleId,
          label: `skipped \u2014 applyStrategy is ${issue.applyStrategy ?? "absent"}`
        });
        continue;
      }
      out.push(await applyAutoFix(issue, context));
    }
    return out;
  }

  // src/core/roundtrip/apply-componentize.ts
  var COMPONENTIZE_EVENT = "cic_roundtrip_componentize";
  function isInsideInstance(node) {
    let current = node.parent;
    while (current) {
      if (current.type === "INSTANCE") return true;
      current = current.parent;
    }
    return false;
  }
  function isFreeFormParent(node) {
    const parent = node.parent;
    if (!parent) return true;
    const layoutMode = parent["layoutMode"];
    return layoutMode === void 0 || layoutMode === "NONE";
  }
  function resolveFinalName(desired, existing) {
    if (!existing.has(desired)) {
      return { finalName: desired, collisionResolved: false };
    }
    let counter = 2;
    while (existing.has(`${desired} ${counter}`)) counter++;
    return { finalName: `${desired} ${counter}`, collisionResolved: true };
  }
  function annotateFallback(node, ruleId, categories, body) {
    if (!categories) return;
    upsertCanicodeAnnotation(node, {
      ruleId,
      markdown: body,
      categoryId: categories.flag
    });
  }
  function applyComponentize(options) {
    const { node, existingComponentNames, ruleId, categories, telemetry } = options;
    if (isInsideInstance(node)) {
      annotateFallback(
        node,
        ruleId,
        categories,
        `**Componentize skipped \u2014 node is inside an INSTANCE subtree.**

Re-running ${ruleId} componentize on a node inside an instance would either throw or destructively detach the surrounding instance (see roundtrip-protocol.md:286). Move the source frame outside the instance, or detach the parent instance intentionally before componentizing.`
      );
      telemetry?.(COMPONENTIZE_EVENT, {
        ruleId,
        outcome: "skipped-inside-instance"
      });
      return {
        icon: "\u{1F4DD}",
        label: "componentize skipped: inside instance",
        outcome: "skipped-inside-instance"
      };
    }
    if (isFreeFormParent(node)) {
      annotateFallback(
        node,
        ruleId,
        categories,
        `**Componentize skipped \u2014 parent has no Auto Layout.**

Componentizing and swapping siblings under a free-form parent would require manual coordinate carryover that can mangle layout silently (ADR-023 decision A). Wrap the duplicates in an Auto Layout frame first, then re-run the roundtrip.`
      );
      telemetry?.(COMPONENTIZE_EVENT, {
        ruleId,
        outcome: "skipped-free-form-parent"
      });
      return {
        icon: "\u{1F4DD}",
        label: "componentize skipped: free-form parent",
        outcome: "skipped-free-form-parent"
      };
    }
    const desiredName = typeof node.name === "string" ? node.name : "Component";
    const { finalName, collisionResolved } = resolveFinalName(
      desiredName,
      existingComponentNames
    );
    const create = figma.createComponentFromNode;
    if (typeof create !== "function") {
      annotateFallback(
        node,
        ruleId,
        categories,
        `**Componentize skipped \u2014 \`figma.createComponentFromNode\` unavailable.**

The Plugin API host did not expose the Create component primitive in this session. The FRAME has been flagged so the next roundtrip can retry.`
      );
      telemetry?.(COMPONENTIZE_EVENT, {
        ruleId,
        outcome: "error",
        reason: "createComponentFromNode-missing"
      });
      return {
        icon: "\u{1F4DD}",
        label: "componentize skipped: createComponentFromNode unavailable",
        outcome: "error"
      };
    }
    try {
      const created = create.call(figma, node);
      created.name = finalName;
      telemetry?.(COMPONENTIZE_EVENT, {
        ruleId,
        outcome: "componentized",
        nameCollisionResolved: collisionResolved
      });
      const result = {
        icon: "\u2705",
        label: collisionResolved ? `componentized as "${finalName}" (renamed from collision)` : `componentized as "${finalName}"`,
        outcome: "componentized",
        newComponentId: created.id,
        finalName
      };
      if (collisionResolved) result.nameCollisionResolved = true;
      return result;
    } catch (e) {
      const msg = String(e?.message ?? e);
      annotateFallback(
        node,
        ruleId,
        categories,
        `**Componentize failed \u2014 \`createComponentFromNode\` threw.**

Error: \`${msg}\`. The FRAME has been flagged so the designer can inspect the structure (locked layer, unsupported child mix, etc.) before the next roundtrip pass.`
      );
      telemetry?.(COMPONENTIZE_EVENT, {
        ruleId,
        outcome: "error",
        reason: msg
      });
      return {
        icon: "\u{1F4DD}",
        label: `componentize failed: ${msg}`,
        outcome: "error"
      };
    }
  }

  // src/core/roundtrip/apply-replace-with-instance.ts
  var REPLACE_EVENT = "cic_roundtrip_replace_with_instance";
  function isFreeFormParent2(parent) {
    if (!parent) return true;
    const layoutMode = parent["layoutMode"];
    return layoutMode === void 0 || layoutMode === "NONE";
  }
  function annotateFallback2(node, ruleId, categories, body) {
    if (!node || !categories) return;
    upsertCanicodeAnnotation(node, {
      ruleId,
      markdown: body,
      categoryId: categories.flag
    });
  }
  function isComponentLike(type) {
    return type === "COMPONENT" || type === "COMPONENT_SET";
  }
  async function applyReplaceWithInstance(options) {
    const { mainComponentId, targetNodeId, ruleId, categories, telemetry } = options;
    const [target, main] = await Promise.all([
      figma.getNodeByIdAsync(targetNodeId),
      figma.getNodeByIdAsync(mainComponentId)
    ]);
    if (!target) {
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-prereq-missing",
        reason: "target-missing"
      });
      return {
        icon: "\u{1F4DD}",
        label: `replace skipped: target node ${targetNodeId} missing`,
        outcome: "skipped-prereq-missing"
      };
    }
    if (!main) {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 main component \`${mainComponentId}\` not found.**

The componentize step (delta 1) likely failed earlier in this batch, or the main was deleted between componentize and swap. The FRAME has been flagged so the next roundtrip pass can re-derive the group.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-prereq-missing",
        reason: "main-missing"
      });
      return {
        icon: "\u{1F4DD}",
        label: `replace skipped: main ${mainComponentId} missing`,
        outcome: "skipped-prereq-missing"
      };
    }
    if (!isComponentLike(main.type)) {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 \`${mainComponentId}\` is not a COMPONENT.**

Resolved to a \`${main.type}\` node. Phase 3's swap step requires the main to be a \`COMPONENT\` or \`COMPONENT_SET\`. Check that componentize ran cleanly on the source frame before this call.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-prereq-missing",
        reason: "main-not-component",
        resolvedType: main.type
      });
      return {
        icon: "\u{1F4DD}",
        label: `replace skipped: main is ${main.type}, not COMPONENT`,
        outcome: "skipped-prereq-missing"
      };
    }
    if (target.id === main.id) {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 target and main are the same node.**

This usually means the componentize source was passed in the swap set by mistake. The componentize source becomes the main; only the remaining sibling FRAMEs should be swapped.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-prereq-missing",
        reason: "target-is-main"
      });
      return {
        icon: "\u{1F4DD}",
        label: "replace skipped: target equals main",
        outcome: "skipped-prereq-missing"
      };
    }
    const parent = target.parent;
    if (!parent) {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 target has no parent.**

Cannot insert a new instance for an orphaned node. The FRAME has been flagged; no swap performed.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-prereq-missing",
        reason: "no-parent"
      });
      return {
        icon: "\u{1F4DD}",
        label: "replace skipped: no parent",
        outcome: "skipped-prereq-missing"
      };
    }
    if (isFreeFormParent2(parent)) {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 parent has no Auto Layout.**

Swapping a sibling FRAME with an instance under a free-form parent would require explicit coordinate carryover that can mangle layout silently (ADR-023 decision A). Wrap the duplicates in an Auto Layout frame first, then re-run the roundtrip.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "skipped-free-form-parent"
      });
      return {
        icon: "\u{1F4DD}",
        label: "replace skipped: free-form parent",
        outcome: "skipped-free-form-parent"
      };
    }
    const create = main.createInstance;
    if (typeof create !== "function") {
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace skipped \u2014 \`createInstance\` unavailable on main.**

The Plugin API host did not expose \`createInstance\` on the resolved main (\`${main.type}\`). The FRAME has been flagged so the next roundtrip can retry once the host catches up.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "error",
        reason: "createInstance-missing"
      });
      return {
        icon: "\u{1F4DD}",
        label: "replace skipped: createInstance unavailable",
        outcome: "error"
      };
    }
    try {
      const instance = create.call(main);
      const siblings = parent.children ?? [];
      const idx = siblings.findIndex((s) => s.id === target.id);
      const insert = parent.insertChild;
      const append = parent.appendChild;
      if (idx >= 0 && typeof insert === "function") {
        insert.call(parent, idx, instance);
      } else if (typeof append === "function") {
        append.call(parent, instance);
      } else {
        throw new Error(
          "parent exposes neither insertChild nor appendChild \u2014 cannot insert instance"
        );
      }
      if (typeof target.remove === "function") {
        target.remove();
      } else {
        throw new Error("target node missing `remove` \u2014 cannot detach old FRAME");
      }
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "replaced"
      });
      return {
        icon: "\u2705",
        label: `replaced with instance of "${main.name}"`,
        outcome: "replaced",
        newInstanceId: instance.id
      };
    } catch (e) {
      const msg = String(e?.message ?? e);
      annotateFallback2(
        target,
        ruleId,
        categories,
        `**Replace failed \u2014 Plugin API threw.**

Error: \`${msg}\`. The FRAME has been flagged so the designer can inspect (locked layer, parent restrictions, etc.) before the next roundtrip pass.`
      );
      telemetry?.(REPLACE_EVENT, {
        ruleId,
        outcome: "error",
        reason: msg
      });
      return {
        icon: "\u{1F4DD}",
        label: `replace failed: ${msg}`,
        outcome: "error"
      };
    }
  }

  // src/core/roundtrip/apply-group-componentize.ts
  function summarizeReplaceCounts(results) {
    const total = results.length;
    if (total === 0) return "";
    const replaced = results.filter((r) => r.outcome === "replaced").length;
    const reasons = [];
    const freeForm = results.filter(
      (r) => r.outcome === "skipped-free-form-parent"
    ).length;
    const prereq = results.filter(
      (r) => r.outcome === "skipped-prereq-missing"
    ).length;
    const error = results.filter((r) => r.outcome === "error").length;
    if (freeForm > 0) reasons.push(`${freeForm} free-form parent`);
    if (prereq > 0) reasons.push(`${prereq} prereq missing`);
    if (error > 0) reasons.push(`${error} error`);
    const tail = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
    return `swapped ${replaced}/${total} siblings${tail}`;
  }
  async function applyGroupComponentize(options) {
    const { question, existingComponentNames, categories, telemetry } = options;
    const members = question.groupMembers;
    const firstId = members[0];
    if (firstId === void 0) {
      return {
        outcome: "missing-first-member",
        replaceResults: [],
        summary: "group componentize skipped: no members in group"
      };
    }
    const firstNode = await figma.getNodeByIdAsync(firstId);
    if (!firstNode) {
      return {
        outcome: "missing-first-member",
        replaceResults: [],
        summary: `group componentize skipped: first member ${firstId} not found`
      };
    }
    const componentizeResult = applyComponentize({
      node: firstNode,
      existingComponentNames,
      ruleId: question.ruleId,
      ...categories !== void 0 ? { categories } : {},
      ...telemetry !== void 0 ? { telemetry } : {}
    });
    if (componentizeResult.outcome !== "componentized") {
      return {
        outcome: "componentize-failed",
        componentizeResult,
        replaceResults: [],
        summary: `group componentize skipped: ${componentizeResult.label}`
      };
    }
    const newComponentId = componentizeResult.newComponentId;
    const swapTargets = members.slice(1);
    const replaceResults = [];
    for (const targetId of swapTargets) {
      const r = await applyReplaceWithInstance({
        mainComponentId: newComponentId,
        targetNodeId: targetId,
        ruleId: question.ruleId,
        ...categories !== void 0 ? { categories } : {},
        ...telemetry !== void 0 ? { telemetry } : {}
      });
      replaceResults.push(r);
    }
    const swapSummary = summarizeReplaceCounts(replaceResults);
    const finalName = componentizeResult.finalName ?? "(unnamed)";
    const summary = swapSummary.length > 0 ? `componentized "${finalName}", ${swapSummary}` : `componentized "${finalName}"`;
    return {
      outcome: "componentized-and-swapped",
      componentizeResult,
      replaceResults,
      summary
    };
  }

  // src/core/roundtrip/remove-canicode-annotations.ts
  var LEGACY_CANICODE_PREFIX = "**[canicode]";
  function isCanicodeAnnotation(annotation, categories) {
    const canicodeIds = new Set(
      [
        categories.gotcha,
        categories.flag,
        categories.fallback,
        categories.legacyAutoFix
      ].filter((id) => Boolean(id))
    );
    if (annotation.categoryId && canicodeIds.has(annotation.categoryId)) {
      return true;
    }
    if (annotation.labelMarkdown?.startsWith(LEGACY_CANICODE_PREFIX)) {
      return true;
    }
    return false;
  }
  function removeCanicodeAnnotations(annotations, categories) {
    return annotations.filter((a) => !isCanicodeAnnotation(a, categories));
  }

  exports.applyAutoFix = applyAutoFix;
  exports.applyAutoFixes = applyAutoFixes;
  exports.applyComponentize = applyComponentize;
  exports.applyGroupComponentize = applyGroupComponentize;
  exports.applyPropertyMod = applyPropertyMod;
  exports.applyReplaceWithInstance = applyReplaceWithInstance;
  exports.applyUnmappedComponentOptOut = applyUnmappedComponentOptOut;
  exports.applyWithInstanceFallback = applyWithInstanceFallback;
  exports.buildIntentionallyUnmappedAnnotationBody = buildIntentionallyUnmappedAnnotationBody;
  exports.computeRoundtripTally = computeRoundtripTally;
  exports.ensureCanicodeCategories = ensureCanicodeCategories;
  exports.extractAcknowledgmentsFromNode = extractAcknowledgmentsFromNode;
  exports.isCanicodeAnnotation = isCanicodeAnnotation;
  exports.probeDefinitionWritability = probeDefinitionWritability;
  exports.readCanicodeAcknowledgments = readCanicodeAcknowledgments;
  exports.removeCanicodeAnnotations = removeCanicodeAnnotations;
  exports.resolveVariableByName = resolveVariableByName;
  exports.stripAnnotations = stripAnnotations;
  exports.upsertCanicodeAnnotation = upsertCanicodeAnnotation;

  return exports;

})({});
