/**
 * Shared monitoring module that works across CLI, MCP, and browser environments.
 *
 * Key design principles:
 * - If no API keys are configured, all functions are silent no-ops
 * - All tracking is fire-and-forget (never blocks or throws)
 * - Zero external dependencies — uses native fetch (Node 18+ / browser)
 * - CLI users can opt out via `canicode config --no-telemetry`
 * - No design data, tokens, or file contents are ever sent
 */

export type { MonitoringConfig } from "./types.js";
export { EVENTS } from "./events.js";
export type { EventName } from "./events.js";

import type { MonitoringConfig } from "./types.js";
import { initCapture, captureEvent, captureError, shutdownCapture } from "./capture.js";

/**
 * Initialise monitoring for the current environment.
 * Safe to call multiple times — subsequent calls are ignored.
 */
export function initMonitoring(config: MonitoringConfig): void {
  initCapture(config);
}

/**
 * Track an analytics event. Fire-and-forget; never throws.
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  try {
    captureEvent(event, properties);
  } catch {
    // never throw from monitoring
  }
}

/**
 * Track an error. Fire-and-forget; never throws.
 */
export function trackError(error: Error, context?: Record<string, unknown>): void {
  try {
    captureError(error, context);
  } catch {
    // never throw from monitoring
  }
}

/**
 * Shut down monitoring. Call before process exit.
 */
export function shutdownMonitoring(): void {
  try {
    shutdownCapture();
  } catch {
    // never throw from monitoring
  }
}
