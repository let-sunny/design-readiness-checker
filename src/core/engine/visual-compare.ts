/**
 * Visual comparison: renders HTML code with Playwright, fetches Figma screenshot,
 * and computes pixel-level similarity using pixelmatch.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { PNG } from "pngjs";
import {
  FIGMA_CACHE_DIR,
  getFigmaCachePath,
  isCacheFresh,
  inferDeviceScaleFactor,
  inferExportScale,
  compareScreenshots,
  type CompareOptions,
} from "./visual-compare-helpers.js";

/** Result of a visual comparison between Figma design and rendered code. */
export interface VisualCompareResult {
  similarity: number;
  diffPixels: number;
  totalPixels: number;
  width: number;
  height: number;
  figmaScreenshotPath: string;
  codeScreenshotPath: string;
  diffPath: string;
}

/** Options for the visual comparison pipeline. */
export interface VisualCompareOptions {
  figmaUrl: string;
  figmaToken: string;
  codePath: string;
  outputDir?: string | undefined;
  /**
   * Logical CSS viewport (CSS pixels). Omit a dimension to infer from the Figma PNG
   * using `figmaExportScale`. When the whole object is omitted, both dimensions are inferred.
   */
  viewport?: { width?: number; height?: number } | undefined;
  /**
   * Figma Images API `scale` and assumed scale for fixture `figma.png` (e.g. from `save-fixture`).
   * Default 2 matches REST exports and avoids comparing a @2x PNG against a 1× Playwright capture.
   */
  figmaExportScale?: number | undefined;
  /**
   * Path to a local Figma screenshot file. When provided, skips URL-based fetch
   * and uses this file directly as the ground truth. Useful for responsive comparison
   * where multiple fixture screenshots exist at different viewports.
   */
  figmaScreenshotPath?: string | undefined;
}

/**
 * Fetch Figma node screenshot via REST API, with file-based caching.
 * Cache key: fileKey + nodeId. Cache location: /tmp/canicode-figma-cache/. TTL: 1 hour.
 */
async function fetchFigmaScreenshot(
  fileKey: string,
  nodeId: string,
  token: string,
  outputPath: string,
  scale: number,
): Promise<void> {
  const cachePath = getFigmaCachePath(fileKey, nodeId, scale);

  // Return cached version if fresh
  if (isCacheFresh(cachePath)) {
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(cachePath, outputPath);
    return;
  }

  const res = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=png&scale=${scale}`,
    { headers: { "X-Figma-Token": token } },
  );
  if (!res.ok) throw new Error(`Figma Images API: ${res.status} ${res.statusText}`);

  const data = (await res.json()) as { images: Record<string, string | null> };
  const imgUrl = data.images[nodeId];
  if (!imgUrl) throw new Error(`No image returned for node ${nodeId}`);

  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) throw new Error(`Failed to download Figma screenshot: ${imgRes.status}`);

  const buffer = Buffer.from(await imgRes.arrayBuffer());

  // Write to output path
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, buffer);

  // Save to cache
  mkdirSync(FIGMA_CACHE_DIR, { recursive: true });
  writeFileSync(cachePath, buffer);
}

/**
 * Render HTML file with Playwright and take a screenshot.
 * @param deviceScaleFactor - Pass 2 when the Figma reference is @2x and `viewport` is logical CSS size.
 */
export async function renderCodeScreenshot(
  codePath: string,
  outputPath: string,
  logicalViewport: { width: number; height: number },
  deviceScaleFactor: number = 1,
): Promise<void> {
  // Dynamic import — playwright is an optional dependency
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: logicalViewport,
      deviceScaleFactor,
    });
    const page = await context.newPage();

    await page.goto(`file://${resolve(codePath)}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.waitForTimeout(1000);

    // Capture only the first child element (the design root), not the full body/viewport
    const root = page.locator("body > *:first-child");
    if (await root.count() > 0) {
      await root.screenshot({ path: outputPath });
    } else {
      await page.screenshot({ path: outputPath });
    }
  } finally {
    await browser.close();
  }
}

/**
 * Run full visual comparison pipeline.
 */
