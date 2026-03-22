import type { GetFileResponse } from "@figma/rest-api-spec";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { parseMcpMetadataXml } from "../adapters/figma-mcp-adapter.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";

/**
 * Parse design data passed directly from Figma MCP or other sources.
 *
 * Accepts:
 * - XML string from Figma MCP get_metadata
 * - JSON string of an AnalysisFile object
 * - JSON string of a Figma REST API GetFileResponse
 */
export function parseDesignData(
  data: string,
  fileKey: string,
  fileName?: string
): AnalysisFile {
  const trimmed = data.trim();

  // Detect XML (starts with <)
  if (trimmed.startsWith("<")) {
    return parseMcpMetadataXml(trimmed, fileKey, fileName);
  }

  // Try JSON
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;

  // If it already looks like AnalysisFile (has fileKey + document)
  if ("fileKey" in parsed && "document" in parsed) {
    return parsed as unknown as AnalysisFile;
  }

  // If it looks like Figma REST API response (has document + name but no fileKey)
  if ("document" in parsed && "name" in parsed) {
    return transformFigmaResponse(fileKey, parsed as unknown as GetFileResponse);
  }

  throw new Error(
    "Unrecognized designData format. Expected XML from Figma MCP get_metadata, AnalysisFile JSON, or Figma REST API JSON."
  );
}
