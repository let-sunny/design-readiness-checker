import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { GetFileResponse } from "@figma/rest-api-spec";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { transformFigmaResponse } from "./figma-transformer.js";

/**
 * Load Figma data from a JSON file
 * For MVP testing and fixture support
 */
export async function loadFigmaFileFromJson(
  filePath: string
): Promise<AnalysisFile> {
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content) as GetFileResponse;

  // Extract fileKey from filename (e.g., ABC123.json -> ABC123)
  const fileKey = basename(filePath, ".json");

  return transformFigmaResponse(fileKey, data);
}

/**
 * Parse Figma data from a JSON string
 */
export function parseFigmaJson(
  json: string,
  fileKey: string
): AnalysisFile {
  const data = JSON.parse(json) as GetFileResponse;
  return transformFigmaResponse(fileKey, data);
}

export class FigmaFileLoadError extends Error {
  constructor(message: string, public filePath?: string) {
    super(message);
    this.name = "FigmaFileLoadError";
  }
}
