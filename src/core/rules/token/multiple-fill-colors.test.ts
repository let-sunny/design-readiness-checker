import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { multipleFillColors } from "./index.js";

describe("multiple-fill-colors", () => {
  it("has correct rule definition metadata", () => {
    expect(multipleFillColors.definition.id).toBe("multiple-fill-colors");
    expect(multipleFillColors.definition.category).toBe("token");
  });

  it.todo("flags near-duplicate fill colors across sibling nodes (requires cross-node analysis in integration tests)");
});
