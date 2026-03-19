import type { GetFileResponse, Node } from "@figma/rest-api-spec";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";

/**
 * Figma API 응답을 분석용 타입으로 변환
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

  // 레이아웃 속성 추출
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

  // 크기/위치
  if ("absoluteBoundingBox" in node && node.absoluteBoundingBox) {
    base.absoluteBoundingBox = node.absoluteBoundingBox;
  }

  // 컴포넌트 속성
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

  // 스타일 속성
  if ("styles" in node) {
    base.styles = node.styles as Record<string, string>;
  }
  if ("fills" in node) {
    base.fills = node.fills as unknown[];
  }
  if ("strokes" in node) {
    base.strokes = node.strokes as unknown[];
  }
  if ("effects" in node) {
    base.effects = node.effects as unknown[];
  }

  // 변수 바인딩
  if ("boundVariables" in node && node.boundVariables) {
    base.boundVariables = node.boundVariables as Record<string, unknown>;
  }

  // 텍스트 속성
  if ("characters" in node) {
    base.characters = node.characters as string;
  }
  if ("style" in node) {
    base.style = node.style as Record<string, unknown>;
  }

  // 핸드오프 상태
  if ("devStatus" in node && node.devStatus) {
    base.devStatus = node.devStatus as AnalysisNode["devStatus"];
  }

  // children 재귀 변환
  if ("children" in node && Array.isArray(node.children)) {
    base.children = node.children.map(transformNode);
  }

  return base;
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
