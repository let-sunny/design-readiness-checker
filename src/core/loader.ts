import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { FigmaClient } from "../adapters/figma-client.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import { parseMcpMetadataXml } from "../adapters/figma-mcp-adapter.js";
import { getFigmaToken } from "./config-store.js";
import type { AnalysisFile } from "../contracts/figma-node.js";

export type LoadMode = "mcp" | "api" | "auto";

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
  mode: LoadMode = "auto"
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
    const { fileKey, nodeId, fileName } = parseFigmaUrl(input);

    if (mode === "mcp") {
      return loadFromMcp(fileKey, nodeId, fileName);
    }

    if (mode === "api") {
      return loadFromApi(fileKey, nodeId, token);
    }

    // Auto mode: try MCP first, fallback to API
    try {
      console.log("Auto-detecting data source... trying MCP first.");
      return await loadFromMcp(fileKey, nodeId, fileName);
    } catch (mcpError) {
      const mcpMsg = mcpError instanceof Error ? mcpError.message : String(mcpError);
      console.log(`MCP unavailable (${mcpMsg}). Falling back to REST API.`);
      return loadFromApi(fileKey, nodeId, token);
    }
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
}

async function loadFromMcp(
  fileKey: string,
  nodeId: string | undefined,
  fileName: string | undefined
): Promise<LoadResult> {
  console.log(`Loading via MCP: ${fileKey} (node: ${nodeId ?? "root"})`);
  const file = await loadViaMcp(fileKey, nodeId ?? "0:1", fileName);
  return { file, nodeId };
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

/**
 * Load Figma data via MCP Desktop bridge (no REST API, no rate limit).
 * Only works when called from CLI with Claude Code available.
 */
async function loadViaMcp(
  fileKey: string,
  nodeId: string,
  fileName?: string
): Promise<AnalysisFile> {
  const { execSync } = await import("node:child_process");

  const result = execSync(
    `claude --print "Use the mcp__figma__get_metadata tool with fileKey=\\"${fileKey}\\" and nodeId=\\"${nodeId.replace(/-/g, ":")}\\" — return ONLY the raw XML output, nothing else."`,
    { encoding: "utf-8", timeout: 120000 }
  );

  const xmlStart = result.indexOf("<");
  const xmlEnd = result.lastIndexOf(">");
  if (xmlStart === -1 || xmlEnd === -1) {
    throw new Error("MCP did not return valid XML metadata");
  }
  const xml = result.slice(xmlStart, xmlEnd + 1);

  return parseMcpMetadataXml(xml, fileKey, fileName);
}
