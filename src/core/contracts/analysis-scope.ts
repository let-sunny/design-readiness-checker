import { z } from "zod";
import type { AnalysisNode } from "./figma-node.js";

/**
 * #404: Analysis scope — what the user is asking canicode to reason about.
 *
 * - `page`: full screen / section / layout. Container frames are
 *   responsible for bounds; repetition detection is meaningful; rules
 *   that assume "this is a self-contained screen" apply.
 * - `component`: standalone reusable UI unit (COMPONENT / COMPONENT_SET
 *   / INSTANCE analyzed in isolation). Root FILL is the design contract
 *   rather than a missing bound; repetition detection is generally a
 *   false signal because a component is itself the unit of reuse.
 *
 * The enum is intentionally two-valued; multi-scope analysis (analyzing
 * a page and its inner components in one run) is explicitly out of scope
 * per the issue. Each rule decides how (or whether) to switch on `scope`;
 * this PR only carries the context. Rule-level consumption lands in
 * follow-up PRs (e.g. #403 for `missing-size-constraint`).
 */
export const AnalysisScopeSchema = z.enum(["page", "component"]);
export type AnalysisScope = z.infer<typeof AnalysisScopeSchema>;

/**
 * Figma node types that unambiguously indicate a component-scope analysis
 * when they appear as the analysis **root**.
 *
 * - `COMPONENT` / `COMPONENT_SET`: the design unit IS the component.
 * - `INSTANCE`: the root is a reusable unit's placement; treating it as
 *   component scope keeps rules like `missing-size-constraint` from
 *   demanding bounds on a node whose bounds are the container's job.
 *
 * Any other root type (`FRAME`, `SECTION`, `CANVAS`, `DOCUMENT`, `GROUP`,
 * etc.) resolves to page scope — the common case for analyzing a screen
 * or page section via `?node-id=...`.
 */
const COMPONENT_SCOPE_ROOT_TYPES = new Set(["COMPONENT", "COMPONENT_SET", "INSTANCE"]);

/**
 * Deterministically detect analysis scope from the root node type. Returns
 * `"component"` for `COMPONENT` / `COMPONENT_SET` / `INSTANCE` roots, and
 * `"page"` for everything else.
 *
 * The CLI / MCP layer may override this with an explicit `scope` flag when
 * the user knows the heuristic mis-detects (e.g. analyzing a FRAME that
 * ships as a standalone design-system example rather than a screen).
 */
export function detectAnalysisScope(rootNode: AnalysisNode): AnalysisScope {
  return COMPONENT_SCOPE_ROOT_TYPES.has(rootNode.type) ? "component" : "page";
}
