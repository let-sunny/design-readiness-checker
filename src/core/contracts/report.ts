import { z } from "zod";
import { CategoryScoreSchema } from "./score.js";
import { IssueSchema } from "./issue.js";

export const ReportMetadataSchema = z.object({
  fileKey: z.string(),
  fileName: z.string(),
  analyzedAt: z.string().datetime(),
  version: z.string(),
});

export type ReportMetadata = z.infer<typeof ReportMetadataSchema>;

export const ReportSchema = z.object({
  metadata: ReportMetadataSchema,
  totalScore: z.number().min(0).max(100),
  categoryScores: z.array(CategoryScoreSchema),
  issues: z.array(IssueSchema),
  summary: z.object({
    totalNodes: z.number().int().min(0),
    analyzedNodes: z.number().int().min(0),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    infoCount: z.number().int().min(0),
  }),
});

export type Report = z.infer<typeof ReportSchema>;
