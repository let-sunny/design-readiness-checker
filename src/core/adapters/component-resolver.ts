import type { FigmaClient } from "./figma-client.js";
import type { AnalysisNode } from "../contracts/figma-node.js";
import { transformComponentMasterNodes } from "./figma-transformer.js";

const BATCH_SIZE = 50;

/**
 * Recursively collect all unique componentId values from INSTANCE nodes.
 */
export function collectComponentIds(node: AnalysisNode): Set<string> {
  const ids = new Set<string>();

  function walk(n: AnalysisNode): void {
    if (n.type === "INSTANCE" && n.componentId) {
      ids.add(n.componentId);
    }
    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(node);
  return ids;
}

/**
 * Resolve component master node trees via multi-pass fetching.
 *
 * Pass 1: collect component IDs from the document tree, fetch their masters.
 * Pass 2+: collect component IDs from fetched masters that were not in previous passes.
 * Repeats up to maxPasses (default 2).
 *
 * Batches API calls at BATCH_SIZE IDs per request.
 * Skips IDs that return null (e.g. external library components).
 */
export async function resolveComponentDefinitions(
  client: FigmaClient,
  fileKey: string,
  document: AnalysisNode,
  maxPasses = 2
): Promise<Record<string, AnalysisNode>> {
  const allDefinitions: Record<string, AnalysisNode> = {};
  const resolvedIds = new Set<string>();

  // Pass 1: collect from the original document
  let pendingIds = collectComponentIds(document);

  for (let pass = 0; pass < maxPasses; pass++) {
    // Filter out already-resolved IDs
    const idsToFetch = [...pendingIds].filter((id) => !resolvedIds.has(id));
    if (idsToFetch.length === 0) break;

    // Fetch in batches
    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      const batch = idsToFetch.slice(i, i + BATCH_SIZE);
      try {
        const response = await client.getFileNodes(fileKey, batch);
        const transformed = transformComponentMasterNodes(response, batch);
        for (const [id, node] of Object.entries(transformed)) {
          allDefinitions[id] = node;
        }
      } catch {
        // Skip failed batches (e.g. external library components)
      }
    }

    // Mark all attempted IDs as resolved (even if they failed/returned null)
    for (const id of idsToFetch) {
      resolvedIds.add(id);
    }

    // Collect new IDs from the fetched master nodes for the next pass
    pendingIds = new Set<string>();
    for (const node of Object.values(allDefinitions)) {
      for (const id of collectComponentIds(node)) {
        if (!resolvedIds.has(id)) {
          pendingIds.add(id);
        }
      }
    }
  }

  return allDefinitions;
}
