import { parseCodeConnectMappings } from "./code-connect-mapping-parser.js";
import type { CodeConnectCoverage } from "../../engine/scoring.js";

/**
 * Code Connect coverage = mapped / total components in this Figma file (#526).
 *
 * Returns undefined when figma.config.json is absent (`skipReason === "no-config"`)
 * — without Code Connect setup, the metric isn't meaningful and would just add
 * noise to the report. Misconfigured-but-adopted projects (malformed JSON,
 * empty `include`) emit coverage as 0/N so the user sees they have unmapped
 * components and a configuration to fix.
 */
export function computeCodeConnectCoverage(
  components: Record<string, { key: string; name: string; description: string }>,
  cwd: string = process.cwd(),
): CodeConnectCoverage | undefined {
  const result = parseCodeConnectMappings(cwd);
  if (result.skipReason === "no-config") return undefined;
  const componentNodeIds = Object.keys(components);
  let mapped = 0;
  for (const nodeId of componentNodeIds) {
    if (result.mappedNodeIds.has(nodeId)) mapped++;
  }
  return { mapped, total: componentNodeIds.length };
}
