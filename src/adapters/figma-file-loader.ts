import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { GetFileResponse } from "@figma/rest-api-spec";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { transformFigmaResponse } from "./figma-transformer.js";

/**
 * JSON 파일에서 Figma 데이터 로드
 * MVP 테스트 및 fixture 지원용
 */
export async function loadFigmaFileFromJson(
  filePath: string
): Promise<AnalysisFile> {
  const content = await readFile(filePath, "utf-8");
  const data = JSON.parse(content) as GetFileResponse;

  // 파일 이름에서 fileKey 추출 (예: ABC123.json -> ABC123)
  const fileKey = basename(filePath, ".json");

  return transformFigmaResponse(fileKey, data);
}

/**
 * JSON 문자열에서 Figma 데이터 파싱
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
