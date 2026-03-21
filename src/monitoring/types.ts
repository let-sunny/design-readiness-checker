/**
 * Shared monitoring types used by both Node.js and browser implementations.
 */

export interface MonitoringConfig {
  posthogApiKey?: string;
  sentryDsn?: string;
  /** 'cli' | 'mcp' | 'web' */
  environment?: string;
  version?: string;
  /** default: true — set false to opt out of telemetry */
  enabled?: boolean;
}
