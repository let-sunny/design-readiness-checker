// canicode-roundtrip helpers bootstrap (auto-generated — see scripts/bundle-roundtrip-cache.ts)
// Prepend to every use_figma batch AFTER the installer batch. Loads the cached helpers source
// from figma.root shared plugin data, version-checks it against the baked-in canicode version,
// and evals to register globalThis.CanICodeRoundtrip (#424, ADR-020). On cache-miss or
// version-mismatch, surfaces { canicodeBootstrapResult, expected, actual } on
// globalThis.__canicodeBootstrapResult and throws ReferenceError so the agent re-prepends the
// installer on the next batch.
(function __canicodeBootstrap() {
  var expected = "0.11.3";
  var src = figma.root.getSharedPluginData("canicode", "helpersSrc");
  var actual = figma.root.getSharedPluginData("canicode", "helpersVersion");
  if (!src) {
    globalThis.__canicodeBootstrapResult = { canicodeBootstrapResult: "cache-missing", expected: expected, actual: actual || null };
    throw new ReferenceError("canicode-bootstrap:cache-missing (expected " + expected + ") — re-prepend helpers-installer.js");
  }
  if (actual !== expected) {
    globalThis.__canicodeBootstrapResult = { canicodeBootstrapResult: "version-mismatch", expected: expected, actual: actual };
    throw new ReferenceError("canicode-bootstrap:version-mismatch (expected " + expected + ", actual " + actual + ") — re-prepend helpers-installer.js");
  }
  (0, eval)(src);
})();
