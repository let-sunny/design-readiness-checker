import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAutoFix,
  applyAutoFixes,
  type AutoFixIssueInput,
} from "./apply-auto-fix.js";
import {
  createFigmaGlobal,
  installFigmaGlobal,
  uninstallFigmaGlobal,
  type FigmaGlobalMock,
} from "./test-utils.js";
import type {
  AnnotationEntry,
  CanicodeCategories,
  FigmaNode,
} from "./types.js";

const CATEGORIES: CanicodeCategories = {
  gotcha: "cat-gotcha",
  flag: "cat-flag",
  fallback: "cat-fallback",
};

let mock: FigmaGlobalMock;

afterEach(() => {
  uninstallFigmaGlobal();
});

describe("applyAutoFix — naming branch (suggestedName present)", () => {
  let scene: FigmaNode;

  beforeEach(() => {
    scene = {
      id: "scene-1",
      name: "frame-old",
      type: "FRAME",
      annotations: [],
    };
    mock = createFigmaGlobal({ nodes: { "scene-1": scene } });
    installFigmaGlobal(mock);
  });

  it("renames the scene node and returns outcome 🔧", async () => {
    const issue: AutoFixIssueInput = {
      nodeId: "scene-1",
      ruleId: "non-standard-naming",
      applyStrategy: "auto-fix",
      targetProperty: "name",
      suggestedName: "Hover",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome.outcome).toBe("🔧");
    expect(outcome.nodeId).toBe("scene-1");
    expect(outcome.ruleId).toBe("non-standard-naming");
    // Re-read happens after the rename, so the outcome's nodeName reflects
    // the post-rename label.
    expect(outcome.nodeName).toBe("Hover");
    expect(scene.name).toBe("Hover");
    // applyWithInstanceFallback returns the tier-1 success label as-is.
    expect(outcome.label).toMatch(/instance\/scene/);
  });

  it("translates ✅ from applyWithInstanceFallback to 🔧 (Strategy D vocabulary)", async () => {
    const issue: AutoFixIssueInput = {
      nodeId: "scene-1",
      ruleId: "inconsistent-naming-convention",
      applyStrategy: "auto-fix",
      targetProperty: "name",
      suggestedName: "my-url-parser",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    // The internal RoundtripResult.icon is ✅; the helper must remap it so
    // the SKILL prose can count 🔧 lines as auto-fixes (✅ is reserved for
    // Strategy A property writes).
    expect(outcome.outcome).toBe("🔧");
  });
});

describe("applyAutoFix — instance-child rename via applyWithInstanceFallback", () => {
  it("rename succeeds on the scene tier (instance child accepts node.name writes per Experiment 08) → 🔧", async () => {
    // Experiment 08 confirmed `node.name` is one of the rare properties that
    // accepts a raw write on instance children. The helper writes via
    // applyWithInstanceFallback so the path is exercised end-to-end here.
    const sceneInstanceChild: FigmaNode = {
      id: "instance-child-1",
      name: "Frame 42",
      type: "FRAME",
      annotations: [],
    };
    const sourceDef: FigmaNode = {
      id: "source-def-1",
      name: "Frame 42",
      type: "FRAME",
      annotations: [],
    };
    mock = createFigmaGlobal({
      nodes: {
        "instance-child-1": sceneInstanceChild,
        "source-def-1": sourceDef,
      },
    });
    installFigmaGlobal(mock);

    const issue: AutoFixIssueInput = {
      nodeId: "instance-child-1",
      ruleId: "non-standard-naming",
      applyStrategy: "auto-fix",
      targetProperty: "name",
      suggestedName: "Pressed",
      sourceChildId: "source-def-1",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome.outcome).toBe("🔧");
    expect(sceneInstanceChild.name).toBe("Pressed");
    // Definition must NOT be touched on the happy path — ADR-012 default,
    // and the scene write succeeded so no fallback fires.
    expect(sourceDef.name).toBe("Frame 42");
  });
});

describe("applyAutoFix — annotation branch (non-naming auto-fixes)", () => {
  let scene: FigmaNode;

  beforeEach(() => {
    scene = {
      id: "scene-1",
      name: "Container",
      type: "FRAME",
      annotations: [],
    };
    mock = createFigmaGlobal({ nodes: { "scene-1": scene } });
    installFigmaGlobal(mock);
  });

  it("writes an annotation under categories.flag for raw-value rules → 📝", async () => {
    const issue: AutoFixIssueInput = {
      nodeId: "scene-1",
      ruleId: "raw-value",
      applyStrategy: "auto-fix",
      message: "Raw color #FF0000 should bind to a token.",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome).toEqual({
      outcome: "📝",
      nodeId: "scene-1",
      nodeName: "Container",
      ruleId: "raw-value",
      label: expect.stringContaining("annotation added to canicode:flag"),
    });
    const annotations = scene.annotations as readonly AnnotationEntry[];
    expect(annotations).toHaveLength(1);
    expect(annotations[0]?.categoryId).toBe(CATEGORIES.flag);
    expect(annotations[0]?.labelMarkdown).toMatch(
      /Raw color #FF0000 should bind to a token\./
    );
    // The footer marker upsertCanicodeAnnotation appends — used by Step 5a
    // acknowledgment harvesting.
    expect(annotations[0]?.labelMarkdown).toMatch(/— \*raw-value\*$/);
  });

  it("forwards annotationProperties when present (Dev Mode property surface)", async () => {
    const issue: AutoFixIssueInput = {
      nodeId: "scene-1",
      ruleId: "missing-interaction-state",
      applyStrategy: "auto-fix",
      message: "Add hover / pressed states.",
      annotationProperties: [{ type: "fills" }],
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome.outcome).toBe("📝");
    const annotations = scene.annotations as readonly AnnotationEntry[];
    expect(annotations[0]?.properties).toEqual([{ type: "fills" }]);
  });

  it("falls back to a generic markdown when issue.message is absent", async () => {
    const issue: AutoFixIssueInput = {
      nodeId: "scene-1",
      ruleId: "missing-prototype",
      applyStrategy: "auto-fix",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome.outcome).toBe("📝");
    const annotations = scene.annotations as readonly AnnotationEntry[];
    expect(annotations[0]?.labelMarkdown).toMatch(/Auto-flagged: missing-prototype/);
  });

  it("returns 📝 with a 'missing node' label when getNodeByIdAsync returns null", async () => {
    mock = createFigmaGlobal({ nodes: {} });
    installFigmaGlobal(mock);
    const issue: AutoFixIssueInput = {
      nodeId: "stale-id",
      ruleId: "raw-value",
      applyStrategy: "auto-fix",
      message: "Bind to token",
      nodePath: "Page › Frame › StaleButton",
    };
    const outcome = await applyAutoFix(issue, { categories: CATEGORIES });
    expect(outcome.outcome).toBe("📝");
    expect(outcome.nodeName).toBe("StaleButton");
    expect(outcome.label).toMatch(/missing node/);
  });
});

describe("applyAutoFixes — loop wrapper with filtering", () => {
  it("filters out non-auto-fix issues with outcome ⏭️ and applies the rest", async () => {
    const namingScene: FigmaNode = {
      id: "n-1",
      name: "old",
      type: "FRAME",
      annotations: [],
    };
    const annotationScene: FigmaNode = {
      id: "a-1",
      name: "Body",
      type: "FRAME",
      annotations: [],
    };
    mock = createFigmaGlobal({
      nodes: { "n-1": namingScene, "a-1": annotationScene },
    });
    installFigmaGlobal(mock);

    const issues: AutoFixIssueInput[] = [
      {
        nodeId: "skip-1",
        ruleId: "missing-size-constraint",
        applyStrategy: "property-mod",
        nodePath: "Root › Skipped",
      },
      {
        nodeId: "n-1",
        ruleId: "non-standard-naming",
        applyStrategy: "auto-fix",
        targetProperty: "name",
        suggestedName: "Hover",
      },
      {
        nodeId: "skip-2",
        ruleId: "deep-nesting",
        applyStrategy: "structural-mod",
      },
      {
        nodeId: "a-1",
        ruleId: "raw-value",
        applyStrategy: "auto-fix",
        message: "Bind raw color to token.",
      },
    ];
    const outcomes = await applyAutoFixes(issues, { categories: CATEGORIES });

    expect(outcomes.map((o) => o.outcome)).toEqual(["⏭️", "🔧", "⏭️", "📝"]);
    // Skipped entries carry a useful label so the SKILL prose can surface
    // why each was passed over.
    expect(outcomes[0]?.label).toMatch(/applyStrategy is property-mod/);
    expect(outcomes[2]?.label).toMatch(/applyStrategy is structural-mod/);
    // The naming + annotation actions actually fired.
    expect(namingScene.name).toBe("Hover");
    expect(
      (annotationScene.annotations as readonly AnnotationEntry[])[0]?.categoryId
    ).toBe(CATEGORIES.flag);
  });

  it("returns an empty array for empty input", async () => {
    mock = createFigmaGlobal({ nodes: {} });
    installFigmaGlobal(mock);
    expect(await applyAutoFixes([], { categories: CATEGORIES })).toEqual([]);
  });

  it("handles outcome shape consistently — every entry has nodeId/nodeName/ruleId/label", async () => {
    mock = createFigmaGlobal({ nodes: {} });
    installFigmaGlobal(mock);
    const issues: AutoFixIssueInput[] = [
      {
        nodeId: "x",
        ruleId: "irregular-spacing",
        applyStrategy: "property-mod",
        nodePath: "Page › Card",
      },
    ];
    const outcomes = await applyAutoFixes(issues, { categories: CATEGORIES });
    expect(outcomes[0]).toEqual({
      outcome: "⏭️",
      nodeId: "x",
      nodeName: "Card",
      ruleId: "irregular-spacing",
      label: expect.stringContaining("skipped"),
    });
  });
});
