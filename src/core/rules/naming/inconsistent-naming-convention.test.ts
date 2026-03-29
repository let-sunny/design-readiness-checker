import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { inconsistentNamingConvention } from "./index.js";

describe("inconsistent-naming-convention", () => {
  it("has correct rule definition metadata", () => {
    expect(inconsistentNamingConvention.definition.id).toBe("inconsistent-naming-convention");
    expect(inconsistentNamingConvention.definition.category).toBe("minor");
  });

  it("flags node with different convention from dominant siblings", () => {
    const sibA = makeNode({ id: "2:1", name: "my-card" });
    const sibB = makeNode({ id: "2:2", name: "my-header" });
    const node = makeNode({ id: "1:1", name: "myFooter" }); // camelCase vs kebab-case
    const siblings = [node, sibA, sibB];

    const result = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
    expect(result!.ruleId).toBe("inconsistent-naming-convention");
    expect(result!.message).toContain("camelCase");
    expect(result!.message).toContain("kebab-case");
  });

  it("returns null when all siblings use the same convention", () => {
    const sibA = makeNode({ id: "2:1", name: "my-card" });
    const sibB = makeNode({ id: "2:2", name: "my-header" });
    const node = makeNode({ id: "1:1", name: "my-footer" });
    const siblings = [node, sibA, sibB];

    expect(inconsistentNamingConvention.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("returns null when no siblings", () => {
    const node = makeNode({ name: "my-card" });
    expect(inconsistentNamingConvention.check(node, makeContext())).toBeNull();
  });

  it("returns null when fewer than 2 siblings", () => {
    const node = makeNode({ name: "my-card" });
    expect(inconsistentNamingConvention.check(node, makeContext({ siblings: [node] }))).toBeNull();
  });

  it("is deterministic when sibling conventions are tied", () => {
    const kebab = makeNode({ id: "2:1", name: "my-card" });
    const camel = makeNode({ id: "2:2", name: "myHeader" });
    const node = makeNode({ id: "1:1", name: "myFooter" });
    const siblings = [node, kebab, camel];

    const first = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    const second = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(second).toEqual(first);
  });

  it("returns null when convention cannot be detected", () => {
    const sibA = makeNode({ id: "2:1", name: "123" });
    const node = makeNode({ id: "1:1", name: "456" });
    const siblings = [node, sibA];

    expect(inconsistentNamingConvention.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("does not flag single-word PascalCase in Title Case context", () => {
    // "Rating" is a single capitalized word — ambiguous between PascalCase and Title Case
    const sibA = makeNode({ id: "2:1", name: "Card Grid" }); // Title Case
    const sibB = makeNode({ id: "2:2", name: "Review Card" }); // Title Case
    const node = makeNode({ id: "1:1", name: "Rating" }); // single word — should be ambiguous
    const siblings = [node, sibA, sibB];

    expect(inconsistentNamingConvention.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("flags single-word PascalCase in camelCase context with concrete suggestion", () => {
    const sibA = makeNode({ id: "2:1", name: "myCard" }); // camelCase
    const sibB = makeNode({ id: "2:2", name: "myFooter" }); // camelCase
    const node = makeNode({ id: "1:1", name: "Button" }); // PascalCase — not compatible with camelCase
    const siblings = [node, sibA, sibB];

    const result = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
    expect(result!.suggestion).toContain('"button"');
  });

  it("does not let ambiguous single-words bias dominant convention", () => {
    // "Header" and "Footer" are single-word — ambiguous between PascalCase and Title Case
    // They should not inflate PascalCase count and cause "Product Card" to be flagged
    const sibA = makeNode({ id: "2:1", name: "Header" });
    const sibB = makeNode({ id: "2:2", name: "Footer" });
    const node = makeNode({ id: "1:1", name: "Product Card" }); // Title Case — should NOT be flagged
    const siblings = [node, sibA, sibB];

    expect(inconsistentNamingConvention.check(node, makeContext({ siblings }))).toBeNull();
  });

  it("still flags single-word PascalCase in non-Title-Case context", () => {
    // Ambiguity discount only applies when Title Case is present
    const sibA = makeNode({ id: "2:1", name: "my-card" }); // kebab-case
    const sibB = makeNode({ id: "2:2", name: "my-header" }); // kebab-case
    const node = makeNode({ id: "1:1", name: "Button" }); // PascalCase — should be flagged
    const siblings = [node, sibA, sibB];

    const result = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
  });

  it("splits acronym runs correctly in suggested name", () => {
    const sibA = makeNode({ id: "2:1", name: "my-card" }); // kebab-case
    const sibB = makeNode({ id: "2:2", name: "my-header" }); // kebab-case
    const node = makeNode({ id: "1:1", name: "myURLParser" }); // camelCase with acronym
    const siblings = [node, sibA, sibB];

    const result = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
    expect(result!.suggestion).toContain('"my-url-parser"');
  });

  it("still flags multi-word PascalCase in Title Case context", () => {
    const sibA = makeNode({ id: "2:1", name: "Card Grid" }); // Title Case
    const sibB = makeNode({ id: "2:2", name: "Review Card" }); // Title Case
    const node = makeNode({ id: "1:1", name: "ProductCard" }); // multi-word PascalCase
    const siblings = [node, sibA, sibB];

    const result = inconsistentNamingConvention.check(node, makeContext({ siblings }));
    expect(result).not.toBeNull();
    expect(result!.message).toContain("PascalCase");
  });
});
