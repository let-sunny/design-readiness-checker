import { bundleRoundtripCache } from "./bundle-roundtrip-cache.js";
import {
  CANICODE_PLUGIN_DATA_NAMESPACE,
  HELPERS_SRC_KEY,
  HELPERS_VERSION_KEY,
} from "../src/core/roundtrip/shared-plugin-data.js";

describe("bundleRoundtripCache", () => {
  const helpersSource = "var CanICodeRoundtrip = { version: 'fake' };";
  const version = "9.9.9";

  it("installer embeds the JSON-stringified helpers source", () => {
    const { installer } = bundleRoundtripCache({ helpersSource, version });
    expect(installer).toContain(
      `var __CANICODE_HELPERS_SRC__ = ${JSON.stringify(helpersSource)};`,
    );
  });

  it("installer evals the stringified helpers source so the global is defined without duplicating the IIFE verbatim (#424 budget)", () => {
    const { installer } = bundleRoundtripCache({ helpersSource, version });
    expect(installer).toContain("(0, eval)(__CANICODE_HELPERS_SRC__)");
    // Only the JSON.stringify'd copy of the source should ship — the raw
    // (unescaped) IIFE must not also be inlined, or the install batch doubles
    // in size and blows the ~50KB use_figma soft budget the PR is defending.
    const stringified = JSON.stringify(helpersSource);
    const withoutStringifiedCopy = installer.replace(stringified, "");
    expect(withoutStringifiedCopy).not.toContain(helpersSource);
  });

  it("installer writes both setSharedPluginData keys using the shared constants", () => {
    const { installer } = bundleRoundtripCache({ helpersSource, version });
    expect(installer).toContain(
      `figma.root.setSharedPluginData(${JSON.stringify(
        CANICODE_PLUGIN_DATA_NAMESPACE,
      )}, ${JSON.stringify(HELPERS_SRC_KEY)}, __CANICODE_HELPERS_SRC__);`,
    );
    expect(installer).toContain(
      `figma.root.setSharedPluginData(${JSON.stringify(
        CANICODE_PLUGIN_DATA_NAMESPACE,
      )}, ${JSON.stringify(HELPERS_VERSION_KEY)}, __CANICODE_HELPERS_VERSION__);`,
    );
  });

  it("installer stamps the version literal", () => {
    const { installer } = bundleRoundtripCache({ helpersSource, version });
    expect(installer).toContain(
      `var __CANICODE_HELPERS_VERSION__ = ${JSON.stringify(version)};`,
    );
  });

  it("bootstrap reads the cache using the shared constants", () => {
    const { bootstrap } = bundleRoundtripCache({ helpersSource, version });
    expect(bootstrap).toContain(
      `figma.root.getSharedPluginData(${JSON.stringify(
        CANICODE_PLUGIN_DATA_NAMESPACE,
      )}, ${JSON.stringify(HELPERS_SRC_KEY)})`,
    );
    expect(bootstrap).toContain(
      `figma.root.getSharedPluginData(${JSON.stringify(
        CANICODE_PLUGIN_DATA_NAMESPACE,
      )}, ${JSON.stringify(HELPERS_VERSION_KEY)})`,
    );
  });

  it("bootstrap bakes the expected version and version-checks", () => {
    const { bootstrap } = bundleRoundtripCache({ helpersSource, version });
    expect(bootstrap).toContain(`var expected = ${JSON.stringify(version)};`);
    expect(bootstrap).toContain("actual !== expected");
  });

  it("bootstrap evals the cached source on version match", () => {
    const { bootstrap } = bundleRoundtripCache({ helpersSource, version });
    expect(bootstrap).toContain("(0, eval)(src)");
  });

  it("bootstrap surfaces a structured cache-missing marker", () => {
    const { bootstrap } = bundleRoundtripCache({ helpersSource, version });
    expect(bootstrap).toContain(
      'canicodeBootstrapResult: "cache-missing"',
    );
    expect(bootstrap).toContain("__canicodeBootstrapResult");
    expect(bootstrap).toContain(
      'throw new ReferenceError("canicode-bootstrap:cache-missing',
    );
  });

  it("installer surfaces a structured __canicodeInstallResult marker on read-only files", () => {
    const { installer } = bundleRoundtripCache({ helpersSource, version });
    expect(installer).toContain("globalThis.__canicodeInstallResult");
    expect(installer).toContain("cachePersisted: true");
    expect(installer).toContain("cachePersisted: false");
    expect(installer).toMatch(/try\s*\{[\s\S]*setSharedPluginData[\s\S]*\}\s*catch/);
  });

  it("bootstrap surfaces a structured version-mismatch marker", () => {
    const { bootstrap } = bundleRoundtripCache({ helpersSource, version });
    expect(bootstrap).toContain(
      'canicodeBootstrapResult: "version-mismatch"',
    );
    expect(bootstrap).toContain(
      'throw new ReferenceError("canicode-bootstrap:version-mismatch',
    );
  });
});
