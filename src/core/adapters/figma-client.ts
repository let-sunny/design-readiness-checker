import type { GetFileResponse, Node } from "@figma/rest-api-spec";

const FIGMA_API_BASE = "https://api.figma.com/v1";

export interface GetFileNodesResponse {
  name: string;
  lastModified: string;
  version: string;
  nodes: Record<string, {
    document: Node;
    components: GetFileResponse["components"];
    styles: GetFileResponse["styles"];
  }>;
}

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

  /**
   * Get rendered images for specific nodes
   * Returns a map of nodeId → image URL
   */
  async getNodeImages(
    fileKey: string,
    nodeIds: string[],
    options?: { format?: "png" | "svg" | "jpg"; scale?: number }
  ): Promise<Record<string, string | null>> {
    const format = options?.format ?? "png";
    const scale = options?.scale ?? 2;

    // Batch into chunks to avoid 414 URI Too Large
    const BATCH_SIZE = 50;
    const allImages: Record<string, string | null> = {};

    for (let i = 0; i < nodeIds.length; i += BATCH_SIZE) {
      const batch = nodeIds.slice(i, i + BATCH_SIZE);
      const ids = batch.join(",");
      const url = `${FIGMA_API_BASE}/images/${fileKey}?ids=${encodeURIComponent(ids)}&format=${format}&scale=${scale}`;
      const response = await fetch(url, {
        headers: {
          "X-Figma-Token": this.token,
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new FigmaClientError(
          `Failed to fetch images: ${response.status} ${response.statusText}`,
          response.status,
          error
        );
      }

      const data = await response.json() as { images: Record<string, string | null> };
      for (const [nodeId, imageUrl] of Object.entries(data.images)) {
        allImages[nodeId] = imageUrl;
      }
    }

    return allImages;
  }

  /**
   * Get original image fill URLs by imageRef.
   * Returns a mapping of imageRef → download URL for all image fills in the file.
   */
  async getImageFills(fileKey: string): Promise<Record<string, string>> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}/images`;
    const response = await fetch(url, {
      headers: { "X-Figma-Token": this.token },
    });
    if (!response.ok) {
      const error = await response.text().catch(() => "");
      throw new FigmaClientError(
        `Failed to fetch image fills: ${response.status} ${response.statusText}`,
        response.status,
        error
      );
    }
    const data = await response.json() as { meta?: { images?: Record<string, string> } };
    return data.meta?.images ?? {};
  }

  /**
   * Download an image URL and return as base64
   */
  async fetchImageAsBase64(imageUrl: string): Promise<string> {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new FigmaClientError(
        `Failed to download image: ${response.status}`,
        response.status
      );
    }
    const buffer = await response.arrayBuffer();
    return Buffer.from(buffer).toString("base64");
  }

  /**
   * Get the components a file has published to a team library.
   *
   * `GET /v1/files/:file_key/components` returns only components that have
   * been pushed via the Publish Library action — local-but-unpublished
   * components are absent. This is the authoritative way to detect whether
   * a Figma component is mappable via Code Connect (#532): `add_code_connect_map`
   * requires a published component and otherwise fails with "Published
   * component not found."
   */
  async getPublishedComponents(
    fileKey: string,
  ): Promise<Array<{ key: string; node_id: string; name: string }>> {
    const url = `${FIGMA_API_BASE}/files/${fileKey}/components`;
    const response = await fetch(url, {
      headers: { "X-Figma-Token": this.token },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new FigmaClientError(
        `Failed to fetch published components: ${response.status} ${response.statusText}`,
        response.status,
        error,
      );
    }
    const data = (await response.json()) as {
      meta?: { components?: Array<{ key: string; node_id: string; name: string }> };
    };
    return data.meta?.components ?? [];
  }

  async getFileNodes(
    fileKey: string,
    nodeIds: string[]
  ): Promise<GetFileNodesResponse> {
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

    return response.json() as Promise<GetFileNodesResponse>;
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
