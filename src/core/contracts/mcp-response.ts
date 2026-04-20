import { z } from "zod";
import { SeveritySchema } from "./severity.js";
import { CategorySchema } from "./category.js";
import {
  DetectionSchema,
  OutputChannelSchema,
  PersistenceIntentSchema,
  RulePurposeSchema,
} from "./channels.js";

const GradeSchema = z.enum(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]);

const CategoryScoreResultSchema = z.object({
  category: CategorySchema,
  score: z.number(),
  maxScore: z.number(),
  percentage: z.number(),
  issueCount: z.number().int().min(0),
  uniqueRuleCount: z.number().int().min(0),
  weightedIssueCount: z.number(),
  densityScore: z.number(),
  diversityScore: z.number(),
  bySeverity: z.object({
    blocking: z.number().int().min(0),
    risk: z.number().int().min(0),
    "missing-info": z.number().int().min(0),
    suggestion: z.number().int().min(0),
  }),
});

const McpIssueSchema = z.object({
  ruleId: z.string(),
  detection: DetectionSchema,
  outputChannel: OutputChannelSchema.extract(["score"]),
  persistenceIntent: PersistenceIntentSchema.extract(["transient"]),
  /**
   * #406: Whether the triggering rule's primary output is a score penalty
   * (`violation`) or a gotcha annotation (`info-collection`). MCP consumers
   * use this to decide whether the issue is actionable ("fix this") or
   * annotation-seeking ("tell us what you meant here").
   */
  purpose: RulePurposeSchema,
  subType: z.string().optional(),
  severity: SeveritySchema,
  nodeId: z.string(),
  nodePath: z.string(),
  message: z.string(),
});

/**
 * Zod schema for the MCP analyze tool response body.
 * This is the shape of the JSON returned by `buildResultJson` in scoring.ts.
 */
export const McpAnalyzeResponseSchema = z.object({
  version: z.string(),
  analyzedAt: z.string(),
  fileKey: z.string().optional(),
  fileName: z.string(),
  nodeCount: z.number().int().min(0),
  maxDepth: z.number().int().min(0),
  issueCount: z.number().int().min(0),
  isReadyForCodeGen: z.boolean(),
  blockingIssueCount: z.number().int().min(0),
  scores: z.object({
    overall: z.object({
      score: z.number(),
      maxScore: z.number(),
      percentage: z.number(),
      grade: GradeSchema,
    }),
    categories: z.record(CategorySchema, CategoryScoreResultSchema),
  }),
  issuesByRule: z.record(z.string(), z.number().int().min(0)),
  issues: z.array(McpIssueSchema),
  summary: z.string(),
  failedRules: z.array(z.string()).optional(),
});

export type McpAnalyzeResponse = z.infer<typeof McpAnalyzeResponseSchema>;
