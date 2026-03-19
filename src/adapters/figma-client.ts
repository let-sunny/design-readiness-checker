import type { GetFileResponse } from "@figma/rest-api-spec";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface FigmaClientOptions {
  token: string;
}

export class FigmaClient {
  private token: string;

  constructor(options: FigmaClientOptions) {
    this.token = options.token;
  }

  static fromEnv(): FigmaClient {
    const token = process.env["FIGMA_TOKEN"];
    if (!token) {
      throw new FigmaClientError(
        "FIGMA_TOKEN environment variable is not set"
      );
    }
    return new FigmaClient({ token });
  }

  async getFile(fileKey: string): Promise<GetFileResponse> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}`;
    const response = await fetch(url, {
      headers: {
        "X-Figma-Token": this.token,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new FigmaClientError(
        `Failed to fetch file: ${response.status} ${response.statusText}`,
        response.status,
        error
      );
    }

    return response.json() as Promise<GetFileResponse>;
  }

  async getFileNodes(
    fileKey: string,
    nodeIds: string[]
  ): Promise<GetFileResponse> {
    const ids = nodeIds.join(",");
    const url = `${FIGMA_API_BASE}/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`;
    const response = await fetch(url, {
      headers: {
        "X-Figma-Token": this.token,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new FigmaClientError(
        `Failed to fetch nodes: ${response.status} ${response.statusText}`,
        response.status,
        error
      );
    }

    return response.json() as Promise<GetFileResponse>;
  }
}

export class FigmaClientError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: unknown
  ) {
    super(message);
    this.name = "FigmaClientError";
  }
}
