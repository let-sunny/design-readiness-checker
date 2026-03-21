/**
 * Node.js monitoring implementation for CLI and MCP environments.
 *
 * Uses dynamic imports so missing posthog-node / @sentry/node packages
 * never crash the application. All operations are fire-and-forget.
 */

import type { MonitoringConfig } from "./types.js";

// Module-level state (lazy-initialised)
let posthogClient: PostHogLike | null = null;
let sentryModule: SentryLike | null = null;
let monitoringEnabled = false;
let commonProps: Record<string, unknown> = {};

// Minimal interfaces so we avoid importing the real types at compile time
interface PostHogLike {
  capture(opts: { distinctId: string; event: string; properties?: Record<string, unknown> }): void;
  shutdown(): Promise<void>;
}

interface SentryLike {
  init(opts: Record<string, unknown>): void;
  captureException(err: unknown, ctx?: Record<string, unknown>): void;
  close(timeout?: number): Promise<boolean>;
}

export async function initNodeMonitoring(config: MonitoringConfig): Promise<void> {
  if (config.enabled === false) return;

  monitoringEnabled = true;
  commonProps = {
    _sdk: "canicode",
    _sdk_version: config.version ?? "unknown",
    _env: config.environment ?? "unknown",
  };

  // --- PostHog ---
  if (config.posthogApiKey) {
    try {
      // Dynamic import — package is an optional peer dependency
      // @ts-expect-error posthog-node is not listed as a dependency
      const mod = await import("posthog-node");
      const PostHog = mod.PostHog as new (key: string, opts?: Record<string, unknown>) => PostHogLike;
      posthogClient = new PostHog(config.posthogApiKey, {
        host: "https://us.i.posthog.com",
        flushAt: 10,
        flushInterval: 10_000,
      });
    } catch {
      // posthog-node not installed — degrade silently
    }
  }

  // --- Sentry ---
  if (config.sentryDsn) {
    try {
      // Dynamic import — package is an optional peer dependency
      // @ts-expect-error @sentry/node is not listed as a dependency
      const mod = await import("@sentry/node");
      sentryModule = mod as unknown as SentryLike;
      sentryModule.init({
        dsn: config.sentryDsn,
        environment: config.environment ?? "cli",
        release: config.version,
        tracesSampleRate: 0,
      });
    } catch {
      // @sentry/node not installed — degrade silently
    }
  }
}

export function trackNodeEvent(event: string, properties?: Record<string, unknown>): void {
  if (!monitoringEnabled || !posthogClient) return;
  try {
    const captureOpts: { distinctId: string; event: string; properties?: Record<string, unknown> } = {
      distinctId: "anonymous",
      event,
    };
    captureOpts.properties = { ...commonProps, ...properties };
    posthogClient.capture(captureOpts);
  } catch {
    // never throw from monitoring
  }
}

export function trackNodeError(error: Error, context?: Record<string, unknown>): void {
  if (!monitoringEnabled) return;

  try {
    sentryModule?.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // never throw from monitoring
  }

  try {
    posthogClient?.capture({
      distinctId: "anonymous",
      event: "cic_error",
      properties: { ...commonProps, error: error.message, ...context },
    });
  } catch {
    // never throw from monitoring
  }
}

export async function shutdownNodeMonitoring(): Promise<void> {
  if (!monitoringEnabled) return;

  const tasks: Promise<unknown>[] = [];

  if (posthogClient) {
    tasks.push(
      posthogClient.shutdown().catch(() => {
        // ignore
      }),
    );
  }

  if (sentryModule) {
    tasks.push(
      sentryModule.close(2000).catch(() => {
        // ignore
      }),
    );
  }

  await Promise.allSettled(tasks);

  posthogClient = null;
  sentryModule = null;
  monitoringEnabled = false;
}
