import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FigmaClient } from "../adapters/figma-client.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import { getFigmaToken } from "./config-store.js";
import type { AnalysisFile } from "../contracts/figma-node.js";

export interface LoadResult {
  file: AnalysisFile;
  nodeId?: string | undefined;
}

export function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

export function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

export async function loadFile(
  input: string,
  token?: string,
): Promise<LoadResult> {
  if (isJsonFile(input)) {
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log(`Loading from JSON: ${filePath}`);
    return { file: await loadFigmaFileFromJson(filePath) };
  }

  if (isFigmaUrl(input)) {
    const { fileKey, nodeId } = parseFigmaUrl(input);
    return loadFromApi(fileKey, nodeId, token);
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
}

async function loadFromApi(
  fileKey: string,
  nodeId: string | undefined,
  token?: string
): Promise<LoadResult> {
  console.log(`Fetching from Figma REST API: ${fileKey}`);
  if (nodeId) {
    console.log(`Target node: ${nodeId}`);
  }

  const figmaToken = token ?? getFigmaToken();
  if (!figmaToken) {
    throw new Error(
      "Figma token required. Run 'canicode init --token YOUR_TOKEN' or set FIGMA_TOKEN env var."
    );
  }

  const client = new FigmaClient({ token: figmaToken });
  const response = await client.getFile(fileKey);
  return {
    file: transformFigmaResponse(fileKey, response),
    nodeId,
  };
}