export async function visualCompare(options: VisualCompareOptions): Promise<VisualCompareResult> {
  const outputDir = options.outputDir ?? "/tmp/canicode-visual-compare";
  const figmaScreenshotPath = resolve(outputDir, "figma.png");
  const codeScreenshotPath = resolve(outputDir, "code.png");
  const diffPath = resolve(outputDir, "diff.png");

  // Parse Figma URL
  const urlMatch = options.figmaUrl.match(/\/design\/([^/]+)\//);
  const fileKey = urlMatch?.[1];
  if (!fileKey) throw new Error("Invalid Figma URL — could not extract file key");

  const nodeIdMatch = options.figmaUrl.match(/node-id=([^&\s]+)/);
  const nodeId = nodeIdMatch?.[1]?.replace(/-/g, ":");
  if (!nodeId) throw new Error("Invalid Figma URL — missing node-id");

  // Step 1: Figma screenshot — use local file if provided, otherwise fetch via API
  if (options.figmaScreenshotPath) {
    if (!existsSync(options.figmaScreenshotPath)) {
      throw new Error(`Figma screenshot not found: ${options.figmaScreenshotPath}`);
    }
    mkdirSync(dirname(figmaScreenshotPath), { recursive: true });
    copyFileSync(options.figmaScreenshotPath, figmaScreenshotPath);
  } else if (!existsSync(figmaScreenshotPath)) {
    const fetchScale = options.figmaExportScale ?? 2;
    await fetchFigmaScreenshot(fileKey, nodeId, options.figmaToken, figmaScreenshotPath, fetchScale);
    if (!existsSync(figmaScreenshotPath)) {
      throw new Error(`Figma screenshot was not created at expected path: ${figmaScreenshotPath}`);
    }
  }

  // Step 2: Logical viewport + deviceScaleFactor so code.png matches figma.png pixels (@2x, etc.)
  const figmaPng = PNG.sync.read(readFileSync(figmaScreenshotPath));
  // Auto-detect export scale from PNG width when using local screenshot (KNOWN_1X_WIDTHS convention)
  const exportScale = options.figmaExportScale ?? inferExportScale(figmaPng.width);
  const hasViewportOverride = options.viewport !== undefined;
  let logicalW: number;
  let logicalH: number;
  let deviceScaleFactor: number;

  if (!hasViewportOverride) {
    logicalW = Math.max(1, Math.round(figmaPng.width / exportScale));
    logicalH = Math.max(1, Math.round(figmaPng.height / exportScale));
    deviceScaleFactor = exportScale;
  } else {
    logicalW =
      options.viewport!.width ?? Math.max(1, Math.round(figmaPng.width / exportScale));
    logicalH =
      options.viewport!.height ?? Math.max(1, Math.round(figmaPng.height / exportScale));
    deviceScaleFactor = inferDeviceScaleFactor(
      figmaPng.width,
      figmaPng.height,
      logicalW,
      logicalH,
      exportScale,
    );
  }

  // Step 3: Render code screenshot at matching physical resolution
  await renderCodeScreenshot(
    options.codePath,
    codeScreenshotPath,
    { width: logicalW, height: logicalH },
    deviceScaleFactor,
  );

  // Validate both screenshots exist before comparing
  if (!existsSync(codeScreenshotPath)) {
    throw new Error(`Code screenshot was not created at expected path: ${codeScreenshotPath}`);
  }

  // Compare
  const result = compareScreenshots(figmaScreenshotPath, codeScreenshotPath, diffPath);

  return {
    ...result,
    figmaScreenshotPath,
    codeScreenshotPath,
    diffPath,
  };
}

/** Options for renderAndCompare. */
export interface RenderAndCompareOptions {
  /** How to handle size mismatches. Default: "pad". */
  sizeMismatch?: CompareOptions["sizeMismatch"];
  /** Output file suffix (e.g. "baseline", "stripped-layout"). */
  suffix?: string;
  /** pixelmatch threshold. Default: 0.1. */
  threshold?: number;
}

/**
 * Render HTML → screenshot, then compare against a Figma screenshot.
 * Handles export scale inference and size normalization.
 *
 * Extracted from ablation helpers to be shared by calibration + experiments.
 */
export async function renderAndCompare(
  htmlPath: string,
  figmaScreenshotPath: string,
  outputDir: string,
  options?: RenderAndCompareOptions,
): Promise<{ similarity: number }> {
  const suffix = options?.suffix ?? "output";
  const sizeMismatch = options?.sizeMismatch ?? "pad";
  const threshold = options?.threshold;

  const figmaImage = PNG.sync.read(readFileSync(figmaScreenshotPath));
  const figmaWidth = figmaImage.width;
  const exportScale = inferExportScale(figmaWidth);
  const logicalW = Math.max(1, Math.round(figmaWidth / exportScale));
  const logicalH = Math.max(1, Math.round(figmaImage.height / exportScale));

  const codePngPath = resolve(outputDir, `code-${suffix}.png`);
  await renderCodeScreenshot(htmlPath, codePngPath, { width: logicalW, height: logicalH }, exportScale);

  const figmaCopyPath = resolve(outputDir, `figma-${suffix}.png`);
  copyFileSync(figmaScreenshotPath, figmaCopyPath);

  const diffPath = resolve(outputDir, `diff-${suffix}.png`);
  const compareOpts: CompareOptions = { sizeMismatch };
  if (threshold !== undefined) compareOpts.threshold = threshold;
  return compareScreenshots(figmaCopyPath, codePngPath, diffPath, compareOpts);
}
