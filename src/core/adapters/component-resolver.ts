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
 * Recursively collect all unique interaction destination IDs from nodes.
 * These are the node IDs that interactions (e.g., ON_HOVER → CHANGE_TO) point to.
 */
export function collectInteractionDestinationIds(node: AnalysisNode): Set<string> {
  const ids = new Set<string>();

  function walk(n: AnalysisNode): void {
    if (n.interactions && Array.isArray(n.interactions)) {
      for (const interaction of n.interactions) {
        const i = interaction as {
          trigger?: { type?: string };
          actions?: Array<{ destinationId?: string; navigation?: string }>;
        };
        if (i.trigger?.type === "ON_HOVER" && i.actions) {
          for (const action of i.actions) {
            if (action.navigation === "CHANGE_TO" && action.destinationId) {
              ids.add(action.destinationId);
            }
          }
        }
      }
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
      } catch (err) {
        // Skip failed batches (e.g. external library components)
        console.debug(`[component-resolver] batch fetch failed (${batch.length} ids):`, err);
      }
    }

    // Mark all attempted IDs as resolved (even if they failed/returned null)
    for (const id of idsToFetch) {
      resolvedIds.add(id);
    }

    // Collect new IDs only from masters fetched in this pass (not all accumulated)
    pendingIds = new Set<string>();
    for (const id of idsToFetch) {
      const node = allDefinitions[id];
      if (node) {
        for (const nestedId of collectComponentIds(node)) {
          if (!resolvedIds.has(nestedId)) {
            pendingIds.add(nestedId);
          }
        }
      }
    }
  }

  return allDefinitions;
}

/**
 * Resolve interaction destination nodes (e.g., hover variants).
 *
 * Collects all destinationId values from interactions in the document,
 * excludes those already in componentDefinitions, and fetches them.
 */
export async function resolveInteractionDestinations(
  client: FigmaClient,
  fileKey: string,
  document: AnalysisNode,
  existingDefinitions?: Record<string, AnalysisNode>,
): Promise<Record<string, AnalysisNode>> {
  const destIds = collectInteractionDestinationIds(document);
  if (destIds.size === 0) return {};

  const allDestinations: Record<string, AnalysisNode> = {};
  const idsToFetch: string[] = [];

  for (const id of destIds) {
    const existing = existingDefinitions?.[id];
    if (existing) {
      allDestinations[id] = existing;
    } else {
      idsToFetch.push(id);
    }
  }

  if (idsToFetch.length === 0) return allDestinations;

  for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
    const batch = idsToFetch.slice(i, i + BATCH_SIZE);
    try {
      const response = await client.getFileNodes(fileKey, batch);
      const transformed = transformComponentMasterNodes(response, batch);
      for (const [id, node] of Object.entries(transformed)) {
        allDestinations[id] = node;
      }
    } catch (err) {
      console.debug(`[component-resolver] interaction destination fetch failed (${batch.length} ids):`, err);
    }
  }

  return allDestinations;
}
