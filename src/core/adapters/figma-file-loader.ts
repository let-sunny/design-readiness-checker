import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { GetFileResponse } from "@figma/rest-api-spec";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { transformFigmaResponse } from "./figma-transformer.js";

/**
 * Extract fileKey from fixture path.
 * - fixtures/name/data.json → name (directory-based fixture)
 * - fixtures/name.json → name (legacy flat fixture)
 */
function extractFileKey(filePath: string): string {
  const fileName = basename(filePath, ".json");
  if (fileName === "data") {
    // Directory-based fixture: use parent directory name
    return basename(dirname(filePath));
  }
  return fileName;
}

/**
 * Load Figma data from a JSON file
 * For MVP testing and fixture support
 */
export async function loadFigmaFileFromJson(
  filePath: string
): Promise<AnalysisFile> {
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content) as GetFileResponse;

  const fileKey = extractFileKey(filePath);

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
