/**
 * Parse Figma instance-child node IDs.
 *
 * Nodes inside an instance carry an `I`-prefixed id with semicolon-separated
 * path segments: `I<parentInstanceId>;<sourceNodeId>`. For nested instances
 * the format chains further, e.g. `I<parentId>;<midId>;<sourceNodeId>` —
 * each `;` represents one additional level of instance expansion. The LAST
 * segment is always the id of the node inside the innermost source component,
 * which is reachable directly via `figma.getNodeById`.
 *
 * Siblings: `figma-url-parser.ts#toCommentableNodeId` handles the same id
 * format for a different purpose (stripping for the Comments API). That
 * helper is intentionally left alone — this module owns id parsing for the
 * apply pipeline.
 */

export interface InstanceChildIdParts {
  parentInstanceId: string;
  sourceNodeId: string;
}

export function isInstanceChildNodeId(nodeId: string): boolean {
  return nodeId.startsWith("I") && nodeId.includes(";");
}

export function parseInstanceChildNodeId(
  nodeId: string,
): InstanceChildIdParts | null {
  if (!isInstanceChildNodeId(nodeId)) return null;

  const segments = nodeId.split(";");
  if (segments.length < 2) return null;

  const parentInstanceId = segments[0]!.replace(/^I/, "");
  const sourceNodeId = segments[segments.length - 1]!;

  if (!parentInstanceId || !sourceNodeId) return null;

  return { parentInstanceId, sourceNodeId };
}
