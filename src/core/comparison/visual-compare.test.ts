/**
 * Tests for visual-compare helpers.
 *
 * Pure helper functions are imported directly from visual-compare-helpers.ts,
 * so tests exercise the real implementation rather than mirrored copies.
 */

import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { PNG } from "pngjs";
import {
  getFigmaCachePath,
  isCacheFresh,
  padPng,
  compareScreenshots,
  inferDeviceScaleFactor,
  expandRootWidth,
  FIGMA_CACHE_DIR,
} from "./visual-compare-helpers.js";

// ---------------------------------------------------------------------------
// PNG factory helpers
// ---------------------------------------------------------------------------

function makeSolidPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    png.data[i * 4] = r;
    png.data[i * 4 + 1] = g;
    png.data[i * 4 + 2] = b;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getFigmaCachePath", () => {
  it("places the cache file inside FIGMA_CACHE_DIR", () => {
    const path = getFigmaCachePath("abc123", "1:2", 2);
    expect(path.startsWith(FIGMA_CACHE_DIR)).toBe(true);
  });

  it("replaces colons in nodeId with hyphens", () => {
    const path = getFigmaCachePath("file", "10:20", 2);
    expect(path).toContain("10-20");
    expect(path).not.toContain("10:20");
  });

  it("combines fileKey, sanitized nodeId, and scale in the filename", () => {
    const path = getFigmaCachePath("myfile", "3:45", 2);
    expect(path).toContain("myfile_3-45@2x.png");
  });

  it("handles nodeId without colons unchanged", () => {
    const path = getFigmaCachePath("key", "node123", 2);
    expect(path).toContain("key_node123@2x.png");
  });
});

describe("isCacheFresh", () => {
  it("returns false for a path that does not exist", () => {
    const nonExistent = "/tmp/canicode-figma-cache/__nonexistent_test_file__.png";
    expect(isCacheFresh(nonExistent)).toBe(false);
  });

  it("returns true for a file written just now", () => {
    const dir = mkdtempSync(join(tmpdir(), "vc-cache-test-"));
    const cachePath = join(dir, "fresh.png");
    writeFileSync(cachePath, makeSolidPng(4, 4, 255, 0, 0));

    expect(isCacheFresh(cachePath)).toBe(true);
  });
});

describe("padPng", () => {
  it("output dimensions match the requested target size", () => {
    const src = new PNG({ width: 10, height: 10 });
    src.data.fill(255);

    const result = padPng(src, 20, 30);

    expect(result.width).toBe(20);
    expect(result.height).toBe(30);
  });

  it("preserves original pixels in top-left corner", () => {
    const src = new PNG({ width: 4, height: 4 });
    for (let i = 0; i < 4 * 4; i++) {
      src.data[i * 4] = 200;
      src.data[i * 4 + 1] = 0;
      src.data[i * 4 + 2] = 0;
      src.data[i * 4 + 3] = 255;
    }

    const result = padPng(src, 8, 8);

    // Original region (top-left 4x4) should be red
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        const idx = (y * 8 + x) * 4;
        expect(result.data[idx]).toBe(200);
        expect(result.data[idx + 1]).toBe(0);
        expect(result.data[idx + 2]).toBe(0);
      }
    }
  });

  it("fills padded region with magenta", () => {
    const src = new PNG({ width: 2, height: 2 });
    src.data.fill(0); // black
    for (let i = 0; i < 4; i++) src.data[i * 4 + 3] = 255; // opaque

    const result = padPng(src, 4, 4);

    // Bottom-right corner (3,3) should be magenta
    const idx = (3 * 4 + 3) * 4;
    expect(result.data[idx]).toBe(255);     // R
    expect(result.data[idx + 1]).toBe(0);   // G
    expect(result.data[idx + 2]).toBe(255); // B
    expect(result.data[idx + 3]).toBe(255); // A
  });
});

