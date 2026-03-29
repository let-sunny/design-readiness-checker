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
