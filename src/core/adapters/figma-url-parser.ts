import { z } from "zod";

export const FigmaUrlInfoSchema = z.object({
  fileKey: z.string(),
  nodeId: z.string().optional(),
  fileName: z.string().optional(),
});

export type FigmaUrlInfo = z.infer<typeof FigmaUrlInfoSchema>;

const FIGMA_URL_PATTERNS = [
  // https://www.figma.com/design/FILE_KEY/FILE_NAME?node-id=NODE_ID
  /figma\.com\/design\/([a-zA-Z0-9]+)(?:\/([^?]+))?(?:\?.*node-id=([^&]+))?/,
  // https://www.figma.com/file/FILE_KEY/FILE_NAME?node-id=NODE_ID
  /figma\.com\/file\/([a-zA-Z0-9]+)(?:\/([^?]+))?(?:\?.*node-id=([^&]+))?/,
  // https://www.figma.com/proto/FILE_KEY/FILE_NAME?node-id=NODE_ID
  /figma\.com\/proto\/([a-zA-Z0-9]+)(?:\/([^?]+))?(?:\?.*node-id=([^&]+))?/,
];

export function parseFigmaUrl(url: string): FigmaUrlInfo {
  for (const pattern of FIGMA_URL_PATTERNS) {
    const match = url.match(pattern);
    if (match) {
      const [, fileKey, fileName, nodeId] = match;
      if (!fileKey) {
        throw new FigmaUrlParseError(`Invalid Figma URL: missing file key`);
      }
      return {
        fileKey,
        fileName: fileName ? decodeURIComponent(fileName) : undefined,
        nodeId: nodeId ? decodeURIComponent(nodeId) : undefined,
      };
    }
  }

  throw new FigmaUrlParseError(
    `Invalid Figma URL format. Expected: https://www.figma.com/design/FILE_KEY/...`
  );
}

export class FigmaUrlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FigmaUrlParseError";
  }
}

export function buildFigmaDeepLink(fileKey: string, nodeId: string): string {
  return `https://www.figma.com/design/${fileKey}?node-id=${encodeURIComponent(nodeId)}`;
}
