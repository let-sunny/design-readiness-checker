/**
 * Unified fetch-based monitoring capture for all environments (CLI, MCP, browser, plugin).
 *
 * No external dependencies — uses native `fetch` (Node 18+ / browser).
 * All operations are fire-and-forget; never throws.
 */

import type { MonitoringConfig } from "./types.js";

let monitoringEnabled = false;
let posthogApiKey: string | undefined;
let sentryDsn: string | undefined;
let distinctId = "anonymous";
let environment = "unknown";
let version = "unknown";
let commonProps: Record<string, unknown> = {};

/** Generate a simple UUID v4 (no crypto dependency needed for monitoring) */
function uuid4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Parse Sentry DSN into components */
function parseSentryDsn(dsn: string): { key: string; host: string; projectId: string } | null {
  try {
    // DSN format: https://{key}@{host}/{projectId}
    const url = new URL(dsn);
    const key = url.username;
    const projectId = url.pathname.slice(1); // remove leading /
    const host = url.protocol + "//" + url.host;
    if (!key || !projectId) return null;
    return { key, host, projectId };
  } catch {
    return null;
  }
}

export function initCapture(config: MonitoringConfig): void {
  if (config.enabled === false) return;
  if (!config.posthogApiKey && !config.sentryDsn) return;

  monitoringEnabled = true;
  posthogApiKey = config.posthogApiKey;
  sentryDsn = config.sentryDsn;
  distinctId = config.distinctId ?? "anonymous";
  environment = config.environment ?? "unknown";
  version = config.version ?? "unknown";
  commonProps = {
    _sdk: "canicode",
    _sdk_version: version,
    _env: environment,
  };
}

export function captureEvent(event: string, properties?: Record<string, unknown>): void {
  if (!monitoringEnabled || !posthogApiKey) return;

  try {
    fetch("https://us.i.posthog.com/i/v0/e/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: posthogApiKey,
        event,
        distinct_id: distinctId,
        properties: { ...commonProps, ...properties },
        timestamp: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch {
    // never throw from monitoring
  }
}

export function captureError(error: Error, context?: Record<string, unknown>): void {
  if (!monitoringEnabled) return;

  // Send to Sentry via envelope API
  if (sentryDsn) {
    const parsed = parseSentryDsn(sentryDsn);
    if (parsed) {
      try {
        const eventId = uuid4();
        const envelope = [
          JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: sentryDsn }),
          JSON.stringify({ type: "event", content_type: "application/json" }),
          JSON.stringify({
            event_id: eventId,
            exception: { values: [{ type: error.name, value: error.message }] },
            platform: "node",
            environment,
            release: `canicode@${version}`,
            timestamp: Date.now() / 1000,
            extra: context,
          }),
        ].join("\n");

        fetch(`${parsed.host}/api/${parsed.projectId}/envelope/`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-sentry-envelope",
            "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${parsed.key}`,
          },
          body: envelope,
        }).catch(() => {});
      } catch {
        // never throw from monitoring
      }
    }
  }

  // Also send to PostHog as error event
  captureEvent("cic_error", { error: error.message, ...context });
}

export function shutdownCapture(): void {
  monitoringEnabled = false;
  posthogApiKey = undefined;
  sentryDsn = undefined;
  distinctId = "anonymous";
  environment = "unknown";
  version = "unknown";
  commonProps = {};
}
