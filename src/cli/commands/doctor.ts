import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { CAC } from "cac";

import { FigmaClient, FigmaClientError } from "../../core/adapters/figma-client.js";
import { parseFigmaUrl, FigmaUrlParseError } from "../../core/adapters/figma-url-parser.js";
import { getFigmaToken } from "../../core/engine/config-store.js";
import { trackEvent, EVENTS } from "../../core/monitoring/index.js";

export interface DoctorCheckResult {
  name: string;
  pass: boolean;
  /**
   * Marks a check that could not be completed (e.g. token missing, network
   * error, no node-id in the URL). Inconclusive results render with ⚠️ and
   * do not count toward the exit-code failure tally — the issue (#532) is
   * explicit that doctor is informational, not a hard gate. The Figma MCP
   * call in Step 7d remains the authority.
   */
  inconclusive?: boolean;
  detail?: string;
  remediation?: string;
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const CODE_CONNECT_PKG = "@figma/code-connect";
const CODE_CONNECT_DOCS = "https://www.figma.com/code-connect-docs/";

function readPackageJson(cwd: string): PackageJson | undefined {
  const pkgPath = join(cwd, "package.json");
  if (!existsSync(pkgPath)) return undefined;
  try {
    return JSON.parse(readFileSync(pkgPath, "utf-8")) as PackageJson;
  } catch {
    return undefined;
  }
}

function findCodeConnectVersion(pkg: PackageJson | undefined): string | undefined {
  if (!pkg) return undefined;
  return pkg.dependencies?.[CODE_CONNECT_PKG] ?? pkg.devDependencies?.[CODE_CONNECT_PKG];
}

export function runCodeConnectChecks(cwd: string): DoctorCheckResult[] {
  const pkg = readPackageJson(cwd);
  const ccVersion = findCodeConnectVersion(pkg);
  const figmaConfigExists = existsSync(join(cwd, "figma.config.json"));

  const results: DoctorCheckResult[] = [];

  if (ccVersion) {
    results.push({
      name: `${CODE_CONNECT_PKG} installed`,
      pass: true,
      detail: ccVersion,
    });
  } else {
    results.push({
      name: `${CODE_CONNECT_PKG} not installed`,
      pass: false,
      remediation: pkg
        ? `pnpm add -D ${CODE_CONNECT_PKG}  (or npm/yarn equivalent)`
        : `No package.json found at ${cwd} — run from your project root, or initialise one first.`,
    });
  }

  if (figmaConfigExists) {
    results.push({
      name: "figma.config.json found at repo root",
      pass: true,
    });
  } else {
    results.push({
      name: "figma.config.json not found at repo root",
      pass: false,
      remediation: `see ${CODE_CONNECT_DOCS}`,
    });
  }

  return results;
}

export interface FigmaPublishCheckInput {
  figmaUrl: string;
  token: string | undefined;
  /**
   * Injected at call sites for testability. Production wires this to
   * `FigmaClient.getPublishedComponents`.
   */
  fetchPublishedComponents:
    | ((fileKey: string) => Promise<Array<{ node_id: string; name: string }>>)
    | undefined;
}

const PUBLISH_CHECK_NAME = "Figma component published in a library";

/**
 * Async sibling to runCodeConnectChecks. Hits Figma REST API to verify the
 * target component appears in the file's published-components list. The Figma
 * REST API is the same source of truth `add_code_connect_map` consults, so a
 * ✅ here is a strong signal that Step 7d will succeed; ❌ is the early
 * remediation hint #532 wanted (today users only discover the publish gap
 * after Step 7d's API call fails).
 */
export async function runFigmaPublishCheck(
  input: FigmaPublishCheckInput,
): Promise<DoctorCheckResult> {
  const { figmaUrl, token, fetchPublishedComponents } = input;

  let parsed;
  try {
    parsed = parseFigmaUrl(figmaUrl);
  } catch (err) {
    const message = err instanceof FigmaUrlParseError ? err.message : String(err);
    return {
      name: PUBLISH_CHECK_NAME,
      pass: false,
      inconclusive: true,
      detail: `could not parse URL: ${message}`,
      remediation: "Pass a valid Figma design URL (figma.com/design/<file>?node-id=<id>).",
    };
  }

  if (!parsed.nodeId) {
    return {
      name: PUBLISH_CHECK_NAME,
      pass: false,
      inconclusive: true,
      detail: "URL is missing a node-id",
      remediation:
        "Code Connect mapping is per-component — invoke with a URL that targets a specific node (?node-id=…).",
    };
  }

  if (!token) {
    return {
      name: PUBLISH_CHECK_NAME,
      pass: false,
      inconclusive: true,
      detail: "FIGMA_TOKEN not configured — skipping publish-status check",
      remediation:
        "Set FIGMA_TOKEN (env var) or run `canicode config set-token` so doctor can verify this prereq inline.",
    };
  }

  if (!fetchPublishedComponents) {
    return {
      name: PUBLISH_CHECK_NAME,
      pass: false,
      inconclusive: true,
      detail: "no fetcher wired",
      remediation: "internal: doctor was called without a Figma client",
    };
  }

  let components: Array<{ node_id: string; name: string }>;
  try {
    components = await fetchPublishedComponents(parsed.fileKey);
  } catch (err) {
    const status = err instanceof FigmaClientError ? err.statusCode : undefined;
    const message = err instanceof Error ? err.message : String(err);
    return {
      name: PUBLISH_CHECK_NAME,
      pass: false,
      inconclusive: true,
      detail: `Figma API call failed${status ? ` (HTTP ${status})` : ""}: ${message}`,
      remediation:
        "Step 7d will rely on the API as the authority; if your token / network is OK, the canicode-roundtrip step itself will surface the publish error inline.",
    };
  }

  // Figma URLs encode node-ids with `-` (figma.com/.../?node-id=3384-3)
  // while the REST API returns the canonical `:` form (`3384:3`). Compare on
  // the canonical form so a URL fresh out of the browser address bar matches.
  const canonicalNodeId = parsed.nodeId.replace(/-/g, ":");
  const match = components.find(
    (c) => c.node_id === canonicalNodeId || c.node_id === parsed.nodeId,
  );
  if (match) {
    return {
      name: PUBLISH_CHECK_NAME,
      pass: true,
      detail: `${match.name} (${match.node_id})`,
    };
  }

  return {
    name: PUBLISH_CHECK_NAME,
    pass: false,
    detail: `node ${canonicalNodeId} is not in the published-components list for file ${parsed.fileKey}`,
    remediation:
      "Open the file in Figma → Assets panel → Publish library and include this component. Without publishing, `add_code_connect_map` fails with 'Published component not found.'",
  };
}

export function formatDoctorReport(results: DoctorCheckResult[]): string {
  const lines: string[] = ["Code Connect"];
  for (const result of results) {
    const icon = result.pass ? "✅" : result.inconclusive ? "⚠️" : "❌";
    const detail = result.detail ? ` (${result.detail})` : "";
    lines.push(`  ${icon} ${result.name}${detail}`);
    if (!result.pass && result.remediation) {
      lines.push(`     → ${result.remediation}`);
    }
  }
  lines.push("");
  const blocking = results.filter((r) => !r.pass && !r.inconclusive).length;
  const inconclusive = results.filter((r) => !r.pass && r.inconclusive).length;
  if (blocking === 0 && inconclusive === 0) {
    lines.push("All checks passed.");
  } else if (blocking === 0) {
    lines.push(
      "Blocking checks passed; some checks were skipped (⚠️) and could not be verified.",
    );
  } else {
    lines.push("Some checks failed. Fix the items above before running the Code Connect flow.");
  }
  return lines.join("\n");
}

interface DoctorCommandOptions {
  figmaUrl?: string;
}

export function registerDoctor(cli: CAC): void {
  cli
    .command(
      "doctor",
      "Diagnose Code Connect prerequisites (`@figma/code-connect`, `figma.config.json`)",
    )
    .option(
      "--figma-url <url>",
      "Optionally check that the target Figma component is published in a library (requires FIGMA_TOKEN)",
    )
    .action(async (options: DoctorCommandOptions) => {
      const cwd = process.cwd();
      const results = runCodeConnectChecks(cwd);

      if (options.figmaUrl) {
        const token = getFigmaToken();
        const client = token ? new FigmaClient({ token }) : undefined;
        const publishCheck = await runFigmaPublishCheck({
          figmaUrl: options.figmaUrl,
          token,
          fetchPublishedComponents: client
            ? (fileKey) => client.getPublishedComponents(fileKey)
            : undefined,
        });
        results.push(publishCheck);
      }

      console.log(formatDoctorReport(results));

      const passed = results.filter((r) => r.pass).length;
      const inconclusive = results.filter((r) => !r.pass && r.inconclusive).length;
      const failed = results.length - passed - inconclusive;

      trackEvent(EVENTS.CLI_DOCTOR, {
        passed,
        failed,
        total: results.length,
      });

      if (failed > 0) {
        process.exitCode = 1;
      }
    });
}
