/**
 * Visual comparison: renders HTML code with Playwright, fetches Figma screenshot,
 * and computes pixel-level similarity using pixelmatch.
 */

import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

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

export interface VisualCompareOptions {
  figmaUrl: string;
  figmaToken: string;
  codePath: string;
  outputDir?: string | undefined;
  viewport?: { width: number; height: number } | undefined;
}

const FIGMA_CACHE_DIR = "/tmp/canicode-figma-cache";
const FIGMA_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Get the cache path for a given fileKey + nodeId combination.
 */
function getFigmaCachePath(fileKey: string, nodeId: string): string {
  // Sanitize nodeId for use as filename (replace : with -)
  const safeNodeId = nodeId.replace(/:/g, "-");
  return resolve(FIGMA_CACHE_DIR, `${fileKey}_${safeNodeId}.png`);
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
): Promise<void> {
  const cachePath = getFigmaCachePath(fileKey, nodeId);

  // Return cached version if fresh
  if (isCacheFresh(cachePath)) {
    mkdirSync(dirname(outputPath), { recursive: true });
    copyFileSync(cachePath, outputPath);
    return;
  }

  const res = await fetch(
    `https://api.figma.com/v1/images/${fileKey}?ids=${nodeId}&format=png&scale=1`,
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
 */
async function renderCodeScreenshot(
  codePath: string,
  outputPath: string,
  viewport: { width: number; height: number },
): Promise<void> {
  // Dynamic import — playwright is an optional dependency
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });

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
  await browser.close();
}

/**
 * Resize a PNG to target dimensions (nearest neighbor).
 */
function resizePng(png: PNG, targetWidth: number, targetHeight: number): PNG {
  const resized = new PNG({ width: targetWidth, height: targetHeight });
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const srcX = Math.floor((x / targetWidth) * png.width);
      const srcY = Math.floor((y / targetHeight) * png.height);
      const srcIdx = (srcY * png.width + srcX) * 4;
      const dstIdx = (y * targetWidth + x) * 4;
      resized.data[dstIdx] = png.data[srcIdx]!;
      resized.data[dstIdx + 1] = png.data[srcIdx + 1]!;
      resized.data[dstIdx + 2] = png.data[srcIdx + 2]!;
      resized.data[dstIdx + 3] = png.data[srcIdx + 3]!;
    }
  }
  return resized;
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

  // Size mismatch = implementation failure
  if (raw1.width !== raw2.width || raw1.height !== raw2.height) {
    // Still generate a diff image for debugging (resize to larger)
    const width = Math.max(raw1.width, raw2.width);
    const height = Math.max(raw1.height, raw2.height);
    const img1 = resizePng(raw1, width, height);
    const img2 = resizePng(raw2, width, height);
    const diff = new PNG({ width, height });
    pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold: 0.1 });
    mkdirSync(dirname(diffOutputPath), { recursive: true });
    writeFileSync(diffOutputPath, PNG.sync.write(diff));

    return {
      similarity: 0,
      diffPixels: width * height,
      totalPixels: width * height,
      width,
      height,
    };
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

  // Step 1: Fetch Figma screenshot (skip if already cached in output dir)
  if (existsSync(figmaScreenshotPath)) {
    // Reuse cached figma.png — same design, no need to re-fetch
  } else {
    await fetchFigmaScreenshot(fileKey, nodeId, options.figmaToken, figmaScreenshotPath);
    if (!existsSync(figmaScreenshotPath)) {
      throw new Error(`Figma screenshot was not created at expected path: ${figmaScreenshotPath}`);
    }
  }

  // Step 2: Read Figma screenshot dimensions, use as viewport for code rendering
  const figmaPng = PNG.sync.read(readFileSync(figmaScreenshotPath));
  const viewport = options.viewport ?? { width: figmaPng.width, height: figmaPng.height };

  // Step 3: Render code screenshot at the same size
  await renderCodeScreenshot(options.codePath, codeScreenshotPath, viewport);

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
