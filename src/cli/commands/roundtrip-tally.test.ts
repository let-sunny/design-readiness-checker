import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { computeRoundtripTallyFromSavedFiles } from "./roundtrip-tally.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "canicode-rt-tally-"));
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("computeRoundtripTallyFromSavedFiles", () => {
  it("matches computeRoundtripTally for analyze + step4 JSON", async () => {
    const analyzePath = join(tempRoot, "analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(
      analyzePath,
      JSON.stringify({
        version: "test",
        issueCount: 7,
        acknowledgedCount: 3,
      }),
      "utf-8",
    );
    writeFileSync(
      step4Path,
      JSON.stringify({
        resolved: 2,
        annotated: 1,
        definitionWritten: 1,
        skipped: 4,
      }),
      "utf-8",
    );

    const tally = await computeRoundtripTallyFromSavedFiles({
      analyzePath,
      step4Path,
    });

    expect(tally).toEqual({
      X: 2,
      Y: 1,
      Z: 1,
      W: 4,
      N: 8,
      V: 7,
      V_ack: 3,
      V_open: 4,
    });
  });

  it("throws when acknowledgedCount exceeds issueCount", async () => {
    const analyzePath = join(tempRoot, "analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(
      analyzePath,
      JSON.stringify({ issueCount: 2, acknowledgedCount: 5 }),
      "utf-8",
    );
    writeFileSync(
      step4Path,
      JSON.stringify({
        resolved: 0,
        annotated: 0,
        definitionWritten: 0,
        skipped: 0,
      }),
      "utf-8",
    );

    await expect(
      computeRoundtripTallyFromSavedFiles({ analyzePath, step4Path }),
    ).rejects.toThrow(/cannot exceed issueCount/);
  });

  it("rejects analyze JSON missing issueCount", async () => {
    const analyzePath = join(tempRoot, "analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(analyzePath, JSON.stringify({ acknowledgedCount: 0 }), "utf-8");
    writeFileSync(
      step4Path,
      JSON.stringify({
        resolved: 0,
        annotated: 0,
        definitionWritten: 0,
        skipped: 0,
      }),
      "utf-8",
    );

    await expect(
      computeRoundtripTallyFromSavedFiles({ analyzePath, step4Path }),
    ).rejects.toThrow(/--analyze must include issueCount/);
  });

  it("rejects malformed JSON in --analyze file", async () => {
    const analyzePath = join(tempRoot, "analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(analyzePath, "{ not json", "utf-8");
    writeFileSync(step4Path, "{}", "utf-8");

    await expect(
      computeRoundtripTallyFromSavedFiles({ analyzePath, step4Path }),
    ).rejects.toThrow(/--analyze/);
  });

  it("rejects malformed JSON in --step4 file", async () => {
    const analyzePath = join(tempRoot, "analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(
      analyzePath,
      JSON.stringify({ issueCount: 1, acknowledgedCount: 0 }),
      "utf-8",
    );
    writeFileSync(step4Path, "{ not json", "utf-8");

    await expect(
      computeRoundtripTallyFromSavedFiles({ analyzePath, step4Path }),
    ).rejects.toThrow(/--step4/);
  });

  it("surfaces readable errors when an input file is missing", async () => {
    const analyzePath = join(tempRoot, "missing-analyze.json");
    const step4Path = join(tempRoot, "step4.json");

    writeFileSync(
      step4Path,
      JSON.stringify({
        resolved: 0,
        annotated: 0,
        definitionWritten: 0,
        skipped: 0,
      }),
      "utf-8",
    );

    await expect(
      computeRoundtripTallyFromSavedFiles({ analyzePath, step4Path }),
    ).rejects.toThrow(/cannot read --analyze/);
  });
});
