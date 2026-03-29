/**
 * Shared utilities for ablation experiment scripts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";

import { renderCodeScreenshot } from "../../core/engine/visual-compare.js";
import { compareScreenshots, inferExportScale } from "../../core/engine/visual-compare-helpers.js";

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

// --- Design-tree helpers ---

export function getDesignTreeOptions(fixture: string) {
  const fixtureDir = resolve(`fixtures/${fixture}`);
  const vectorDir = join(fixtureDir, "vectors");
  const imageDir = join(fixtureDir, "images");
  return {
    ...(existsSync(vectorDir) ? { vectorDir } : {}),
    ...(existsSync(imageDir) ? { imageDir } : {}),
  };
}

export function getFixtureScreenshotPath(fixture: string, width?: number): string {
  const w = width ?? (fixture.startsWith("mobile-") ? 375 : 1200);
  return resolve(`fixtures/${fixture}/screenshot-${w}.png`);
}

// --- HTML parsing ---

export function extractHtml(text: string): { html: string; method: string } {
  const allBlocks = [...text.matchAll(/```(?:html|css|[a-z]*)?\s*\n([\s\S]*?)(?:```|$)/g)]
    .map((m) => m[1]?.trim() ?? "")
    .filter((block) => block.includes("<") && block.length > 50);
  if (allBlocks.length === 0) return { html: "", method: "none" };
  const fullDoc = allBlocks.find((b) => /^<!doctype|^<html/i.test(b));
  if (fullDoc) return { html: fullDoc, method: "doctype" };
  const hasBody = allBlocks.find((b) => /<body/i.test(b));
  if (hasBody) return { html: hasBody, method: "body" };
  return { html: allBlocks.reduce((a, b) => (a.length >= b.length ? a : b)), method: "largest" };
}

export function sanitizeHtml(html: string): string {
  let result = html;
  result = result.replace(/^\/\/\s*filename:.*\n/i, "");
  result = result.replace(/<script[\s\S]*?<\/script>/gi, "");
  result = result.replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "");
  result = result.replace(/\s+on\w+\s*=\s*'[^']*'/gi, "");
  result = result.replace(/href\s*=\s*"javascript:[^"]*"/gi, 'href="#"');
  result = result.replace(/href\s*=\s*'javascript:[^']*'/gi, "href='#'");
  return result;
}

export function injectLocalFont(html: string): string {
  const fontPath = resolve("assets/fonts/Inter.var.woff2");
  if (!existsSync(fontPath)) return html;
  const fontCss = `@font-face { font-family: "Inter"; src: url("file://${fontPath}") format("woff2"); font-weight: 100 900; }`;
  let result = html;
  result = result.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/gi, "");
  result = result.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/gi, "");
  if (result.includes("<style>")) {
    result = result.replace("<style>", `<style>\n${fontCss}\n`);
  } else if (result.includes("</head>")) {
    result = result.replace("</head>", `<style>${fontCss}</style>\n</head>`);
  }
  return result;
}

/** Full pipeline: extract → sanitize → inject font */
export function processHtml(responseText: string): { html: string; method: string } {
  const { html: raw, method } = extractHtml(responseText);
  const html = injectLocalFont(sanitizeHtml(raw));
  return { html, method };
}

/** Extract response text from API message */
export function getResponseText(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

// --- CSS metrics (re-export from core) ---

export { countCssClasses, countCssVariables } from "../../core/engine/visual-compare-helpers.js";

// --- File operations ---

export function copyFixtureImages(fixture: string, runDir: string): void {
  const fixtureImagesDir = resolve(`fixtures/${fixture}/images`);
  if (existsSync(fixtureImagesDir)) {
    const runImagesDir = join(runDir, "images");
    mkdirSync(runImagesDir, { recursive: true });
    for (const f of readdirSync(fixtureImagesDir)) {
      copyFileSync(join(fixtureImagesDir, f), join(runImagesDir, f));
    }
  }
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
      const status = (err as { status?: number }).status;
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

// --- Render + compare ---

export async function renderAndCompare(
  htmlPath: string,
  figmaScreenshotPath: string,
  runDir: string,
  suffix: string,
): Promise<{ similarity: number }> {
  const { PNG } = await import("pngjs");
  const figmaImage = PNG.sync.read(readFileSync(figmaScreenshotPath));
  const figmaWidth = figmaImage.width;
  const exportScale = inferExportScale(figmaWidth);
  const logicalW = Math.max(1, Math.round(figmaWidth / exportScale));
  const logicalH = Math.max(1, Math.round(figmaImage.height / exportScale));

  const codePngPath = join(runDir, `code-${suffix}.png`);
  await renderCodeScreenshot(htmlPath, codePngPath, { width: logicalW, height: logicalH }, exportScale);

  const figmaCopyPath = join(runDir, `figma-${suffix}.png`);
  copyFileSync(figmaScreenshotPath, figmaCopyPath);

  // Crop to matching dimensions
  const codeImage = PNG.sync.read(readFileSync(codePngPath));
  const figmaCopy = PNG.sync.read(readFileSync(figmaCopyPath));
  const cropW = Math.min(codeImage.width, figmaCopy.width);
  const cropH = Math.min(codeImage.height, figmaCopy.height);
  if (codeImage.width !== cropW || codeImage.height !== cropH) {
    const cropped = new PNG({ width: cropW, height: cropH });
    for (let y = 0; y < cropH; y++) {
      codeImage.data.copy(cropped.data, y * cropW * 4, y * codeImage.width * 4, y * codeImage.width * 4 + cropW * 4);
    }
    writeFileSync(codePngPath, PNG.sync.write(cropped));
  }
  if (figmaCopy.width !== cropW || figmaCopy.height !== cropH) {
    const cropped = new PNG({ width: cropW, height: cropH });
    for (let y = 0; y < cropH; y++) {
      figmaCopy.data.copy(cropped.data, y * cropW * 4, y * figmaCopy.width * 4, y * figmaCopy.width * 4 + cropW * 4);
    }
    writeFileSync(figmaCopyPath, PNG.sync.write(cropped));
  }

  const diffPath = join(runDir, `diff-${suffix}.png`);
  return compareScreenshots(figmaCopyPath, codePngPath, diffPath);
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
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    console.error("Error: ANTHROPIC_API_KEY environment variable is required");
    process.exit(1);
  }
  return apiKey;
}
