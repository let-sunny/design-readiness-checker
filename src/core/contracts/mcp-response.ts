import { z } from "zod";
import { SeveritySchema } from "./severity.js";
import { CategorySchema } from "./category.js";

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
