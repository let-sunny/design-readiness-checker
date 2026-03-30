/**
 * Pure helper functions extracted from visual-compare.ts.
 * These have no side effects beyond file I/O and can be tested directly.
 */

import { writeFileSync, readFileSync, mkdirSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** Directory used for caching Figma screenshots. */
export const FIGMA_CACHE_DIR = "/tmp/canicode-figma-cache";

/**
 * Known @1x screenshot widths from fixture convention.
 * Screenshots at these widths are captured at 1x scale (pixel width = logical width).
 * All other widths are assumed @2x (e.g., 2400px PNG = 1200px logical).
 */
export const KNOWN_1X_WIDTHS = [1920, 768];

/**
 * Infer the export scale of a fixture screenshot based on its pixel width.
 * Uses KNOWN_1X_WIDTHS convention: 1920/768 = @1x, others = @2x.
 */
export function inferExportScale(pngWidth: number): number {
  return KNOWN_1X_WIDTHS.includes(pngWidth) ? 1 : 2;
}

/** Cache time-to-live: 1 hour. */
export const FIGMA_CACHE_TTL_MS = 60 * 60 * 1000;

/**
 * Tolerance for detecting integer scale factors (@2x, @3x).
 * Broader tolerance because render/rounding errors accumulate at higher scales.
 */
export const SCALE_ROUNDING_TOLERANCE = 0.08;

/**
 * Tolerance for detecting 1x (unity) scale.
 * Tighter to avoid false positives — misidentifying a scaled PNG as 1x.
 */
export const UNITY_SCALE_TOLERANCE = 0.02;

/**
 * Get the cache path for a given fileKey + nodeId combination.
 */
export function getFigmaCachePath(fileKey: string, nodeId: string, scale: number): string {
  // Sanitize nodeId for use as filename (replace : with -)
  const safeNodeId = nodeId.replace(/:/g, "-");
  return resolve(FIGMA_CACHE_DIR, `${fileKey}_${safeNodeId}@${scale}x.png`);
}

/**
 * Check if a cached Figma screenshot exists and is still fresh (within TTL).
 */
export function isCacheFresh(cachePath: string): boolean {
  try {
    const stats = statSync(cachePath);
    return Date.now() - stats.mtimeMs < FIGMA_CACHE_TTL_MS;
  } catch {
    // File doesn't exist or was removed between check and stat (TOCTOU safe)
    return false;
  }
}

/**
 * Infer device pixel ratio so the Playwright screenshot matches Figma PNG pixel dimensions.
 */
export function inferDeviceScaleFactor(
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
 * Pad a PNG to target dimensions with a high-contrast fill color (magenta #FF00FF).
 * Unlike resize, padding preserves original pixels 1:1 and guarantees that
 * any size difference is counted as mismatched pixels by pixelmatch.
 *
 * Note: If both images contain magenta in the padded area, those pixels
 * will match — extremely rare in real designs but theoretically possible.
 */
export function padPng(png: PNG, targetWidth: number, targetHeight: number): PNG {
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

/** Options for screenshot comparison. */
export interface CompareOptions {
  /** How to handle size mismatches: "pad" (magenta fill) or "crop" (min dimensions). Default: "pad". */
  sizeMismatch?: "pad" | "crop";
  /** pixelmatch threshold (0-1). Default: 0.1. */
  threshold?: number;
}

/**
 * Crop a PNG to target dimensions (top-left corner preserved).
 */
export function cropPng(png: PNG, targetWidth: number, targetHeight: number): PNG {
  const cropped = new PNG({ width: targetWidth, height: targetHeight });
  for (let y = 0; y < targetHeight; y++) {
    png.data.copy(cropped.data, y * targetWidth * 4, y * png.width * 4, y * png.width * 4 + targetWidth * 4);
  }
  return cropped;
}

/**
 * Compare two PNG files using pixelmatch.
 */
export function compareScreenshots(
  path1: string,
  path2: string,
  diffOutputPath: string,
  options?: CompareOptions,
): { similarity: number; diffPixels: number; totalPixels: number; width: number; height: number } {
  const sizeMismatch = options?.sizeMismatch ?? "pad";
  const threshold = options?.threshold ?? 0.1;
  const raw1 = PNG.sync.read(readFileSync(path1));
  const raw2 = PNG.sync.read(readFileSync(path2));

  let img1: PNG = raw1;
  let img2: PNG = raw2;

  // Size mismatch — normalize to same dimensions
  if (raw1.width !== raw2.width || raw1.height !== raw2.height) {
    if (sizeMismatch === "crop") {
      const width = Math.min(raw1.width, raw2.width);
      const height = Math.min(raw1.height, raw2.height);
      img1 = cropPng(raw1, width, height);
      img2 = cropPng(raw2, width, height);
    } else {
      const width = Math.max(raw1.width, raw2.width);
      const height = Math.max(raw1.height, raw2.height);
      img1 = padPng(raw1, width, height);
      img2 = padPng(raw2, width, height);
    }
  }

  const { width, height } = img1;
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, { threshold });

  mkdirSync(dirname(diffOutputPath), { recursive: true });
  writeFileSync(diffOutputPath, PNG.sync.write(diff));

  const totalPixels = width * height;
  const similarity = diffPixels === 0 ? 100 : Math.floor((1 - diffPixels / totalPixels) * 100);

  return { similarity, diffPixels, totalPixels, width, height };
}

// ── Code metrics (shared with ablation helpers) ─────────────────────────

/** Count unique CSS class selectors in an HTML string's <style> block. */
export function countCssClasses(html: string): number {
  const styleMatch = html.match(/<style[\s\S]*?<\/style>/i);
  if (!styleMatch) return 0;
  const classes = styleMatch[0].match(/\.[a-zA-Z][\w-]*\s*[{,:]/g);
  return new Set(classes?.map((c) => c.replace(/\s*[{,:]$/, ""))).size;
}

/** Count unique CSS custom property definitions in an HTML string's <style> block. */
export function countCssVariables(html: string): number {
  const styleMatch = html.match(/<style[\s\S]*?<\/style>/i);
  if (!styleMatch) return 0;
  const vars = styleMatch[0].match(/--[\w-]+\s*:/g);
  return new Set(vars?.map((v) => v.replace(/\s*:$/, ""))).size;
}

/** Compute code metrics from an HTML string. */
export function computeCodeMetrics(html: string): {
  htmlBytes: number;
  htmlLines: number;
  cssClassCount: number;
  cssVariableCount: number;
} {
  return {
    htmlBytes: Buffer.byteLength(html, "utf-8"),
    htmlLines: html.split("\n").length,
    cssClassCount: countCssClasses(html),
    cssVariableCount: countCssVariables(html),
  };
}
