/**
 * Shared monitoring module that works across CLI, MCP, and browser environments.
 *
 * Key design principles:
 * - If no API keys are configured, all functions are silent no-ops
 * - All tracking is fire-and-forget (never blocks or throws)
 * - posthog-node and @sentry/node are optional peer dependencies
 * - CLI users can opt out via `canicode config --no-telemetry`
 * - No design data, tokens, or file contents are ever sent
 */

export type { MonitoringConfig } from "./types.js";
export { EVENTS } from "./events.js";
export type { EventName } from "./events.js";

import type { MonitoringConfig } from "./types.js";

// Active implementation delegates
let _trackEvent: (event: string, properties?: Record<string, unknown>) => void = () => {};
let _trackError: (error: Error, context?: Record<string, unknown>) => void = () => {};
let _shutdown: () => Promise<void> = () => Promise.resolve();

/**
 * Detect whether we are running in a browser environment.
 */
function isBrowser(): boolean {
  const g = globalThis as Record<string, unknown>;
  return typeof g["window"] !== "undefined" && typeof g["document"] !== "undefined";
}

/**
 * Initialise monitoring for the current environment.
 * Safe to call multiple times — subsequent calls are ignored.
 */
export async function initMonitoring(config: MonitoringConfig): Promise<void> {
  if (config.enabled === false) return;

  // No keys configured → stay as no-ops
  if (!config.posthogApiKey && !config.sentryDsn) return;

  try {
    if (isBrowser()) {
      const { initBrowserMonitoring, trackBrowserEvent, trackBrowserError, shutdownBrowserMonitoring } =
        await import("./browser.js");
      await initBrowserMonitoring(config);
      _trackEvent = trackBrowserEvent;
      _trackError = trackBrowserError;
      _shutdown = shutdownBrowserMonitoring;
    } else {
      const { initNodeMonitoring, trackNodeEvent, trackNodeError, shutdownNodeMonitoring } =
        await import("./node.js");
      await initNodeMonitoring(config);
      _trackEvent = trackNodeEvent;
      _trackError = trackNodeError;
      _shutdown = shutdownNodeMonitoring;
    }
  } catch {
    // Monitoring initialisation failed — remain as no-ops
  }
}

/**
 * Track an analytics event. Fire-and-forget; never throws.
 */
export function trackEvent(event: string, properties?: Record<string, unknown>): void {
  try {
    _trackEvent(event, properties);
  } catch {
    // never throw from monitoring
  }
}

/**
 * Track an error. Fire-and-forget; never throws.
 */
export function trackError(error: Error, context?: Record<string, unknown>): void {
  try {
    _trackError(error, context);
  } catch {
    // never throw from monitoring
  }
}

/**
 * Flush pending events and shut down monitoring. Call before process exit.
 */
export async function shutdownMonitoring(): Promise<void> {
  try {
    await _shutdown();
  } catch {
    // never throw from monitoring
  }
}
