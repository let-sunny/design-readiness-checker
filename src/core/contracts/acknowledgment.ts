import { z } from "zod";

/**
 * Acknowledgment marker — surfaced from a Figma Dev Mode annotation that
 * canicode itself wrote during a roundtrip. When the analysis pipeline
 * receives a list of acknowledgments, matching `(nodeId, ruleId)` issues are
 * flagged `acknowledged: true` and contribute half their normal weight to
 * the density score (#371).
 *
 * This contract is consumed by:
 * - The MCP `analyze` tool (`acknowledgments?: Acknowledgment[]` input)
 * - The CLI `analyze --acknowledgments <path>` flag
 * - `RuleEngineOptions.acknowledgments`
 *
 * It is produced by the Plugin-API helper
 * `extractAcknowledgmentsFromNode` / `readCanicodeAcknowledgments`
 * (see `src/core/roundtrip/read-acknowledgments.ts`).
 */
export const AcknowledgmentSchema = z.object({
  nodeId: z.string(),
  ruleId: z.string(),
});

export type Acknowledgment = z.infer<typeof AcknowledgmentSchema>;

export const AcknowledgmentListSchema = z.array(AcknowledgmentSchema);

/**
 * Normalize a Figma node id into `:`-separated form so callers can pass
 * either URL-style (`123-456`) or Plugin-API-style (`123:456`) ids and the
 * engine matches them consistently. Non-instance ids stay unchanged; the
 * `I…;…` instance-child format keeps its semicolon — only `-` → `:`
 * happens.
 */
export function normalizeNodeId(id: string): string {
  return id.replace(/-/g, ":");
}