describe("compareScreenshots", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "vc-compare-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("same image → similarity is 100", () => {
    const png = makeSolidPng(10, 10, 100, 150, 200);
    const path1 = join(tempDir, "a.png");
    const path2 = join(tempDir, "b.png");
    const diff = join(tempDir, "diff.png");
    writeFileSync(path1, png);
    writeFileSync(path2, png);

    const result = compareScreenshots(path1, path2, diff);

    expect(result.similarity).toBe(100);
    expect(result.diffPixels).toBe(0);
    expect(result.totalPixels).toBe(100);
  });

  it("completely different images → similarity is less than 100", () => {
    const path1 = join(tempDir, "white.png");
    const path2 = join(tempDir, "black.png");
    const diff = join(tempDir, "diff.png");
    writeFileSync(path1, makeSolidPng(10, 10, 255, 255, 255));
    writeFileSync(path2, makeSolidPng(10, 10, 0, 0, 0));

    const result = compareScreenshots(path1, path2, diff);

    expect(result.similarity).toBeLessThan(100);
  });

  it("size mismatch with same color → padded area counts as diff", () => {
    const path1 = join(tempDir, "small.png");
    const path2 = join(tempDir, "large.png");
    const diff = join(tempDir, "diff.png");
    writeFileSync(path1, makeSolidPng(10, 10, 255, 255, 255));
    writeFileSync(path2, makeSolidPng(20, 20, 255, 255, 255));

    const result = compareScreenshots(path1, path2, diff);

    // Small image padded with magenta → 300 out of 400 pixels differ (the padding area)
    // Overlapping 10x10 region matches (white vs white), rest is white vs magenta
    expect(result.similarity).toBeLessThan(100);
    expect(result.diffPixels).toBeGreaterThan(0);
  });

  it("size mismatch → width and height reflect the larger image dimensions", () => {
    const path1 = join(tempDir, "s.png");
    const path2 = join(tempDir, "l.png");
    const diff = join(tempDir, "diff.png");
    writeFileSync(path1, makeSolidPng(5, 8, 0, 0, 0));
    writeFileSync(path2, makeSolidPng(15, 12, 255, 255, 255));

    const result = compareScreenshots(path1, path2, diff);

    expect(result.width).toBe(15);
    expect(result.height).toBe(12);
  });

  it("writes a diff file to the specified output path", () => {
    const png = makeSolidPng(8, 8, 50, 100, 150);
    const path1 = join(tempDir, "img1.png");
    const path2 = join(tempDir, "img2.png");
    const diff = join(tempDir, "out", "diff.png");
    writeFileSync(path1, png);
    writeFileSync(path2, makeSolidPng(8, 8, 200, 100, 50));

    compareScreenshots(path1, path2, diff);

    expect(existsSync(diff)).toBe(true);
  });

  it("totalPixels equals width * height", () => {
    const path1 = join(tempDir, "p1.png");
    const path2 = join(tempDir, "p2.png");
    const diff = join(tempDir, "diff.png");
    writeFileSync(path1, makeSolidPng(6, 4, 255, 0, 0));
    writeFileSync(path2, makeSolidPng(6, 4, 255, 0, 0));

    const result = compareScreenshots(path1, path2, diff);

    expect(result.totalPixels).toBe(6 * 4);
    expect(result.width).toBe(6);
    expect(result.height).toBe(4);
  });
});

describe("expandRootWidth", () => {
  it("replaces first fixed pixel width with 100%", () => {
    const html = `<style>.root { width: 375px; } .card { width: 200px; }</style>`;
    const result = expandRootWidth(html);
    expect(result).toContain("width: 100%");
    expect(result).toContain("width: 200px");
  });

  it("removes min-width pixel constraints", () => {
    const html = `<style>.root { width: 1200px; min-width: 1200px; }</style>`;
    const result = expandRootWidth(html);
    expect(result).toContain("min-width: 0");
    expect(result).not.toContain("min-width: 1200px");
  });

  it("returns unchanged HTML when no style block", () => {
    const html = `<div style="width: 375px">content</div>`;
    expect(expandRootWidth(html)).toBe(html);
  });

  it("only replaces first width occurrence", () => {
    const html = `<style>.root { width: 375px; } .child { width: 375px; }</style>`;
    const result = expandRootWidth(html);
    const matches = result.match(/width: 100%/g);
    expect(matches).toHaveLength(1);
  });
});

describe("inferDeviceScaleFactor", () => {
  it("detects 2x scale", () => {
    expect(inferDeviceScaleFactor(800, 600, 400, 300, 2)).toBe(2);
  });

  it("detects 3x scale", () => {
    expect(inferDeviceScaleFactor(1200, 900, 400, 300, 2)).toBe(3);
  });

  it("detects 1x scale", () => {
    expect(inferDeviceScaleFactor(400, 300, 400, 300, 2)).toBe(1);
  });

  it("returns 1 when logical dimensions are zero", () => {
    expect(inferDeviceScaleFactor(800, 600, 0, 0, 2)).toBe(1);
  });

  it("uses fallback for fractional scale when fallback >= 2", () => {
    // 800 / 300 ≈ 2.67, 600 / 250 = 2.4 — not close to any integer
    // fallback is 2, so it should return 2
    expect(inferDeviceScaleFactor(800, 600, 300, 250, 2)).toBe(2);
  });

  it("rounds to nearest integer when fallback < 2 for fractional scale", () => {
    // 800 / 300 ≈ 2.67, 600 / 250 = 2.4 — not close to any integer
    // fallback is 1 (< 2), so it uses Math.max(1, Math.round(sx)) = Math.round(2.67) = 3
    expect(inferDeviceScaleFactor(800, 600, 300, 250, 1)).toBe(3);
  });
});
