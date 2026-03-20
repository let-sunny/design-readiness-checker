#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { analyzeFile } from "../core/rule-engine.js";
import { calculateScores, formatScoreSummary } from "../core/scoring.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { getConfigsWithPreset, RULE_CONFIGS, type Preset } from "../rules/rule-config.js";
import { loadConfigFile, mergeConfigs } from "../rules/custom/config-loader.js";
import { loadCustomRules } from "../rules/custom/custom-rule-loader.js";
import { ruleRegistry } from "../rules/rule-registry.js";
import type { RuleConfig, RuleId } from "../contracts/rule.js";

// Import rules to register them
import "../rules/index.js";

const server = new McpServer({
  name: "aiready",
  version: "0.1.0",
});

server.tool(
  "analyze",
  "Analyze a Figma design JSON fixture for development-friendliness and AI-friendliness",
  {
    fixturePath: z.string().describe("Path to a Figma JSON fixture file"),
    preset: z.enum(["relaxed", "dev-friendly", "ai-ready", "strict"]).optional().describe("Analysis preset"),
    targetNodeId: z.string().optional().describe("Scope analysis to a specific node ID"),
    configPath: z.string().optional().describe("Path to config JSON file for rule overrides"),
    customRulesPath: z.string().optional().describe("Path to custom rules JSON file"),
  },
  async ({ fixturePath, preset, targetNodeId, configPath, customRulesPath }) => {
    try {
      const file = await loadFigmaFileFromJson(fixturePath);

      let configs: Record<string, RuleConfig> = preset
        ? { ...getConfigsWithPreset(preset as Preset) }
        : { ...RULE_CONFIGS };

      if (configPath) {
        const configFile = await loadConfigFile(configPath);
        configs = mergeConfigs(configs, configFile);
      }

      if (customRulesPath) {
        const { rules, configs: customConfigs } = await loadCustomRules(customRulesPath);
        for (const rule of rules) {
          ruleRegistry.register(rule);
        }
        configs = { ...configs, ...customConfigs };
      }

      const result = analyzeFile(file, {
        configs: configs as Record<RuleId, RuleConfig>,
        ...(targetNodeId ? { targetNodeId } : {}),
      });

      const scores = calculateScores(result);
      const summary = formatScoreSummary(scores);

      const issuesByRule: Record<string, number> = {};
      for (const issue of result.issues) {
        const id = issue.violation.ruleId;
        issuesByRule[id] = (issuesByRule[id] ?? 0) + 1;
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                fileName: file.name,
                nodeCount: result.nodeCount,
                maxDepth: result.maxDepth,
                issueCount: result.issues.length,
                scores: {
                  overall: scores.overall,
                  categories: scores.byCategory,
                },
                issuesByRule,
                summary,
              },
              null,
              2,
            ),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  },
);

server.tool(
  "list-rules",
  "List all available analysis rules with their current configuration",
  {},
  async () => {
    const rules = ruleRegistry.getAll().map((rule) => {
      const config =
        RULE_CONFIGS[rule.definition.id as keyof typeof RULE_CONFIGS];
      return {
        id: rule.definition.id,
        name: rule.definition.name,
        category: rule.definition.category,
        severity: config?.severity,
        score: config?.score,
        enabled: config?.enabled,
        why: rule.definition.why,
      };
    });

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(rules, null, 2),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
