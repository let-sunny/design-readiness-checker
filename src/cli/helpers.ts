import type { AnalysisFile, AnalysisNode } from "../core/contracts/figma-node.js";

export const MAX_NODES_WITHOUT_SCOPE = 500;

/**
 * Find all FRAME/COMPONENT nodes with 50-500 nodes in their subtree,
 * then pick one at random. Used to auto-scope fixture analysis.
 */
export function pickRandomScope(root: AnalysisFile["document"]): AnalysisFile["document"] | null {
  const candidates: AnalysisFile["document"][] = [];

  function collect(node: AnalysisFile["document"]): void {
    const isContainer = node.type === "FRAME" || node.type === "COMPONENT" || node.type === "SECTION";
    if (isContainer) {
      const size = countNodes(node);
      if (size >= 50 && size <= 500) {
        candidates.push(node);
      }
    }
    if ("children" in node && node.children) {
      for (const child of node.children) {
        collect(child);
      }
    }
  }

  collect(root);
  if (candidates.length === 0) return null;
  const idx = Math.floor(Math.random() * candidates.length);
  return candidates[idx] ?? null;
}

export function collectVectorNodeIds(node: { id: string; type: string; children?: readonly unknown[] | undefined }): string[] {
  const ids: string[] = [];
  if (node.type === "VECTOR") ids.push(node.id);
  if (node.children) {
    for (const child of node.children) {
      ids.push(...collectVectorNodeIds(child as typeof node));
    }
  }
  return ids;
}

export function collectVectorNodes(node: { id: string; name: string; type: string; children?: readonly unknown[] | undefined }): Array<{ id: string; name: string }> {
  const nodes: Array<{ id: string; name: string }> = [];
  if (node.type === "VECTOR") nodes.push({ id: node.id, name: node.name });
  if (node.children) {
    for (const child of node.children) {
      nodes.push(...collectVectorNodes(child as typeof node));
    }
  }
  return nodes;
}

export function collectImageNodes(node: AnalysisNode): Array<{ id: string; name: string }> {
  const nodes: Array<{ id: string; name: string }> = [];
  function walk(n: AnalysisNode): void {
    if (n.fills && Array.isArray(n.fills)) {
      for (const fill of n.fills) {
        if ((fill as { type?: string }).type === "IMAGE") {
          nodes.push({ id: n.id, name: n.name });
          break;
        }
      }
    }
    if (n.children) {
      for (const child of n.children) walk(child);
    }
  }
  walk(node);
  return nodes;
}

export function sanitizeFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "image";
}

export function countNodes(node: { children?: readonly unknown[] | undefined }): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(child as { children?: readonly unknown[] | undefined });
    }
  }
  return count;
}
