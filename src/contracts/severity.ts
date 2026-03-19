import { z } from "zod";

export const SeveritySchema = z.enum([
  "blocking",
  "risk",
  "missing-info",
  "suggestion",
]);

export type Severity = z.infer<typeof SeveritySchema>;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  blocking: 10,
  risk: 5,
  "missing-info": 2,
  suggestion: 1,
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  blocking: "Blocking",
  risk: "Risk",
  "missing-info": "Missing Info",
  suggestion: "Suggestion",
};
