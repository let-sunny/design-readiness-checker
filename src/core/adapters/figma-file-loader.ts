import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { GetFileResponse } from "@figma/rest-api-spec";
import type { AnalysisFile, AnalysisNode } from "../contracts/figma-node.js";
import { AnalysisNodeSchema } from "../contracts/figma-node.js";
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
  const data = JSON.parse(content) as GetFileResponse & {
    componentDefinitions?: Record<string, unknown>;
  };

  const fileKey = extractFileKey(filePath);

  const file = transformFigmaResponse(fileKey, data);

  // Preserve componentDefinitions from previously-saved fixtures
  if (data.componentDefinitions) {
    const parsed: Record<string, AnalysisNode> = {};
    for (const [id, raw] of Object.entries(data.componentDefinitions)) {
      const result = AnalysisNodeSchema.safeParse(raw);
      if (result.success) {
        parsed[id] = result.data;
      } else {
        console.debug(`[figma-file-loader] componentDefinitions[${id}] failed validation:`, result.error.issues);
      }
    }
    if (Object.keys(parsed).length > 0) {
      file.componentDefinitions = parsed;
    }
  }

  return file;
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
