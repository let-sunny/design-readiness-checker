import type { GetFileResponse, Node } from "@figma/rest-api-spec";
import type { GetFileNodesResponse } from "./figma-client.js";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

/**
 * Transform Figma API response to analysis types
 */
export function transformFigmaResponse(
  fileKey: string,
  response: GetFileResponse
): AnalysisFile {
  return {
    fileKey,
    name: response.name,
    lastModified: response.lastModified,
    version: response.version,
    document: transformNode(response.document),
    components: transformComponents(response.components),
    styles: transformStyles(response.styles),
  };
}

function transformNode(node: Node): AnalysisNode {
  const base: AnalysisNode = {
    id: node.id,
    name: node.name,
    type: node.type as AnalysisNode["type"],
    visible: "visible" in node ? (node.visible ?? true) : true,
  };

  // Layout properties
  if ("layoutMode" in node && node.layoutMode) {
    base.layoutMode = node.layoutMode as AnalysisNode["layoutMode"];
  }
  if ("layoutAlign" in node && node.layoutAlign) {
    base.layoutAlign = node.layoutAlign as AnalysisNode["layoutAlign"];
  }
  if ("layoutPositioning" in node && node.layoutPositioning) {
    base.layoutPositioning =
      node.layoutPositioning as AnalysisNode["layoutPositioning"];
  }
  if ("layoutSizingHorizontal" in node && node.layoutSizingHorizontal) {
    base.layoutSizingHorizontal =
      node.layoutSizingHorizontal as AnalysisNode["layoutSizingHorizontal"];
  }
  if ("layoutSizingVertical" in node && node.layoutSizingVertical) {
    base.layoutSizingVertical =
      node.layoutSizingVertical as AnalysisNode["layoutSizingVertical"];
  }
  if ("primaryAxisAlignItems" in node) {
    base.primaryAxisAlignItems = node.primaryAxisAlignItems as string;
  }
  if ("counterAxisAlignItems" in node) {
    base.counterAxisAlignItems = node.counterAxisAlignItems as string;
  }
  if ("itemSpacing" in node) {
    base.itemSpacing = node.itemSpacing as number;
  }
  if ("paddingLeft" in node) {
    base.paddingLeft = node.paddingLeft as number;
  }
  if ("paddingRight" in node) {
    base.paddingRight = node.paddingRight as number;
  }
  if ("paddingTop" in node) {
    base.paddingTop = node.paddingTop as number;
  }
  if ("paddingBottom" in node) {
    base.paddingBottom = node.paddingBottom as number;
  }

  // Size constraints (responsive)
  if ("minWidth" in node && typeof node.minWidth === "number") {
    base.minWidth = node.minWidth;
  }
  if ("maxWidth" in node && typeof node.maxWidth === "number") {
    base.maxWidth = node.maxWidth;
  }
  if ("minHeight" in node && typeof node.minHeight === "number") {
    base.minHeight = node.minHeight;
  }
  if ("maxHeight" in node && typeof node.maxHeight === "number") {
    base.maxHeight = node.maxHeight;
  }
  if ("layoutGrow" in node && node.layoutGrow !== undefined) {
    base.layoutGrow = node.layoutGrow as 0 | 1;
  }
  if ("constraints" in node && node.constraints) {
    base.constraints = node.constraints as AnalysisNode["constraints"];
  }

  // Wrap (flex-wrap)
  if ("layoutWrap" in node && node.layoutWrap) {
    base.layoutWrap = node.layoutWrap as AnalysisNode["layoutWrap"];
  }
  if ("counterAxisSpacing" in node && typeof node.counterAxisSpacing === "number") {
    base.counterAxisSpacing = node.counterAxisSpacing;
  }
  if ("counterAxisAlignContent" in node && node.counterAxisAlignContent) {
    base.counterAxisAlignContent =
      node.counterAxisAlignContent as AnalysisNode["counterAxisAlignContent"];
  }

  // Grid layout (container)
  if ("gridRowCount" in node && typeof node.gridRowCount === "number") {
    base.gridRowCount = node.gridRowCount;
  }
  if ("gridColumnCount" in node && typeof node.gridColumnCount === "number") {
    base.gridColumnCount = node.gridColumnCount;
  }
  if ("gridRowGap" in node && typeof node.gridRowGap === "number") {
    base.gridRowGap = node.gridRowGap;
  }
  if ("gridColumnGap" in node && typeof node.gridColumnGap === "number") {
    base.gridColumnGap = node.gridColumnGap;
  }
  if ("gridColumnsSizing" in node && typeof node.gridColumnsSizing === "string") {
    base.gridColumnsSizing = node.gridColumnsSizing;
  }
  if ("gridRowsSizing" in node && typeof node.gridRowsSizing === "string") {
    base.gridRowsSizing = node.gridRowsSizing;
  }

  // Grid layout (child)
  if ("gridChildHorizontalAlign" in node && node.gridChildHorizontalAlign) {
    base.gridChildHorizontalAlign =
      node.gridChildHorizontalAlign as AnalysisNode["gridChildHorizontalAlign"];
  }
  if ("gridChildVerticalAlign" in node && node.gridChildVerticalAlign) {
    base.gridChildVerticalAlign =
      node.gridChildVerticalAlign as AnalysisNode["gridChildVerticalAlign"];
  }
  if ("gridRowSpan" in node && typeof node.gridRowSpan === "number") {
    base.gridRowSpan = node.gridRowSpan;
  }
  if ("gridColumnSpan" in node && typeof node.gridColumnSpan === "number") {
    base.gridColumnSpan = node.gridColumnSpan;
  }
  if ("gridRowAnchorIndex" in node && typeof node.gridRowAnchorIndex === "number") {
    base.gridRowAnchorIndex = node.gridRowAnchorIndex;
  }
  if ("gridColumnAnchorIndex" in node && typeof node.gridColumnAnchorIndex === "number") {
    base.gridColumnAnchorIndex = node.gridColumnAnchorIndex;
  }

  // Overflow / clip
  if ("clipsContent" in node && typeof node.clipsContent === "boolean") {
    base.clipsContent = node.clipsContent;
  }
  if ("overflowDirection" in node && node.overflowDirection) {
    base.overflowDirection =
      node.overflowDirection as AnalysisNode["overflowDirection"];
  }

  // Size/position
  if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    base.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  // Component properties
  if ("componentId" in node) {
    base.componentId = node.componentId as string;
  }
  if ("componentPropertyDefinitions" in node) {
    base.componentPropertyDefinitions =
      node.componentPropertyDefinitions as Record<string, unknown>;
  }
  if ("componentProperties" in node) {
    base.componentProperties = node.componentProperties as Record<
      string,
      unknown
    >;
  }

  // Style properties
  if ("styles" in node) {
    base.styles = node.styles as Record<string, string>;
  }
  if ("fills" in node) {
    base.fills = node.fills as unknown[];
  }
  if ("strokes" in node) {
    base.strokes = node.strokes as unknown[];
  }
  if ("strokeWeight" in node && typeof node.strokeWeight === "number") {
    base.strokeWeight = node.strokeWeight;
  }
  if ("individualStrokeWeights" in node && node.individualStrokeWeights) {
    base.individualStrokeWeights = node.individualStrokeWeights as Record<string, number>;
  }
  if ("effects" in node) {
    base.effects = node.effects as unknown[];
  }
  if ("cornerRadius" in node && typeof node.cornerRadius === "number") {
    base.cornerRadius = node.cornerRadius;
  }
  if ("opacity" in node && typeof node.opacity === "number" && node.opacity < 1) {
    base.opacity = node.opacity;
  }

  // Variable bindings
  if ("boundVariables" in node && node.boundVariables) {
    base.boundVariables = node.boundVariables as Record<string, unknown>;
  }

  // Text properties
  if ("characters" in node) {
    base.characters = node.characters as string;
  }
  if ("style" in node) {
    base.style = node.style as Record<string, unknown>;
  }
  if ("textTruncation" in node && (node.textTruncation === "DISABLED" || node.textTruncation === "ENDING")) {
    base.textTruncation = node.textTruncation;
  }
  if ("maxLines" in node && typeof node.maxLines === "number") {
    base.maxLines = node.maxLines;
  }

  // Handoff status
  if ("devStatus" in node && node.devStatus) {
    base.devStatus = node.devStatus as AnalysisNode["devStatus"];
  }

  // Prototype interactions
  if ("interactions" in node && Array.isArray(node.interactions) && node.interactions.length > 0) {
    base.interactions = node.interactions;
  }

  // Recursively transform children
  if ("children" in node && Array.isArray(node.children)) {
    base.children = node.children.map(transformNode);
  }

  return base;
}

