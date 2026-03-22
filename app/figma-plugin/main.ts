// CanICode Figma Plugin — Main thread
// Runs in Figma's sandbox with access to Plugin API.
// Transforms plugin node data to AnalysisNode format and sends to UI.

/// <reference types="@figma/plugin-typings" />

figma.showUI(__html__, { width: 420, height: 600 });

// ---- Type guards ----

function hasAutoLayout(
  node: SceneNode
): node is FrameNode | ComponentNode | ComponentSetNode | InstanceNode {
  return (
    node.type === "FRAME" ||
    node.type === "COMPONENT" ||
    node.type === "COMPONENT_SET" ||
    node.type === "INSTANCE"
  );
}

function hasFills(
  node: SceneNode
): node is SceneNode & { fills: readonly Paint[] } {
  return "fills" in node;
}

function hasStrokes(
  node: SceneNode
): node is SceneNode & { strokes: readonly Paint[] } {
  return "strokes" in node;
}

function hasEffects(
  node: SceneNode
): node is SceneNode & { effects: readonly Effect[] } {
  return "effects" in node;
}

// ---- AnalysisNode shape (matches src/contracts/figma-node.ts) ----

interface AnalysisNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  layoutMode?: string;
  layoutAlign?: string;
  layoutPositioning?: string;
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  componentId?: string;
  componentPropertyDefinitions?: Record<string, unknown>;
  componentProperties?: Record<string, unknown>;
  styles?: Record<string, string>;
  fills?: unknown[];
  strokes?: unknown[];
  effects?: unknown[];
  boundVariables?: Record<string, unknown>;
  characters?: string;
  style?: Record<string, unknown>;
  devStatus?: { type: string; description?: string };
  isAsset?: boolean;
  children?: AnalysisNode[];
}

interface AnalysisFile {
  fileKey: string;
  name: string;
  lastModified: string;
  version: string;
  document: AnalysisNode;
  components: Record<
    string,
    { key: string; name: string; description: string }
  >;
  styles: Record<
    string,
    { key: string; name: string; styleType: string }
  >;
}

// ---- Transform Figma Plugin nodes to AnalysisNode ----

function transformPluginNode(node: SceneNode): AnalysisNode {
  const result: AnalysisNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
  };

  // Bounding box
  if (node.absoluteBoundingBox) {
    result.absoluteBoundingBox = {
      x: node.absoluteBoundingBox.x,
      y: node.absoluteBoundingBox.y,
      width: node.absoluteBoundingBox.width,
      height: node.absoluteBoundingBox.height,
    };
  }

  // Auto-layout properties (FRAME, COMPONENT, COMPONENT_SET, INSTANCE)
  if (hasAutoLayout(node)) {
    if (node.layoutMode && node.layoutMode !== "NONE") {
      result.layoutMode = node.layoutMode;
    }
    result.itemSpacing = node.itemSpacing;
    result.paddingLeft = node.paddingLeft;
    result.paddingRight = node.paddingRight;
    result.paddingTop = node.paddingTop;
    result.paddingBottom = node.paddingBottom;
    if ("layoutAlign" in node) {
      result.layoutAlign = (node as FrameNode).layoutAlign;
    }
    result.layoutSizingHorizontal = node.layoutSizingHorizontal;
    result.layoutSizingVertical = node.layoutSizingVertical;
    if ("primaryAxisAlignItems" in node) {
      result.primaryAxisAlignItems = node.primaryAxisAlignItems;
    }
    if ("counterAxisAlignItems" in node) {
      result.counterAxisAlignItems = node.counterAxisAlignItems;
    }
  }

  // layoutPositioning (for children in auto-layout)
  if ("layoutPositioning" in node) {
    const lp = (node as FrameNode).layoutPositioning;
    if (lp) {
      result.layoutPositioning = lp;
    }
  }

  // Fills, strokes, effects — serialize as plain arrays
  if (hasFills(node)) {
    const fills = node.fills;
    if (Array.isArray(fills)) {
      result.fills = fills.map((f) => ({ ...f }));
    }
  }
  if (hasStrokes(node)) {
    result.strokes = node.strokes.map((s) => ({ ...s }));
  }
  if (hasEffects(node)) {
    result.effects = node.effects.map((e) => ({ ...e }));
  }

  // Bound variables (design tokens)
  if ("boundVariables" in node && node.boundVariables) {
    result.boundVariables = JSON.parse(
      JSON.stringify(node.boundVariables)
    ) as Record<string, unknown>;
  }

  // Text properties
  if (node.type === "TEXT") {
    result.characters = node.characters;
    // Flatten text style properties
    result.style = {
      fontFamily: node.fontName !== figma.mixed ? (node.fontName as FontName).family : "Mixed",
      fontSize: node.fontSize !== figma.mixed ? node.fontSize : 0,
      fontWeight: node.fontName !== figma.mixed ? (node.fontName as FontName).style : "Mixed",
      lineHeightPx:
        node.lineHeight !== figma.mixed && typeof node.lineHeight === "object"
          ? (node.lineHeight as { value: number }).value ?? 0
          : 0,
      letterSpacing:
        node.letterSpacing !== figma.mixed &&
        typeof node.letterSpacing === "object"
          ? (node.letterSpacing as { value: number }).value ?? 0
          : 0,
    };
  }

  // Component properties
  if (node.type === "INSTANCE") {
    result.componentId = (node as InstanceNode).mainComponent?.id ?? "";
    if (
      "componentProperties" in node &&
      node.componentProperties
    ) {
      result.componentProperties = JSON.parse(
        JSON.stringify(node.componentProperties)
      ) as Record<string, unknown>;
    }
  }
  if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
    try {
      if ("componentPropertyDefinitions" in node) {
        result.componentPropertyDefinitions = JSON.parse(
          JSON.stringify(
            (node as ComponentNode).componentPropertyDefinitions
          )
        ) as Record<string, unknown>;
      }
    } catch {
      // Variant components throw when accessing componentPropertyDefinitions
    }
  }

  // Dev status (only on certain node types with devStatus)
  if ("devStatus" in node && (node as FrameNode).devStatus) {
    const ds = (node as FrameNode).devStatus;
    if (ds) {
      result.devStatus = { type: ds.type };
      if (ds.description) {
        result.devStatus.description = ds.description;
      }
    }
  }

  // Recurse children
  if ("children" in node) {
    const container = node as FrameNode & { children: readonly SceneNode[] };
    result.children = container.children.map(transformPluginNode);
  }

  return result;
}

