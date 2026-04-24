#!/usr/bin/env tsx
/**
 * Post-build step for the canicode-roundtrip helpers bundle (#424).
 *
 * `tsup --config tsup.roundtrip.config.ts` produces `helpers.js` (the full
 * ~31KB IIFE). Every `use_figma` batch historically has to prepend that file
 * in full, which crowds the ~50KB use_figma code-string budget when the
 * roundtrip splits across multiple batches.
 *
 * This script emits two sibling artifacts so the SKILL can drop the per-batch
 * payload from ~31KB to a few hundred bytes after the first batch:
 *
 *   - `helpers-installer.js` — stores the helpers IIFE once as a JSON.stringify'd
 *     string and then (a) evals that string via indirect eval so the global
 *     `CanICodeRoundtrip` is defined for the install batch itself and
 *     (b) persists the source + canicode version onto `figma.root` via
 *     `setSharedPluginData`. Only one copy of the ~31KB source ships in the
 *     installer artifact so the install batch stays well under the use_figma
 *     ~50KB soft budget.
 *   - `helpers-bootstrap.js` — a small loader that reads the cached source +
 *     version, version-checks against the constant baked in at build time,
 *     and evals to re-register `globalThis.CanICodeRoundtrip`. On cache-miss
 *     or version-mismatch it surfaces a structured marker on
 *     `globalThis.__canicodeBootstrapResult` and throws a ReferenceError so
 *     the agent's batch self-reports the need to re-prepend the installer.
 *
 * The namespace + key string literals come from
 * `src/core/roundtrip/shared-plugin-data.ts` so the installer trailer, the
 * bootstrap loader, and any future TypeScript consumer share one source of
 * truth.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CANICODE_PLUGIN_DATA_NAMESPACE,
  HELPERS_SRC_KEY,
  HELPERS_VERSION_KEY,
} from "../src/core/roundtrip/shared-plugin-data.js";

export interface BundleRoundtripCacheInput {
  helpersSource: string;
  version: string;
}

export interface BundleRoundtripCacheResult {
  installer: string;
  bootstrap: string;
}

/**
 * Pure function: given the already-bundled helpers IIFE source and the
 * canicode version, returns the two string artifacts to emit. Keeping the
 * installer + bootstrap templates as plain constants (no nested template
 * literals that re-interpolate at runtime) makes the vitest coverage trivial.
 */
export function bundleRoundtripCache(
  input: BundleRoundtripCacheInput,
): BundleRoundtripCacheResult {
  const { helpersSource, version } = input;
  const namespaceLiteral = JSON.stringify(CANICODE_PLUGIN_DATA_NAMESPACE);
  const helpersSrcKeyLiteral = JSON.stringify(HELPERS_SRC_KEY);
  const helpersVersionKeyLiteral = JSON.stringify(HELPERS_VERSION_KEY);
  const versionLiteral = JSON.stringify(version);
  const srcLiteral = JSON.stringify(helpersSource);

  const installer = [
    "// canicode-roundtrip helpers installer (auto-generated — see scripts/bundle-roundtrip-cache.ts)",
    `// Prepend to the FIRST use_figma batch of a roundtrip session. Caches the helpers source on`,
    `// figma.root via setSharedPluginData so subsequent batches can prepend the much smaller`,
    `// helpers-bootstrap.js instead of re-pasting ~31KB every call (#424, ADR-020).`,
    `var __CANICODE_HELPERS_SRC__ = ${srcLiteral};`,
    `var __CANICODE_HELPERS_VERSION__ = ${versionLiteral};`,
    `(0, eval)(__CANICODE_HELPERS_SRC__);`,
    `try {`,
    `  figma.root.setSharedPluginData(${namespaceLiteral}, ${helpersSrcKeyLiteral}, __CANICODE_HELPERS_SRC__);`,
    `  figma.root.setSharedPluginData(${namespaceLiteral}, ${helpersVersionKeyLiteral}, __CANICODE_HELPERS_VERSION__);`,
    `  globalThis.__canicodeInstallResult = { cachePersisted: true };`,
    `} catch (err) {`,
    `  globalThis.__canicodeInstallResult = { cachePersisted: false, reason: String((err && err.message) || err) };`,
    `}`,
    "",
  ].join("\n");

  const bootstrap = [
    "// canicode-roundtrip helpers bootstrap (auto-generated — see scripts/bundle-roundtrip-cache.ts)",
    `// Prepend to every use_figma batch AFTER the installer batch. Loads the cached helpers source`,
    `// from figma.root shared plugin data, version-checks it against the baked-in canicode version,`,
    `// and evals to register globalThis.CanICodeRoundtrip (#424, ADR-020). On cache-miss or`,
    `// version-mismatch, surfaces { canicodeBootstrapResult, expected, actual } on`,
    `// globalThis.__canicodeBootstrapResult and throws ReferenceError so the agent re-prepends the`,
    `// installer on the next batch.`,
    `(function __canicodeBootstrap() {`,
    `  var expected = ${versionLiteral};`,
    `  var src = figma.root.getSharedPluginData(${namespaceLiteral}, ${helpersSrcKeyLiteral});`,
    `  var actual = figma.root.getSharedPluginData(${namespaceLiteral}, ${helpersVersionKeyLiteral});`,
    `  if (!src) {`,
    `    globalThis.__canicodeBootstrapResult = { canicodeBootstrapResult: "cache-missing", expected: expected, actual: actual || null };`,
    `    throw new ReferenceError("canicode-bootstrap:cache-missing (expected " + expected + ") — re-prepend helpers-installer.js");`,
    `  }`,
    `  if (actual !== expected) {`,
    `    globalThis.__canicodeBootstrapResult = { canicodeBootstrapResult: "version-mismatch", expected: expected, actual: actual };`,
    `    throw new ReferenceError("canicode-bootstrap:version-mismatch (expected " + expected + ", actual " + actual + ") — re-prepend helpers-installer.js");`,
    `  }`,
    `  (0, eval)(src);`,
    `})();`,
    "",
  ].join("\n");

  return { installer, bootstrap };
}

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "..");
  const helpersJsPath = resolve(
    repoRoot,
    ".claude/skills/canicode-roundtrip/helpers.js",
  );
  const packageJsonPath = resolve(repoRoot, "package.json");
  const outDir = dirname(helpersJsPath);

  const helpersSource = readFileSync(helpersJsPath, "utf-8");
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as {
    version?: unknown;
  };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) {
    throw new Error(
      `bundle-roundtrip-cache: package.json at ${packageJsonPath} is missing a non-empty version string`,
    );
  }

  const { installer, bootstrap } = bundleRoundtripCache({
    helpersSource,
    version: pkg.version,
  });

  const installerPath = join(outDir, "helpers-installer.js");
  const bootstrapPath = join(outDir, "helpers-bootstrap.js");
  writeFileSync(installerPath, installer);
  writeFileSync(bootstrapPath, bootstrap);

  console.log(
    `bundle-roundtrip-cache: wrote helpers-installer.js (${installer.length} chars) and helpers-bootstrap.js (${bootstrap.length} chars) for canicode v${pkg.version}`,
  );
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("bundle-roundtrip-cache.ts");
if (isMain) {
  main();
}
