import { resolve } from "node:path";
import { computeDesignKey } from "./design-key.js";

describe("computeDesignKey", () => {
  describe("Figma URLs", () => {
    it("returns <fileKey>#<nodeId> for a /design URL with node-id", () => {
      expect(
        computeDesignKey(
          "https://www.figma.com/design/abc123XYZ/My-File?node-id=42-100",
        ),
      ).toBe("abc123XYZ#42:100");
    });

    it("normalizes hyphens in node-id to colons (Figma MCP convention)", () => {
      expect(
        computeDesignKey(
          "https://www.figma.com/design/abc/file?node-id=1442-7704",
        ),
      ).toBe("abc#1442:7704");
    });

    it("works with the legacy /file/ URL shape", () => {
      expect(
        computeDesignKey(
          "https://www.figma.com/file/abc123/My-File?node-id=10-20",
        ),
      ).toBe("abc123#10:20");
    });

    it("works with the /proto/ URL shape", () => {
      expect(
        computeDesignKey(
          "https://www.figma.com/proto/abc123/My-File?node-id=10-20",
        ),
      ).toBe("abc123#10:20");
    });

    it("drops other query parameters before computing the key", () => {
      const withTimestamp = computeDesignKey(
        "https://www.figma.com/design/abc/file?node-id=42-100&t=2bMe9JywGwbeF7Ec-4",
      );
      expect(withTimestamp).toBe("abc#42:100");

      const withMode = computeDesignKey(
        "https://www.figma.com/design/abc/file?mode=dev&node-id=42-100",
      );
      expect(withMode).toBe("abc#42:100");
    });

    it("returns just the fileKey when the URL has no node-id", () => {
      expect(
        computeDesignKey("https://www.figma.com/design/abc123/My-File"),
      ).toBe("abc123");
    });

    it("preserves an already-colon-formatted node-id", () => {
      // The URL shape `?node-id=42:100` is uncommon (Figma uses hyphens) but
      // possible — round-tripping the colon shouldn't break it.
      expect(
        computeDesignKey("https://www.figma.com/design/abc/file?node-id=42:100"),
      ).toBe("abc#42:100");
    });

    it("handles instance-internal IDs verbatim once normalized", () => {
      // I-prefixed ids are kept; the Comments-API-friendly stripping lives
      // elsewhere (toCommentableNodeId) and is intentionally out of scope
      // here — the design key is a substring-match identifier, not a
      // commentable node id.
      expect(
        computeDesignKey(
          "https://www.figma.com/design/abc/file?node-id=I3010-7457",
        ),
      ).toBe("abc#I3010:7457");
    });
  });

  describe("non-Figma inputs (fixtures / JSON paths / raw names)", () => {
    it("resolves a relative fixture directory to an absolute path", () => {
      expect(computeDesignKey("fixtures/simple")).toBe(
        resolve("fixtures/simple"),
      );
    });

    it("resolves a relative JSON file to an absolute path", () => {
      expect(computeDesignKey("./fixtures/simple/data.json")).toBe(
        resolve("./fixtures/simple/data.json"),
      );
    });

    it("returns absolute paths unchanged", () => {
      const absolute = "/Users/me/project/fixtures/simple/data.json";
      expect(computeDesignKey(absolute)).toBe(absolute);
    });

    it("resolves any non-URL string (raw name) against cwd", () => {
      expect(computeDesignKey("scratch")).toBe(resolve("scratch"));
    });
  });
});
