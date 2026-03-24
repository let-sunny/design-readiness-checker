import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderCodeScreenshot } from "@/core/engine/visual-compare.js";

/**
 * Render generated HTML/CSS/React code to a PNG screenshot.
 * Delegates to visual-compare's shared Playwright renderer to avoid duplication.
 * Returns base64-encoded PNG.
 */
export async function renderCodeToScreenshot(
  generatedCode: string,
  options?: { width?: number; height?: number }
): Promise<string> {
  const width = options?.width ?? 800;
  const height = options?.height ?? 600;

  const html = buildHtmlWrapper(generatedCode);

  // Write to a temp file since renderCodeScreenshot expects a file path
  const tmpDir = "/tmp/canicode-code-renderer";
  mkdirSync(tmpDir, { recursive: true });
  const tmpHtml = resolve(tmpDir, `render-${Date.now()}.html`);
  const tmpPng = resolve(tmpDir, `render-${Date.now()}.png`);
  writeFileSync(tmpHtml, html);

  await renderCodeScreenshot(tmpHtml, tmpPng, { width, height });

  return readFileSync(tmpPng).toString("base64");
}

/**
 * Wrap generated code in a minimal HTML document.
 * Handles raw HTML, HTML with style tags, and basic React JSX.
 */
export function buildHtmlWrapper(code: string): string {
  // If the code already looks like a full HTML document, use it directly
  if (code.trimStart().toLowerCase().startsWith("<!doctype") || code.trimStart().startsWith("<html")) {
    return code;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
  </style>
</head>
<body>
${code}
</body>
</html>`;
}
