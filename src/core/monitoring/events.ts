/**
 * Typed event definitions for PostHog analytics.
 * All events are prefixed with `cic_` (CanICode) to distinguish
 * from noise/spam in PostHog dashboards.
 *
 * Only event metadata is tracked — no design data, tokens, or file contents.
 */

/** Event name prefix — use this to filter genuine events in PostHog */
export const EVENT_PREFIX = "cic_";

export const EVENTS = {
  // Analysis
  ANALYSIS_STARTED: `${EVENT_PREFIX}analysis_started`,
  ANALYSIS_COMPLETED: `${EVENT_PREFIX}analysis_completed`,
  ANALYSIS_FAILED: `${EVENT_PREFIX}analysis_failed`,

  // Report
  REPORT_GENERATED: `${EVENT_PREFIX}report_generated`,
  COMMENT_POSTED: `${EVENT_PREFIX}comment_posted`,
  COMMENT_FAILED: `${EVENT_PREFIX}comment_failed`,

  // MCP
  MCP_TOOL_CALLED: `${EVENT_PREFIX}mcp_tool_called`,

  // CLI
  CLI_COMMAND: `${EVENT_PREFIX}cli_command`,
  CLI_INIT: `${EVENT_PREFIX}cli_init`,
  CLI_CONFIG_SET_TOKEN: `${EVENT_PREFIX}cli_config_set_token`,
  CLI_DOCTOR: `${EVENT_PREFIX}cli_doctor`,

  // Roundtrip (ADR-012)
  // Wiring point for the roundtrip helper's `telemetry` callback. No Node-side
  // orchestrator reads this yet — the helper ships in a sandbox-pure IIFE that
  // cannot import `core/monitoring` directly, so the event fires through a
  // caller-supplied callback. Define the typed name here so a future consumer
  // has a single place to wire it up.
  ROUNDTRIP_DEFINITION_WRITE_SKIPPED: `${EVENT_PREFIX}roundtrip_definition_write_skipped`,
  /** CLI `canicode roundtrip-tally` completed successfully. */
  ROUNDTRIP_TALLY: `${EVENT_PREFIX}roundtrip_tally`,
  /**
   * Phase 3 (#508 / ADR-023): `applyComponentize` outcome — either a
   * successful `createComponentFromNode` call or one of the guard rejections
   * (instance-child, free-form parent, error) that route to the Strategy C
   * annotate-fallback. Surfaces under `props.outcome` so a Node-side reader
   * can split the funnel.
   */
  ROUNDTRIP_COMPONENTIZE: `${EVENT_PREFIX}roundtrip_componentize`,
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];
