import type { AnalysisFile, AnalysisNode, AnalysisNodeType } from "../contracts/figma-node.js";

/**
 * Map MCP XML tag names to Figma AnalysisNodeType
 */
const TAG_TYPE_MAP: Record<string, AnalysisNodeType> = {
  canvas: "CANVAS",
  frame: "FRAME",
  group: "GROUP",
  section: "SECTION",
  component: "COMPONENT",
  "component-set": "COMPONENT_SET",
  instance: "INSTANCE",
  rectangle: "RECTANGLE",
  "rounded-rectangle": "RECTANGLE",
  ellipse: "ELLIPSE",
  vector: "VECTOR",
  text: "TEXT",
  line: "LINE",
  "boolean-operation": "BOOLEAN_OPERATION",
  star: "STAR",
  "regular-polygon": "REGULAR_POLYGON",
  slice: "SLICE",
  sticky: "STICKY",
  table: "TABLE",
  "table-cell": "TABLE_CELL",
  symbol: "COMPONENT",
  slot: "FRAME",
};

interface ParsedXmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: ParsedXmlNode[];
}

/**
 * Minimal XML parser for MCP metadata output.
 * Handles self-closing tags and nested elements.
 */
function parseXml(xml: string): ParsedXmlNode[] {
  const nodes: ParsedXmlNode[] = [];
  const stack: ParsedXmlNode[] = [];
  // Match opening tags (with attrs), closing tags, and self-closing tags
  const tagRegex = /<(\/?)([\w-]+)([^>]*?)(\/?)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(xml)) !== null) {
    const isClosing = match[1] === "/";
    const tagName = match[2]!;
    const attrString = match[3] ?? "";
    const isSelfClosing = match[4] === "/";

    if (isClosing) {
      // Pop from stack
      const finished = stack.pop();
      if (finished) {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(finished);
        } else {
          nodes.push(finished);
        }
      }
    } else {
      const attrs = parseAttributes(attrString);
      const node: ParsedXmlNode = { tag: tagName, attrs, children: [] };

      if (isSelfClosing) {
        const parent = stack[stack.length - 1];
        if (parent) {
          parent.children.push(node);
        } else {
          nodes.push(node);
        }
      } else {
        stack.push(node);
      }
    }
  }

  // Flush remaining stack
  while (stack.length > 0) {
    const finished = stack.pop()!;
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(finished);
    } else {
      nodes.push(finished);
    }
  }

  return nodes;
}

function parseAttributes(attrString: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrString)) !== null) {
    const key = match[1];
    const value = match[2];
    if (key && value !== undefined) {
      attrs[key] = value;
    }
  }
  return attrs;
}

/**
 * Convert a parsed XML node to an AnalysisNode
 */
function toAnalysisNode(xmlNode: ParsedXmlNode): AnalysisNode {
  const type = TAG_TYPE_MAP[xmlNode.tag] ?? "FRAME";
  const id = xmlNode.attrs["id"] ?? "0:0";
  const name = xmlNode.attrs["name"] ?? xmlNode.tag;
  const hidden = xmlNode.attrs["hidden"] === "true";

  const x = parseFloat(xmlNode.attrs["x"] ?? "0");
  const y = parseFloat(xmlNode.attrs["y"] ?? "0");
  const width = parseFloat(xmlNode.attrs["width"] ?? "0");
  const height = parseFloat(xmlNode.attrs["height"] ?? "0");

  const node: AnalysisNode = {
    id,
    name,
    type,
    visible: !hidden,
    absoluteBoundingBox: { x, y, width, height },
  };

  if (xmlNode.children.length > 0) {
    node.children = xmlNode.children.map(toAnalysisNode);
  }

  return node;
}

/**
 * Parse MCP get_metadata XML output into an AnalysisFile.
 *
 * The XML represents a subtree of the Figma file. We wrap it in a
 * DOCUMENT node and fill in minimal file metadata.
 */
export function parseMcpMetadataXml(
  xml: string,
  fileKey: string,
  fileName?: string
): AnalysisFile {
  const parsed = parseXml(xml);

  // The root XML elements become children of the document
  const children = parsed.map(toAnalysisNode);

  // If there's exactly one root element, use it directly as the document root
  // Otherwise wrap in a DOCUMENT node
  let document: AnalysisNode;
  if (children.length === 1 && children[0]) {
    document = children[0];
  } else {
    document = {
      id: "0:0",
      name: "Document",
      type: "DOCUMENT",
      visible: true,
      children,
    };
  }

  return {
    fileKey,
    name: fileName ?? fileKey,
    lastModified: new Date().toISOString(),
    version: "mcp",
    document,
    components: {},
    styles: {},
  };
}
