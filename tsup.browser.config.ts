import { defineConfig } from "tsup";

export default defineConfig({
  entry: { browser: "src/browser.ts" },
  format: ["iife"],
  globalName: "CanICode",
  platform: "browser",
  outDir: "docs",
  dts: false,
  clean: false,
  sourcemap: false,
  splitting: false,
  treeshake: true,
  target: "es2020",
  noExternal: [/.*/],
  minify: true,
});
