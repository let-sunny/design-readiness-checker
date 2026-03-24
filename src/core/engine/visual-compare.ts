/**
 * Visual comparison: renders HTML code with Playwright, fetches Figma screenshot,
 * and computes pixel-level similarity using pixelmatch.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

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
}

const FIGMA_CACHE_DIR = "/tmp/canicode-figma-cache";
const FIGMA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the cache path for a given fileKey + nodeId combination.
 */
function getFigmaCachePath(fileKey: string, nodeId: string, scale: number): string {
  // Sanitize nodeId for use as filename (replace : with -)
  const safeNodeId = nodeId.replace(/:/g, "-");
  return resolve(FIGMA_CACHE_DIR, `${fileKey}_${safeNodeId}@${scale}x.png`);
}

/**
 * Check if a cached Figma screenshot exists and is still fresh (within TTL).
 */
function isCacheFresh(cachePath: string): boolean {
  if (!existsSync(cachePath)) return false;
  const stats = statSync(cachePath);
  return Date.now() - stats.mtimeMs < FIGMA_CACHE_TTL_MS;
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
 * Tolerance for detecting integer scale factors (@2x, @3x).
 * Broader tolerance because render/rounding errors accumulate at higher scales.
 */
const SCALE_ROUNDING_TOLERANCE = 0.08;

/**
 * Tolerance for detecting 1x (unity) scale.
 * Tighter to avoid false positives — misidentifying a scaled PNG as 1x.
 */
const UNITY_SCALE_TOLERANCE = 0.02;

/**
 * Infer device pixel ratio so the Playwright screenshot matches Figma PNG pixel dimensions.
 */
function inferDeviceScaleFactor(
  pngW: number,
  pngH: number,
  logicalW: number,
  logicalH: number,
  fallback: number,
): number {
  if (logicalW <= 0 || logicalH <= 0) return 1;
  const sx = pngW / logicalW;
  const sy = pngH / logicalH;
  const rounded = Math.round((sx + sy) / 2);
  if (rounded >= 2 && Math.abs(sx - rounded) < SCALE_ROUNDING_TOLERANCE && Math.abs(sy - rounded) < SCALE_ROUNDING_TOLERANCE) {
    return rounded;
  }
  if (Math.abs(sx - 1) < UNITY_SCALE_TOLERANCE && Math.abs(sy - 1) < UNITY_SCALE_TOLERANCE) return 1;
  return fallback >= 2 ? fallback : Math.max(1, Math.round(sx));
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
 * Pad a PNG to target dimensions with a high-contrast fill color (magenta).
 * Unlike resize, padding preserves original pixels 1:1 and guarantees that
 * any size difference is counted as mismatched pixels by pixelmatch.
 */
function padPng(png: PNG, targetWidth: number, targetHeight: number): PNG {
  const padded = new PNG({ width: targetWidth, height: targetHeight });
  // Fill entire canvas with magenta (FF00FF) — guaranteed to differ from any real content
  for (let i = 0; i < padded.data.length; i += 4) {
    padded.data[i] = 255;     // R
    padded.data[i + 1] = 0;   // G
    padded.data[i + 2] = 255; // B
    padded.data[i + 3] = 255; // A
  }
  // Copy original pixels into top-left corner
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const srcIdx = (y * png.width + x) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      padded.data[dstIdx] = png.data[srcIdx]!;
      padded.data[dstIdx + 1] = png.data[srcIdx + 1]!;
      padded.data[dstIdx + 2] = png.data[srcIdx + 2]!;
      padded.data[dstIdx + 3] = png.data[srcIdx + 3]!;
    }
  }
  return padded;
}

/**
 * Compare two PNG files using pixelmatch.
 */
function compareScreenshots(
  path1: string,
  path2: string,
  diffOutputPath: string,
): { similarity: number; diffPixels: number; totalPixels: number; width: number; height: number } {
  const raw1 = PNG.sync.read(readFileSync(path1));
  const raw2 = PNG.sync.read(readFileSync(path2));

  // Size mismatch — pad smaller image with magenta so extra area counts as diff pixels
  if (raw1.width !== raw2.width || raw1.height !== raw2.height) {
    const width = Math.max(raw1.width, raw2.width);
    const height = Math.max(raw1.height, raw2.height);
    const img1 = padPng(raw1, width, height);
    const img2 = padPng(raw2, width, height);
    const diff = new PNG({ width, height });
    const diffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
    mkdirSync(dirname(diffOutputPath), { recursive: true });
    writeFileSync(diffOutputPath, PNG.sync.write(diff));

    const totalPixels = width * height;
    const similarity = Math.round((1 - diffPixels / totalPixels) * 100);

    return { similarity, diffPixels, totalPixels, width, height };
  }

  const { width, height } = raw1;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(raw1.data, raw2.data, diff.data, width, height, {
    threshold: 0.1,
  });

  mkdirSync(dirname(diffOutputPath), { recursive: true });
  writeFileSync(diffOutputPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const similarity = Math.round((1 - diffPixels / totalPixels) * 100);

  return { similarity, diffPixels, totalPixels, width, height };
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

  const exportScale = options.figmaExportScale ?? 2;

  // Step 1: Fetch Figma screenshot
  // figma.png in outputDir may come from a previous run with a different scale.
  // Always re-fetch unless the file was placed by the caller (e.g. converter copying fixture screenshot).
  if (!existsSync(figmaScreenshotPath)) {
    await fetchFigmaScreenshot(fileKey, nodeId, options.figmaToken, figmaScreenshotPath, exportScale);
    if (!existsSync(figmaScreenshotPath)) {
      throw new Error(`Figma screenshot was not created at expected path: ${figmaScreenshotPath}`);
    }
  }

  // Step 2: Logical viewport + deviceScaleFactor so code.png matches figma.png pixels (@2x, etc.)
  const figmaPng = PNG.sync.read(readFileSync(figmaScreenshotPath));
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
