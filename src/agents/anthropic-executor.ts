import type { ConversionExecutor, ConversionExecutorResult } from "./contracts/conversion-agent.js";
import { buildConversionPrompt } from "./conversion-agent.prompt.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

/**
 * Create a ConversionExecutor that uses the Anthropic Messages API
 * to generate code from a Figma node description.
 */
export function createAnthropicExecutor(apiKey: string): ConversionExecutor {
  return async (
    nodeId: string,
    fileKey: string,
    flaggedRuleIds: string[]
  ): Promise<ConversionExecutorResult> => {
    const prompt = buildConversionPrompt(nodeId, fileKey, flaggedRuleIds);

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${body}`);
    }

    const json = await response.json() as {
      content: Array<{ type: string; text?: string }>;
    };

    const textBlock = json.content.find((b) => b.type === "text");
    if (!textBlock?.text) {
      throw new Error("No text response from Anthropic API");
    }

    // Extract JSON from response (may be wrapped in markdown fences)
    const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch?.[1]?.trim() ?? textBlock.text.trim();

    const parsed = JSON.parse(jsonStr) as ConversionExecutorResult;

    return {
      generatedCode: parsed.generatedCode ?? "",
      difficulty: parsed.difficulty ?? "moderate",
      notes: parsed.notes ?? "",
      ruleRelatedStruggles: parsed.ruleRelatedStruggles ?? [],
      uncoveredStruggles: parsed.uncoveredStruggles ?? [],
    };
  };
}
