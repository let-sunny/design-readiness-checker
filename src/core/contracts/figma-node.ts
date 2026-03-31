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
  "SLOT",
]);

export type AnalysisNodeType = z.infer<typeof AnalysisNodeTypeSchema>;

export const LayoutModeSchema = z.enum(["NONE", "HORIZONTAL", "VERTICAL", "GRID"]);
export type LayoutMode = z.infer<typeof LayoutModeSchema>;

export const LayoutAlignSchema = z.enum(["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"]);
export type LayoutAlign = z.infer<typeof LayoutAlignSchema>;

export const LayoutPositioningSchema = z.enum(["AUTO", "ABSOLUTE"]);
export type LayoutPositioning = z.infer<typeof LayoutPositioningSchema>;

export const LayoutConstraintSchema = z.object({
  horizontal: z.enum(["LEFT", "RIGHT", "CENTER", "LEFT_RIGHT", "SCALE"]),
  vertical: z.enum(["TOP", "BOTTOM", "CENTER", "TOP_BOTTOM", "SCALE"]),
});
export type LayoutConstraint = z.infer<typeof LayoutConstraintSchema>;

export const LayoutWrapSchema = z.enum(["NO_WRAP", "WRAP"]);
export type LayoutWrap = z.infer<typeof LayoutWrapSchema>;

export const OverflowDirectionSchema = z.enum([
  "HORIZONTAL_SCROLLING",
  "VERTICAL_SCROLLING",
  "HORIZONTAL_AND_VERTICAL_SCROLLING",
  "NONE",
]);
export type OverflowDirection = z.infer<typeof OverflowDirectionSchema>;

export const GridChildAlignSchema = z.enum(["AUTO", "MIN", "CENTER", "MAX"]);
export type GridChildAlign = z.infer<typeof GridChildAlignSchema>;

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

  // Size constraints (responsive)
  minWidth: z.number().optional(),
  maxWidth: z.number().optional(),
  minHeight: z.number().optional(),
  maxHeight: z.number().optional(),
  layoutGrow: z.union([z.literal(0), z.literal(1)]).optional(),
  constraints: LayoutConstraintSchema.optional(),

  // Wrap (flex-wrap)
  layoutWrap: LayoutWrapSchema.optional(),
  counterAxisSpacing: z.number().optional(),
  counterAxisAlignContent: z.enum(["AUTO", "SPACE_BETWEEN"]).optional(),

  // Grid layout (container)
  gridRowCount: z.number().optional(),
  gridColumnCount: z.number().optional(),
  gridRowGap: z.number().optional(),
  gridColumnGap: z.number().optional(),
  gridColumnsSizing: z.string().optional(),
  gridRowsSizing: z.string().optional(),

  // Grid layout (child)
  gridChildHorizontalAlign: GridChildAlignSchema.optional(),
  gridChildVerticalAlign: GridChildAlignSchema.optional(),
  gridRowSpan: z.number().optional(),
  gridColumnSpan: z.number().optional(),
  gridRowAnchorIndex: z.number().optional(),
  gridColumnAnchorIndex: z.number().optional(),

  // Overflow / clip
  clipsContent: z.boolean().optional(),
  overflowDirection: OverflowDirectionSchema.optional(),

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
  strokeWeight: z.number().optional(),
  individualStrokeWeights: z.record(z.string(), z.number()).optional(),
  effects: z.array(z.unknown()).optional(),
  cornerRadius: z.number().optional(),
  opacity: z.number().optional(),

  // Variable binding analysis (design tokens)
  boundVariables: z.record(z.string(), z.unknown()).optional(),

  // Text analysis
  characters: z.string().optional(),
  style: z.record(z.string(), z.unknown()).optional(),
  textTruncation: z.enum(["DISABLED", "ENDING"]).optional(),
  maxLines: z.number().optional(),

  // Handoff analysis
  devStatus: z
    .object({
      type: z.enum(["NONE", "READY_FOR_DEV", "COMPLETED"]),
      description: z.string().optional(),
    })
    .optional(),

  // Prototype interactions
  interactions: z.array(z.unknown()).optional(),

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
  componentDefinitions: z.record(z.string(), AnalysisNodeSchema).optional(),
  interactionDestinations: z.record(z.string(), AnalysisNodeSchema).optional(),
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
