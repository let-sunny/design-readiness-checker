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

  // src/core/roundtrip/apply-with-instance-fallback.ts
  var DEFINITION_WRITE_SKIPPED_EVENT = "cic_roundtrip_definition_write_skipped";
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
      if (ctx.categories) {
        upsertCanicodeAnnotation(ctx.scene, {
          ruleId: ctx.question.ruleId,
          markdown: `Apply this fix on the source component **${componentName}** to share across all instances. This instance kept its current value to avoid unintended fan-out. Re-run with \`allowDefinitionWrite: true\` to propagate.`,
          categoryId: ctx.categories.fallback
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
        const markdown = ctx.reason === "silent-ignore" ? "write accepted but value unchanged; no definition available" : ctx.reason === "override-error" ? `could not apply automatically: ${ctx.errorMessage ?? ""}` : `could not apply automatically: ${ctx.errorMessage ?? ""}`;
        upsertCanicodeAnnotation(ctx.scene, {
          ruleId: ctx.question.ruleId,
          markdown,
          categoryId: ctx.categories.fallback
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
          markdown: isRemoteReadOnly ? "source component lives in an external library and is read-only from this file \u2014 apply the fix in the library file itself." : `could not apply at source definition: ${defMsg}`,
          categoryId: ctx.categories.fallback
        });
      }
      return {
        icon: "\u{1F4DD}",
        label: isRemoteReadOnly ? "external library (read-only)" : `definition error: ${defMsg}`
      };
    }
  }
  async function applyWithInstanceFallback(question, writeFn, context = {}) {
    const { categories, allowDefinitionWrite = false, telemetry } = context;
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
          telemetry
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
          telemetry
        });
      }
      return routeToDefinitionOrAnnotate(definition, writeFn, {
        question,
        scene,
        categories,
        reason: "override-error",
        errorMessage: msg,
        allowDefinitionWrite,
        telemetry
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
  function applyPropertyScalar(target, prop, scalar) {
    const rec = target;
    const before = rec[prop];
    rec[prop] = scalar;
    if (rec[prop] === before && before !== scalar) return false;
    return true;
  }
  async function applyPropertyMod(question, answerValue, context = {}) {
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
      context
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

  exports.applyPropertyMod = applyPropertyMod;
  exports.applyWithInstanceFallback = applyWithInstanceFallback;
  exports.ensureCanicodeCategories = ensureCanicodeCategories;
  exports.probeDefinitionWritability = probeDefinitionWritability;
  exports.resolveVariableByName = resolveVariableByName;
  exports.stripAnnotations = stripAnnotations;
  exports.upsertCanicodeAnnotation = upsertCanicodeAnnotation;

  return exports;

})({});
