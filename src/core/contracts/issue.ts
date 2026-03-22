import { z } from "zod";
import { SeveritySchema } from "./severity.js";

export const IssueSchema = z.object({
  nodeId: z.string(),
  nodePath: z.string(),
  figmaDeepLink: z.string().url(),
  ruleId: z.string(),
  message: z.string(),
  severity: SeveritySchema,
});

export type Issue = z.infer<typeof IssueSchema>;
