import {
  ImplementAttemptSchema,
  ImplementLogSchema,
  createDevRunIndex,
  findDevResumePoint,
} from "./develop-run.js";

describe("ImplementAttemptSchema", () => {
  const baseAttempt = {
    attempt: 1,
    startedAt: "2026-04-18T00:00:00Z",
    endedAt: "2026-04-18T00:05:00Z",
    status: "success" as const,
    filesWritten: ["scripts/develop.ts"],
  };

  it("accepts a valid success attempt", () => {
    expect(() => ImplementAttemptSchema.parse(baseAttempt)).not.toThrow();
  });

  it("accepts timeout with failureReason and lastTaskId", () => {
    const parsed = ImplementAttemptSchema.parse({
      ...baseAttempt,
      status: "timeout",
      failureReason: "timeout after 600s",
      lastTaskId: 3,
      err: "stderr tail",
    });
    expect(parsed.status).toBe("timeout");
    expect(parsed.lastTaskId).toBe(3);
  });

  it("rejects when startedAt is missing", () => {
    const { startedAt: _startedAt, ...rest } = baseAttempt;
    expect(() => ImplementAttemptSchema.parse(rest)).toThrow();
  });

  it("preserves unknown keys via passthrough", () => {
    const parsed = ImplementAttemptSchema.parse({
      ...baseAttempt,
      custom: "extra",
    }) as typeof baseAttempt & { custom?: string };
    expect(parsed.custom).toBe("extra");
  });
});

describe("ImplementLogSchema", () => {
  const baseLog = {
    filesChanged: ["scripts/develop.ts"],
    commits: ["feat: add X"],
    decisions: ["Chose A over B"],
    knownRisks: [],
  };

  it("accepts a minimal success log", () => {
    expect(() => ImplementLogSchema.parse(baseLog)).not.toThrow();
  });

  it("accepts a timeout log with completedTasks and timedOutAt", () => {
    const parsed = ImplementLogSchema.parse({
      ...baseLog,
      status: "timeout",
      completedTasks: [1, 2],
      timedOutAt: "2026-04-18T00:10:00Z",
    });
    expect(parsed.status).toBe("timeout");
    expect(parsed.completedTasks).toEqual([1, 2]);
  });

  it("rejects when filesChanged is missing", () => {
    const { filesChanged: _filesChanged, ...rest } = baseLog;
    expect(() => ImplementLogSchema.parse(rest)).toThrow();
  });
});

describe("findDevResumePoint", () => {
  it("returns the first non-terminal step", () => {
    const index = createDevRunIndex(42, "test", "develop/42", "/tmp/42");
    index.steps[0]!.status = "completed";
    index.steps[1]!.status = "running";
    expect(findDevResumePoint(index)).toBe("implement");
  });

  it("returns null when all steps are completed or skipped", () => {
    const index = createDevRunIndex(42, "test", "develop/42", "/tmp/42");
    for (const step of index.steps) step.status = "completed";
    expect(findDevResumePoint(index)).toBeNull();
  });

  it("skips completed + skipped to find the first pending", () => {
    const index = createDevRunIndex(42, "test", "develop/42", "/tmp/42");
    index.steps[0]!.status = "completed";
    index.steps[1]!.status = "completed";
    index.steps[2]!.status = "skipped";
    index.steps[3]!.status = "pending";
    expect(findDevResumePoint(index)).toBe("review");
  });
});
