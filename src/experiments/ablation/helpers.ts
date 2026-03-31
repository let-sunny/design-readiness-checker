/**
 * Ablation experiment-specific utilities.
 *
 * Common utilities are in core:
 * - HTML processing: core/comparison/html-utils.ts
 * - Fixture helpers: core/utils/fixture-helpers.ts
 * - Rendering/comparison: core/comparison/visual-compare.ts
 *
 * This module provides only experiment-specific things:
 * API calls, response parsing, experiment config, input validation.
 */

import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

// Re-export shared utilities for experiment scripts
export { getFixtureScreenshotPath, copyFixtureImages } from "../../core/utils/fixture-helpers.js";

// --- Configuration ---

export const MODEL = "claude-sonnet-4-20250514";
export const MAX_TOKENS = 32000;
export const TEMPERATURE = 0;
export const PROMPT_PATH = resolve(".claude/skills/design-to-code/PROMPT.md");

export const DEFAULT_FIXTURES = [
  "desktop-product-detail",
  "desktop-landing-page",
  "desktop-ai-chat",
];

// --- API response ---

/** Extract response text from API message */
export function getResponseText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// --- API call with retry ---

export async function callApi(client: Anthropic, prompt: string, designTree: string): Promise<Anthropic.Message> {
  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        system: prompt,
        messages: [{ role: "user", content: designTree }],
      });
      return await stream.finalMessage();
    } catch (err) {
      const status =
        typeof err === "object" && err !== null && "status" in err && typeof err.status === "number"
          ? err.status
          : undefined;
      if ((status === 429 || status === 529) && attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt + 1) * 1000;
        console.warn(`    ⚠ ${status} error, retrying in ${delay / 1000}s (${attempt + 1}/${MAX_RETRIES})...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error("API call failed after retries");
}

// --- Input validation ---

export function parseFixtures(): string[] {
  const fixtures = process.env["ABLATION_FIXTURES"]
    ? process.env["ABLATION_FIXTURES"].split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_FIXTURES;
  if (fixtures.length === 0) {
    console.error("Error: No fixtures specified.");
    process.exit(1);
  }
  const SAFE_NAME = /^[a-z0-9][a-z0-9_-]*$/;
  for (const f of fixtures) {
    if (!SAFE_NAME.test(f)) {
      console.error(`Error: Invalid fixture name "${f}".`);
      process.exit(1);
    }
  }
  return fixtures;
}

export function requireApiKey(): string {
  const apiKey = process.env["ANTHROPIC_API_KEY"]?.trim();
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }
  return apiKey;
}
