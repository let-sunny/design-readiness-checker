import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { SeveritySchema } from "../contracts/severity.js";
import type { RuleConfig } from "../contracts/rule.js";
import { RULE_CONFIGS } from "./rule-config.js";

const VALID_RULE_IDS = new Set(Object.keys(RULE_CONFIGS));

const RuleOverrideSchema = z.object({
  score: z.number().int().max(0).optional(),
  severity: SeveritySchema.optional(),
  enabled: z.boolean().optional(),
});

const ConfigFileSchema = z.object({
  excludeNodeTypes: z.array(z.string()).optional(),
  excludeNodeNames: z.array(z.string()).optional(),
  gridBase: z.number().int().positive().optional(),
  codegenReadyMinGrade: z.enum(["S", "A+", "A", "B+", "B", "C+", "C", "D", "F"]).optional(),
  rules: z.record(z.string(), RuleOverrideSchema)
    .superRefine((rules, ctx) => {
      const unknown = Object.keys(rules).filter((id) => !VALID_RULE_IDS.has(id));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unknown rule ID(s): ${unknown.join(", ")}. Valid IDs: ${[...VALID_RULE_IDS].join(", ")}`,
        });
      }
    })
    .optional(),
});

export type ConfigFile = z.infer<typeof ConfigFileSchema>;

export async function loadConfigFile(filePath: string): Promise<ConfigFile> {
  const absPath = resolve(filePath);
  const raw = await readFile(absPath, "utf-8");
  const parsed: unknown = JSON.parse(raw);
  return ConfigFileSchema.parse(parsed);
}

/**
 * Merge config overrides into the base rule configs
 */
export function mergeConfigs(
  base: Record<string, RuleConfig>,
  overrides: ConfigFile,
): Record<string, RuleConfig> {
  const merged = { ...base };

  // Apply global gridBase to relevant rules
  if (overrides.gridBase !== undefined) {
    for (const [id, config] of Object.entries(merged)) {
      if (config.options && "gridBase" in config.options) {
        merged[id] = {
          ...config,
          options: { ...config.options, gridBase: overrides.gridBase },
        };
      }
    }
  }

  // Apply per-rule overrides
  if (overrides.rules) {
    for (const [ruleId, override] of Object.entries(overrides.rules)) {
      const existing = merged[ruleId];
      if (existing) {
        merged[ruleId] = {
          ...existing,
          ...(override.score !== undefined && { score: override.score }),
          ...(override.severity !== undefined && { severity: override.severity }),
          ...(override.enabled !== undefined && { enabled: override.enabled }),
        };
      }
    }
  }

  return merged;
}
