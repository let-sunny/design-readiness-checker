import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rm } from "node:fs/promises";
import { ActivityLogger } from "./activity-logger.js";

describe("ActivityLogger", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "activity-logger-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("logStep creates directory and file if they don't exist, file contains step data", async () => {
    const logDir = join(tempDir, "nested", "logs");
    const logger = new ActivityLogger("fixtures/http-design.json", logDir);

    await logger.logStep({
      step: "Analyze Node",
      nodePath: "Frame > Button",
      result: "success",
      durationMs: 150,
    });

    const logPath = logger.getLogPath();
    expect(existsSync(logPath)).toBe(true);

    const content = readFileSync(logPath, "utf-8");
    expect(content).toContain("# Calibration Activity Log");
    expect(content).toContain("Analyze Node");
    expect(content).toContain("- Node: Frame > Button");
    expect(content).toContain("- Result: success");
    expect(content).toContain("- Duration: 150ms");
  });

  it("logStep with nodePath includes node line in output", async () => {
    const logger = new ActivityLogger("fixtures/sample.json", tempDir);

    await logger.logStep({
      step: "Convert Component",
      nodePath: "Page > Header > Logo",
      result: "converted",
      durationMs: 200,
    });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    expect(content).toContain("- Node: Page > Header > Logo");
  });

  it("logStep without nodePath omits node line", async () => {
    const logger = new ActivityLogger("fixtures/sample.json", tempDir);

    await logger.logStep({
      step: "Initialize Pipeline",
      result: "ready",
      durationMs: 10,
    });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    expect(content).not.toContain("- Node:");
    expect(content).toContain("- Result: ready");
    expect(content).toContain("- Duration: 10ms");
  });

  it("logSummary writes summary section with all fields and trailing ---", async () => {
    const logger = new ActivityLogger("fixtures/sample.json", tempDir);

    await logger.logSummary({
      totalDurationMs: 5000,
      nodesAnalyzed: 42,
      nodesConverted: 38,
      mismatches: 4,
      adjustments: 3,
      status: "completed",
    });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    expect(content).toContain("Pipeline Summary");
    expect(content).toContain("- Status: completed");
    expect(content).toContain("- Total Duration: 5000ms");
    expect(content).toContain("- Nodes Analyzed: 42");
    expect(content).toContain("- Nodes Converted: 38");
    expect(content).toContain("- Mismatches Found: 4");
    expect(content).toContain("- Adjustments Proposed: 3");
    expect(content).toContain("---");
  });

  it("multiple logStep calls append to the same file (not overwrite)", async () => {
    const logger = new ActivityLogger("fixtures/sample.json", tempDir);

    await logger.logStep({
      step: "First Step",
      result: "ok",
      durationMs: 100,
    });

    await logger.logStep({
      step: "Second Step",
      result: "done",
      durationMs: 200,
    });

    const content = readFileSync(logger.getLogPath(), "utf-8");
    expect(content).toContain("First Step");
    expect(content).toContain("Second Step");
    expect(content).toContain("- Result: ok");
    expect(content).toContain("- Result: done");
  });

  it("getLogPath contains fixture name and datetime", () => {
    const logger = new ActivityLogger("fixtures/http-design.json", tempDir);
    const logPath = logger.getLogPath();

    expect(logPath).toContain("http-design");

    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const todayStr = `${year}-${month}-${day}`;

    expect(logPath).toContain(todayStr);
  });

  it("defaults fixture name to unknown when not provided", () => {
    const logger = new ActivityLogger(undefined, tempDir);
    expect(logger.getLogPath()).toContain("unknown");
  });
});
