import { initMonitoring, trackEvent, trackError, shutdownMonitoring, EVENTS } from "./index.js";

describe("monitoring module", () => {
  afterEach(async () => {
    await shutdownMonitoring();
  });

  describe("initMonitoring", () => {
    it("does not throw when enabled is false", async () => {
      await expect(
        initMonitoring({ enabled: false }),
      ).resolves.toBeUndefined();
    });

    it("does not throw when no keys are configured", async () => {
      await expect(
        initMonitoring({ environment: "cli" }),
      ).resolves.toBeUndefined();
    });

    it("does not throw with invalid PostHog key (package not installed)", async () => {
      await expect(
        initMonitoring({ posthogApiKey: "phc_test_invalid", environment: "cli" }),
      ).resolves.toBeUndefined();
    });

    it("does not throw with invalid Sentry DSN (package not installed)", async () => {
      await expect(
        initMonitoring({ sentryDsn: "https://invalid@sentry.io/123", environment: "cli" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("trackEvent", () => {
    it("does not throw when monitoring is not initialised", () => {
      expect(() => trackEvent("test_event")).not.toThrow();
    });

    it("does not throw with properties", () => {
      expect(() =>
        trackEvent("test_event", { key: "value", count: 42 }),
      ).not.toThrow();
    });
  });

  describe("trackError", () => {
    it("does not throw when monitoring is not initialised", () => {
      expect(() => trackError(new Error("test error"))).not.toThrow();
    });

    it("does not throw with context", () => {
      expect(() =>
        trackError(new Error("test error"), { command: "analyze" }),
      ).not.toThrow();
    });
  });

  describe("shutdownMonitoring", () => {
    it("does not throw when monitoring is not initialised", async () => {
      await expect(shutdownMonitoring()).resolves.toBeUndefined();
    });

    it("can be called multiple times safely", async () => {
      await shutdownMonitoring();
      await expect(shutdownMonitoring()).resolves.toBeUndefined();
    });
  });

  describe("EVENTS", () => {
    it("exports expected event names", () => {
      expect(EVENTS.ANALYSIS_STARTED).toBe("cic_analysis_started");
      expect(EVENTS.ANALYSIS_COMPLETED).toBe("cic_analysis_completed");
      expect(EVENTS.ANALYSIS_FAILED).toBe("cic_analysis_failed");
      expect(EVENTS.REPORT_GENERATED).toBe("cic_report_generated");
      expect(EVENTS.COMMENT_POSTED).toBe("cic_comment_posted");
      expect(EVENTS.COMMENT_FAILED).toBe("cic_comment_failed");
      expect(EVENTS.MCP_TOOL_CALLED).toBe("cic_mcp_tool_called");
      expect(EVENTS.CLI_COMMAND).toBe("cic_cli_command");
      expect(EVENTS.CLI_INIT).toBe("cic_cli_init");
    });
  });

  describe("graceful degradation", () => {
    it("all functions work when initialised with disabled=false but no packages installed", async () => {
      await initMonitoring({
        posthogApiKey: "phc_test",
        sentryDsn: "https://test@sentry.io/123",
        environment: "cli",
        version: "0.0.0-test",
      });

      // These should all be no-ops since posthog-node and @sentry/node are not installed
      expect(() => trackEvent(EVENTS.ANALYSIS_STARTED)).not.toThrow();
      expect(() => trackError(new Error("test"))).not.toThrow();
      await expect(shutdownMonitoring()).resolves.toBeUndefined();
    });
  });
});