// ---- Build AnalysisFile from a subtree ----

function buildAnalysisFile(
  rootNode: SceneNode,
  pageName: string
): AnalysisFile {
  const doc = transformPluginNode(rootNode);

  // Collect component metadata
  const components: AnalysisFile["components"] = {};
  const styles: AnalysisFile["styles"] = {};

  function collectComponents(node: AnalysisNode): void {
    if (
      node.type === "COMPONENT" ||
      node.type === "COMPONENT_SET"
    ) {
      components[node.id] = {
        key: node.id,
        name: node.name,
        description: "",
      };
    }
    if (node.children) {
      for (const child of node.children) {
        collectComponents(child);
      }
    }
  }
  collectComponents(doc);

  return {
    fileKey: figma.fileKey ?? "plugin-local",
    name: pageName,
    lastModified: new Date().toISOString(),
    version: "plugin",
    document: doc,
    components,
    styles,
  };
}

// ---- Count nodes ----

function countNodes(node: { children?: readonly unknown[] }): number {
  let count = 1;
  if (node.children) {
    for (const child of node.children) {
      count += countNodes(
        child as { children?: readonly unknown[] }
      );
    }
  }
  return count;
}

// ---- Message handler ----

figma.ui.onmessage = (msg: { type: string }) => {
  if (msg.type === "analyze-selection") {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
      figma.ui.postMessage({
        type: "error",
        message:
          "Nothing selected. Select a frame, component, or section to analyze.",
      });
      return;
    }

    // Use the first selected node (or a wrapper frame if multiple)
    const target = selection[0]!;
    const nodeCount = countNodes(target as unknown as { children?: readonly unknown[] });
    const file = buildAnalysisFile(target, figma.currentPage.name);

    figma.ui.postMessage({
      type: "result",
      data: file,
      nodeCount,
    });
  }

  if (msg.type === "analyze-page") {
    const page = figma.currentPage;
    const children = page.children;

    if (children.length === 0) {
      figma.ui.postMessage({
        type: "error",
        message: "Current page is empty.",
      });
      return;
    }

    // Wrap page children into a virtual FRAME document node
    const allChildren: AnalysisNode[] = [];
    let totalNodes = 0;

    for (const child of children) {
      totalNodes += countNodes(child as unknown as { children?: readonly unknown[] });
      allChildren.push(transformPluginNode(child));
    }

    const file: AnalysisFile = {
      fileKey: figma.fileKey ?? "plugin-local",
      name: page.name,
      lastModified: new Date().toISOString(),
      version: "plugin",
      document: {
        id: page.id,
        name: page.name,
        type: "CANVAS",
        visible: true,
        children: allChildren,
      },
      components: {},
      styles: {},
    };

    figma.ui.postMessage({
      type: "result",
      data: file,
      nodeCount: totalNodes,
    });
  }

  if (msg.type === "resize") {
    const { width, height } = msg as { type: string; width: number; height: number };
    figma.ui.resize(width, height);
  }
};

// Send anonymous device ID derived from Figma user ID
{
  const userId = figma.currentUser?.id ?? "unknown";
  // Simple FNV-1a hash to anonymize — no PII leaves the plugin
  let h = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    h ^= userId.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  const deviceId = "fp-" + (h >>> 0).toString(16).padStart(8, "0");
  figma.ui.postMessage({ type: "device-id", deviceId });
}

// Notify UI that plugin is ready
figma.ui.postMessage({ type: "ready" });
