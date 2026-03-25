import { existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { FigmaClient } from "../adapters/figma-client.js";
import { resolveComponentDefinitions } from "../adapters/component-resolver.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse, transformFileNodesResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import { getFigmaToken } from "./config-store.js";
import type { AnalysisFile } from "../contracts/figma-node.js";

export interface LoadResult {
  file: AnalysisFile;
  nodeId?: string | undefined;
}

/** Check if input string is a Figma URL. */
export function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

/** Check if input string is a JSON file path. */
export function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

/**
 * Check if input is a fixture directory (contains data.json).
 */
export function isFixtureDir(input: string): boolean {
  const resolved = resolve(input);
  if (!existsSync(resolved)) return false;
  try {
    if (!statSync(resolved).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(resolved, "data.json"));
}

/**
 * Resolve fixture input to data.json path.
 * Input: fixtures/name/ or fixtures/name → fixtures/name/data.json
 */
export function resolveFixturePath(input: string): string {
  if (isJsonFile(input)) return resolve(input);
  return resolve(join(input, "data.json"));
}

/**
 * Load a Figma file from a URL, JSON file, or fixture directory.
 * Resolves component master node trees for accurate analysis.
 */
export async function loadFile(
  input: string,
  token?: string,
): Promise<LoadResult> {
  if (isJsonFile(input) || isFixtureDir(input)) {
    const filePath = resolveFixturePath(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.error(`Loading from JSON: ${filePath}`);
    return { file: await loadFigmaFileFromJson(filePath) };
  }

  if (isFigmaUrl(input)) {
    const { fileKey, nodeId } = parseFigmaUrl(input);
    return loadFromApi(fileKey, nodeId, token);
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or fixture directory path.`
  );
}

async function loadFromApi(
  fileKey: string,
  nodeId: string | undefined,
  token?: string
): Promise<LoadResult> {
  console.error(`Fetching from Figma REST API: ${fileKey}`);
  if (nodeId) {
    console.error(`Target node: ${nodeId}`);
  }

  const figmaToken = token ?? getFigmaToken();
  if (!figmaToken) {
    throw new Error(
      "Figma token required. Run 'canicode init --token YOUR_TOKEN' or set FIGMA_TOKEN env var."
    );
  }

  const client = new FigmaClient({ token: figmaToken });

  if (nodeId) {
    // Fetch only the target node subtree — faster, less rate limit impact
    const response = await client.getFileNodes(fileKey, [nodeId.replace(/-/g, ":")]);
    const file = transformFileNodesResponse(fileKey, response);

    // Resolve component master node trees for accurate analysis
    const componentDefs = await resolveComponentDefinitions(client, fileKey, file.document);
    if (Object.keys(componentDefs).length > 0) {
      file.componentDefinitions = componentDefs;
    }

    return { file, nodeId };
  }

  const response = await client.getFile(fileKey);
  const file = transformFigmaResponse(fileKey, response);

  // Full file fetch may still miss component masters from external libraries
  const componentDefs = await resolveComponentDefinitions(client, fileKey, file.document);
  if (Object.keys(componentDefs).length > 0) {
    file.componentDefinitions = componentDefs;
  }

  return { file, nodeId };
}
