/**
 * Browser monitoring implementation for the web app (docs/index.html).
 *
 * Loads PostHog and Sentry via CDN script tags. Exports the same
 * interface as node.ts but targeting the browser environment.
 *
 * Note: This module is only dynamically imported when running in a browser
 * (detected via globalThis checks), so it is never loaded in Node.js.
 */

import type { MonitoringConfig } from "./types.js";

let monitoringEnabled = false;

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyGlobal = Record<string, any>;

function getGlobal(): AnyGlobal {
  return globalThis as AnyGlobal;
}

function injectScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const g = getGlobal();
    const doc = g["document"] as AnyGlobal | undefined;
    if (!doc) {
      resolve();
      return;
    }
    const script = doc["createElement"]("script") as AnyGlobal;
    script["src"] = src;
    script["async"] = true;
    script["onload"] = () => resolve();
    script["onerror"] = () => reject(new Error(`Failed to load script: ${src}`));
    (doc["head"] as AnyGlobal)["appendChild"](script);
  });
}

export async function initBrowserMonitoring(config: MonitoringConfig): Promise<void> {
  if (config.enabled === false) return;

  const g = getGlobal();
  if (!g["document"]) return;

  monitoringEnabled = true;

  // --- PostHog ---
  if (config.posthogApiKey) {
    try {
      await injectScript("https://us-assets.i.posthog.com/static/array.js");
      (g["posthog"] as AnyGlobal)?.["init"]?.(config.posthogApiKey, {
        api_host: "https://us.i.posthog.com",
        autocapture: false,
        capture_pageview: true,
      });
    } catch {
      // CDN unavailable — degrade silently
    }
  }

  // --- Sentry ---
  if (config.sentryDsn) {
    try {
      await injectScript("https://browser.sentry-cdn.com/8.0.0/bundle.min.js");
      (g["Sentry"] as AnyGlobal)?.["init"]?.({
        dsn: config.sentryDsn,
        environment: config.environment ?? "web",
        release: config.version,
        tracesSampleRate: 0,
      });
    } catch {
      // CDN unavailable — degrade silently
    }
  }
}

export function trackBrowserEvent(event: string, properties?: Record<string, unknown>): void {
  if (!monitoringEnabled) return;
  try {
    (getGlobal()["posthog"] as AnyGlobal)?.["capture"]?.(event, properties);
  } catch {
    // never throw from monitoring
  }
}

export function trackBrowserError(error: Error, context?: Record<string, unknown>): void {
  if (!monitoringEnabled) return;

  try {
    (getGlobal()["Sentry"] as AnyGlobal)?.["captureException"]?.(
      error,
      context ? { extra: context } : undefined,
    );
  } catch {
    // never throw from monitoring
  }

  try {
    (getGlobal()["posthog"] as AnyGlobal)?.["capture"]?.("error", {
      error: error.message,
      ...context,
    });
  } catch {
    // never throw from monitoring
  }
}

export async function shutdownBrowserMonitoring(): Promise<void> {
  monitoringEnabled = false;
  // Browser SDKs handle their own flush on page unload
}