/**
 * Transform Figma /v1/files/{key}/nodes response to analysis types.
 * Returns the first node's subtree as the document.
 */
export function transformFileNodesResponse(
  fileKey: string,
  response: GetFileNodesResponse
): AnalysisFile {
  const entries = Object.values(response.nodes);
  const first = entries[0];
  if (!first)
    throw new Error(
      "No nodes returned from Figma API — the node-id in the URL may be invalid or deleted. " +
        "Try selecting the frame in Figma and copying the link again."
    );

  return {
    fileKey,
    name: response.name,
    lastModified: response.lastModified,
    version: response.version,
    document: transformNode(first.document),
    components: transformComponents(first.components),
    styles: transformStyles(first.styles),
  };
}

/**
 * Transform component master nodes from a /v1/files/{key}/nodes response.
 * Each requested node ID is transformed into an AnalysisNode if present.
 */
export function transformComponentMasterNodes(
  response: GetFileNodesResponse,
  requestedIds: string[]
): Record<string, AnalysisNode> {
  const result: Record<string, AnalysisNode> = {};
  for (const id of requestedIds) {
    const entry = response.nodes[id];
    if (entry?.document) {
      result[id] = transformNode(entry.document);
    }
  }
  return result;
}

function transformComponents(
  components: GetFileResponse["components"]
): AnalysisFile["components"] {
  const result: AnalysisFile["components"] = {};
  for (const [id, component] of Object.entries(components)) {
    result[id] = {
      key: component.key,
      name: component.name,
      description: component.description,
    };
  }
  return result;
}

function transformStyles(
  styles: GetFileResponse["styles"]
): AnalysisFile["styles"] {
  const result: AnalysisFile["styles"] = {};
  for (const [id, style] of Object.entries(styles)) {
    result[id] = {
      key: style.key,
      name: style.name,
      styleType: style.styleType,
    };
  }
  return result;
}
