import { makeNode, makeFile, makeContext } from "../test-helpers.js";
import { prototypeLinkInDesign } from "./index.js";

describe("prototype-link-in-design", () => {
  it("has correct rule definition metadata", () => {
    expect(prototypeLinkInDesign.definition.id).toBe("prototype-link-in-design");
    expect(prototypeLinkInDesign.definition.category).toBe("handoff-risk");
  });

  it.todo("flags nodes with prototype/interaction links (AnalysisNode does not yet model interaction data)");
});
