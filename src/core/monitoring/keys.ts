/**
 * Monitoring keys injected at build time via tsup `define`.
 * These are replaced with actual values during CI builds.
 * Locally they default to empty strings (monitoring disabled).
 */

declare const __POSTHOG_API_KEY__: string;
declare const __SENTRY_DSN__: string;

export const POSTHOG_API_KEY: string =
  typeof __POSTHOG_API_KEY__ !== "undefined" ? __POSTHOG_API_KEY__ : "";
export const SENTRY_DSN: string =
  typeof __SENTRY_DSN__ !== "undefined" ? __SENTRY_DSN__ : "";
