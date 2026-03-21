import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const AIREADY_DIR = join(homedir(), ".canicode");
const CONFIG_PATH = join(AIREADY_DIR, "config.json");
const REPORTS_DIR = join(AIREADY_DIR, "reports");

interface AireadyConfig {
  figmaToken?: string;
  telemetry?: boolean;
  posthogApiKey?: string;
  sentryDsn?: string;
  deviceId?: string;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function readConfig(): AireadyConfig {
  if (!existsSync(CONFIG_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as AireadyConfig;
  } catch {
    return {};
  }
}

export function writeConfig(config: AireadyConfig): void {
  ensureDir(AIREADY_DIR);
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

export function getFigmaToken(): string | undefined {
  // Priority: env var > config file
  return process.env["FIGMA_TOKEN"] ?? readConfig().figmaToken;
}

export function setFigmaToken(token: string): void {
  const config = readConfig();
  config.figmaToken = token;
  writeConfig(config);
}

export function hasConfig(): boolean {
  return existsSync(CONFIG_PATH);
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

export function getReportsDir(): string {
  return REPORTS_DIR;
}

export function ensureReportsDir(): void {
  ensureDir(REPORTS_DIR);
}

export function getTelemetryEnabled(): boolean {
  return readConfig().telemetry !== false;
}

export function setTelemetryEnabled(enabled: boolean): void {
  const config = readConfig();
  config.telemetry = enabled;
  writeConfig(config);
}

export function getPosthogApiKey(): string | undefined {
  return process.env["POSTHOG_API_KEY"] ?? readConfig().posthogApiKey;
}

export function getSentryDsn(): string | undefined {
  return process.env["SENTRY_DSN"] ?? readConfig().sentryDsn;
}

/**
 * Get or create a stable anonymous device ID for telemetry.
 * Stored in ~/.canicode/config.json, persists across sessions.
 */
export function getDeviceId(): string {
  const config = readConfig();
  if (config.deviceId) return config.deviceId;

  const id = randomUUID();
  config.deviceId = id;
  writeConfig(config);
  return id;
}

/**
 * Initialize canicode: write config + create reports dir
 */
export function initAiready(token: string): void {
  setFigmaToken(token);
  ensureReportsDir();
}
