import {
  isInstanceChildNodeId,
  parseInstanceChildNodeId,
} from "./instance-id-parser.js";

describe("isInstanceChildNodeId", () => {
  it("returns false for plain Figma node ids", () => {
    expect(isInstanceChildNodeId("348:15903")).toBe(false);
  });

  it("returns false for ids that start with I but have no semicolon", () => {
    expect(isInstanceChildNodeId("Iceberg")).toBe(false);
  });

  it("returns true for simple instance-child ids", () => {
    expect(isInstanceChildNodeId("I348:15903;2153:7840")).toBe(true);
  });

  it("returns true for nested instance-child ids", () => {
    expect(isInstanceChildNodeId("I348:15903;1442:7704;2153:7840")).toBe(true);
  });
});

describe("parseInstanceChildNodeId", () => {
  it("returns null for plain Figma node ids", () => {
    expect(parseInstanceChildNodeId("348:15903")).toBeNull();
  });

  it("returns null for malformed I-prefixed ids without a semicolon", () => {
    expect(parseInstanceChildNodeId("I348:15903")).toBeNull();
  });

  it("splits a simple instance-child id into parent + source", () => {
    expect(parseInstanceChildNodeId("I348:15903;2153:7840")).toEqual({
      parentInstanceId: "348:15903",
      sourceNodeId: "2153:7840",
    });
  });

  it("takes the LAST segment as source for nested instance ids", () => {
    expect(
      parseInstanceChildNodeId("I348:15903;1442:7704;2153:7840"),
    ).toEqual({
      parentInstanceId: "348:15903",
      sourceNodeId: "2153:7840",
    });
  });

  it("returns null when the source segment is empty", () => {
    expect(parseInstanceChildNodeId("I348:15903;")).toBeNull();
  });

  it("returns null when the parent segment is empty after stripping I", () => {
    expect(parseInstanceChildNodeId("I;2153:7840")).toBeNull();
  });
});
