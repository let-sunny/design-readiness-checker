import type { InstanceContext } from "../contracts/gotcha-survey.js";
import { isInstanceChildNodeId } from "../adapters/instance-id-parser.js";

/**
 * Write strategy for a gotcha apply target. Consumers can branch on this enum
 * without parsing the human-readable `guidance` string.
 *
 * - `scene-only`: plain scene node id, no instance handling needed.
 * - `prefer-definition`: instance-child id + resolved `instanceContext`; layout
 *   and min/max writes should go to the definition node after user confirmation.
 * - `definition-unknown`: instance-child id but `instanceContext` is missing;
 *   caller must resolve the source component at runtime.
 */
export type GotchaApplyStrategy =
  | "scene-only"
  | "prefer-definition"
  | "definition-unknown";

/**
 * Resolved targets for applying gotcha fixes in Figma (Plugin API or MCP `use_figma`).
 *
 * Survey questions may include `instanceContext` when the violation `nodeId` is an
 * instance-child id (`I...;...`). Property overrides often fail on those scene nodes;
 * the definition node id is the usual write target after user confirmation.
 */
export type GotchaApplyResolution = {
  /** Scene node id from the survey (`question.nodeId`). */
  sceneNodeId: string;
  /** Source definition node id from `instanceContext.sourceNodeId`, when known. */
  definitionNodeId: string | undefined;
  /** Machine-readable write strategy — branch on this from TS consumers. */
  strategy: GotchaApplyStrategy;
  /**
   * Opt-in hints for the caller. Fields in this namespace take effect ONLY
   * when the caller has enabled `allowDefinitionWrite` on the roundtrip helper.
   * Under the ADR-012 default (opt-in off), these are informational — the
   * actual write still routes to scene-then-annotate regardless.
   *
   * ADR-012 Q5: future per-rule opt-in fields grow under this namespace.
   */
  optIn: {
    /**
     * Hint that the definition node is the better write target for layout and
     * min/max size-constraint writes on this node. Takes effect only when
     * `allowDefinitionWrite` is enabled — otherwise the helper annotates the
     * scene and names the source component without propagating.
     */
    preferDefinitionForLayoutProps: boolean;
  };
  /**
   * Human-readable note for skills, UI, or logs. Skill-oriented (may reference
   * Plugin API calls like `getMainComponentAsync`). TS consumers should branch
   * on `strategy` instead of parsing this string.
   */
  guidance: string;
};

/**
 * Resolve which node ids and policy apply for a gotcha survey question.
 */
export function resolveGotchaApplyTarget(
  nodeId: string,
  instanceContext: InstanceContext | undefined,
): GotchaApplyResolution {
  if (instanceContext) {
    const componentPhrase = instanceContext.sourceComponentName
      ? `inside component ${instanceContext.sourceComponentName}`
      : "inside the source component";
    return {
      sceneNodeId: nodeId,
      definitionNodeId: instanceContext.sourceNodeId,
      strategy: "prefer-definition",
      optIn: { preferDefinitionForLayoutProps: true },
      guidance:
        `This question targets a node inside an instance. Overrides may fail on the scene node. ` +
        `For layout and min/max sizing, apply changes on node ${instanceContext.sourceNodeId} ` +
        `${componentPhrase} (parent instance ${instanceContext.parentInstanceNodeId}). ` +
        `Confirm with the user first — definition edits propagate to every instance of that component in the file.`,
    };
  }

  if (isInstanceChildNodeId(nodeId)) {
    return {
      sceneNodeId: nodeId,
      definitionNodeId: undefined,
      strategy: "definition-unknown",
      optIn: { preferDefinitionForLayoutProps: true },
      guidance:
        "The node id looks like a Figma instance child (`I...;...`) but no `instanceContext` was attached. " +
        "Parse the segment after the last `;` as the source definition id, resolve the parent INSTANCE, " +
        "and use `getMainComponentAsync()` when `figma.getNodeById(sourceId)` is not enough (e.g. nested instances).",
    };
  }

  return {
    sceneNodeId: nodeId,
    definitionNodeId: undefined,
    strategy: "scene-only",
    optIn: { preferDefinitionForLayoutProps: false },
    guidance: "",
  };
}
