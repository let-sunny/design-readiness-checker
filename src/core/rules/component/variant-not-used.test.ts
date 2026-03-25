import { variantNotUsed } from "./index.js";

describe("variant-not-used", () => {
  it("has correct rule definition metadata", () => {
    expect(variantNotUsed.definition.id).toBe("variant-not-used");
    expect(variantNotUsed.definition.category).toBe("component");
  });

  it.todo("flags instances not using available variants (requires component variant context)");
  it.todo("returns null when all available variants are used");
});
