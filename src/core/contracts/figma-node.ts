import { z } from "zod";

/**
 * Figma node types required for analysis
 * See @figma/rest-api-spec for full API types
 */

export const AnalysisNodeTypeSchema = z.enum([
  "DOCUMENT",
  "CANVAS",
  "FRAME",
  "GROUP",
  "SECTION",
  "COMPONENT",
  "COMPONENT_SET",
  "INSTANCE",
  "RECTANGLE",
  "ELLIPSE",
  "VECTOR",
  "TEXT",
  "LINE",
  "BOOLEAN_OPERATION",
  "STAR",
  "REGULAR_POLYGON",
  "SLICE",
  "STICKY",
  "SHAPE_WITH_TEXT",
  "CONNECTOR",
  "WIDGET",
  "EMBED",
  "LINK_UNFURL",
  "TABLE",
  "TABLE_CELL",
]);

export type AnalysisNodeType = z.infer<typeof AnalysisNodeTypeSchema>;

export const LayoutModeSchema = z.enum(["NONE", "HORIZONTAL", "VERTICAL"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const LayoutAlignSchema = z.enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]);
export type LayoutAlign = z.infer<typeof LayoutAlignSchema>;

export const LayoutPositioningSchema = z.enum(["AUTO", "ABSOLUTE"]);
export type LayoutPositioning = z.infer<typeof LayoutPositioningSchema>;

/**
 * Lightweight FigmaNode type for analysis
 * Contains only properties needed by rules
 */
const BaseAnalysisNodeSchema = z.object({
  // Basic identification
  id: z.string(),
  name: z.string(),
  type: AnalysisNodeTypeSchema,
  visible: z.boolean().default(true),

  // Layout analysis
  layoutMode: LayoutModeSchema.optional(),
  layoutAlign: LayoutAlignSchema.optional(),
  layoutPositioning: LayoutPositioningSchema.optional(),
  layoutSizingHorizontal: z.enum(["FIXED", "HUG", "FILL"]).optional(),
  layoutSizingVertical: z.enum(["FIXED", "HUG", "FILL"]).optional(),
  primaryAxisAlignItems: z.string().optional(),
  counterAxisAlignItems: z.string().optional(),
  itemSpacing: z.number().optional(),
  paddingLeft: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingBottom: z.number().optional(),

  // Size/position analysis
  absoluteBoundingBox: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable()
    .optional(),

  // Component analysis
  componentId: z.string().optional(),
  componentPropertyDefinitions: z.record(z.string(), z.unknown()).optional(),
  componentProperties: z.record(z.string(), z.unknown()).optional(),

  // Style/token analysis
  styles: z.record(z.string(), z.string()).optional(),
  fills: z.array(z.unknown()).optional(),
  strokes: z.array(z.unknown()).optional(),
  effects: z.array(z.unknown()).optional(),
  cornerRadius: z.number().optional(),

  // Variable binding analysis (design tokens)
  boundVariables: z.record(z.string(), z.unknown()).optional(),

  // Text analysis
  characters: z.string().optional(),
  style: z.record(z.string(), z.unknown()).optional(),

  // Handoff analysis
  devStatus: z
    .object({
      type: z.enum(["NONE", "READY_FOR_DEV", "COMPLETED"]),
      description: z.string().optional(),
    })
    .optional(),

  // Naming analysis metadata
  isAsset: z.boolean().optional(),
});

export type AnalysisNode = z.infer<typeof BaseAnalysisNodeSchema> & {
  children?: AnalysisNode[] | undefined;
};

export const AnalysisNodeSchema: z.ZodType<AnalysisNode> =
  BaseAnalysisNodeSchema.extend({
    children: z.lazy(() => AnalysisNodeSchema.array().optional()),
  }) as z.ZodType<AnalysisNode>;

/**
 * Figma file metadata for analysis
 */
export const AnalysisFileSchema = z.object({
  fileKey: z.string(),
  name: z.string(),
  lastModified: z.string(),
  version: z.string(),
  sourceUrl: z.string().optional(),
  document: AnalysisNodeSchema,
  components: z.record(
    z.string(),
    z.object({
      key: z.string(),
      name: z.string(),
      description: z.string(),
    })
  ),
  styles: z.record(
    z.string(),
    z.object({
      key: z.string(),
      name: z.string(),
      styleType: z.string(),
    })
  ),
});

export type AnalysisFile = z.infer<typeof AnalysisFileSchema>;
