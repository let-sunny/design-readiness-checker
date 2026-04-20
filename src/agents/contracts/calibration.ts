import { z } from "zod";
import { AnalysisScopeSchema } from "../../core/contracts/analysis-scope.js";

export const SamplingStrategySchema = z.enum(["all", "top-issues", "random"]);
export type SamplingStrategy = z.infer<typeof SamplingStrategySchema>;

export const CalibrationStatusSchema = z.enum([
  "pending",
  "analyzing",
  "converting",
  "evaluating",
  "tuning",
  "completed",
  "failed",
]);
export type CalibrationStatus = z.infer<typeof CalibrationStatusSchema>;

export const CalibrationConfigSchema = z.object({
  input: z.string(),
  token: z.string().optional(),
  targetNodeId: z.string().optional(),
  maxConversionNodes: z.number().int().positive().default(20),
  samplingStrategy: SamplingStrategySchema.default("top-issues"),
  outputPath: z.string().default("logs/calibration/calibration-report.md"),
  runDir: z.string().optional(),
  /**
   * #404: Explicit analysis scope for the calibration run. When omitted,
   * the orchestrator (`scripts/calibrate.ts`) injects `"page"` as the
   * policy default — `fixtures/done/*` are conceptually pages even though
   * they are stored as `COMPONENT` variants ("Platform=Desktop" etc.) and
   * would otherwise auto-detect as component scope. A `.scope` file in
   * the fixture directory overrides the default per-fixture.
   */
  scope: AnalysisScopeSchema.optional(),
});

export type CalibrationConfig = z.infer<typeof CalibrationConfigSchema>;
export type CalibrationConfigInput = z.input<typeof CalibrationConfigSchema>;

export interface CalibrationRun {
  config: CalibrationConfig;
  status: CalibrationStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
}
