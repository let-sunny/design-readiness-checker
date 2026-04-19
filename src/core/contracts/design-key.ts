import { resolve } from "node:path";
import { z } from "zod";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";

/**
 * Local copy of `isFigmaUrl` (lives in `core/engine/loader.ts`). Inlined to
 * avoid a contracts/ → engine/ dependency cycle: contracts/ is meant to be
 * importable by every other layer, including engine/.
 */
function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

export const DesignKeySchema = z.string();
export type DesignKey = z.infer<typeof DesignKeySchema>;

/**
 * Compute the canonical `designKey` that uniquely identifies a design across
 * canicode runs.
 *
 * - **Figma URL** → `<fileKey>#<nodeId>` with `-` → `:` normalization on the
 *   nodeId (matching the Figma MCP convention). Example:
 *   `https://figma.com/design/abc123/My-File?node-id=42-100&t=ref` →
 *   `abc123#42:100`. Trailing query parameters other than `node-id`
 *   (`?t=...`, `?mode=...`) are dropped — they would otherwise break
 *   string-matching on re-runs.
 * - **Figma URL without `node-id`** → just `<fileKey>` (file-level key).
 * - **Anything else** (fixture directory, JSON path, raw filename) →
 *   absolute path via `node:path.resolve(input)`. Keeps fixture-based
 *   smoke tests stable across cwd.
 *
 * Both `gotcha-survey` and `analyze` MCP/CLI tools surface the result on
 * their response's top-level `designKey` field. The `canicode-gotchas` and
 * `canicode-roundtrip` SKILLs read that field directly — neither one
 * re-implements URL parsing in prose anymore (per ADR-016).
 */
export function computeDesignKey(input: string): string {
  if (isFigmaUrl(input)) {
    const { fileKey, nodeId } = parseFigmaUrl(input);
    if (!nodeId) return fileKey;
    return `${fileKey}#${nodeId.replace(/-/g, ":")}`;
  }
  return resolve(input);
}
