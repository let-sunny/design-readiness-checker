import { existsSync, mkdirSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

export interface ActivityStep {
  step: string;
  nodePath?: string;
  result: string;
  durationMs: number;
}

function getTimestamp(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function getDateTimeString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}-${hours}-${minutes}`;
}

/**
 * Extract a short fixture name from a file path.
 * e.g. "fixtures/http-design.json" → "http-design"
 */
function extractFixtureName(fixturePath: string): string {
  const fileName = fixturePath.split("/").pop() ?? fixturePath;
  return fileName.replace(/\.json$/, "");
}

export class ActivityLogger {
  private logPath: string;
  private initialized = false;

  constructor(fixturePath?: string, logDir = "logs/activity") {
    const dateTimeStr = getDateTimeString();
    const fixtureName = fixturePath ? extractFixtureName(fixturePath) : "unknown";
    this.logPath = resolve(logDir, `${dateTimeStr}-${fixtureName}.md`);
  }

  /**
   * Ensure the log directory and file header exist
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    const dir = dirname(this.logPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    if (!existsSync(this.logPath)) {
      const ts = getDateTimeString();
      await writeFile(this.logPath, `# Calibration Activity Log — ${ts}\n\n`, "utf-8");
    }

    this.initialized = true;
  }

  /**
   * Log a pipeline step
   */
  async logStep(activity: ActivityStep): Promise<void> {
    await this.ensureInitialized();

    const lines: string[] = [];
    lines.push(`## ${getTimestamp()} — ${activity.step}`);
    if (activity.nodePath) {
      lines.push(`- Node: ${activity.nodePath}`);
    }
    lines.push(`- Result: ${activity.result}`);
    lines.push(`- Duration: ${activity.durationMs}ms`);
    lines.push("");

    await appendFile(this.logPath, lines.join("\n") + "\n", "utf-8");
  }

  /**
   * Log a summary at pipeline completion
   */
  async logSummary(summary: {
    totalDurationMs: number;
    nodesAnalyzed: number;
    nodesConverted: number;
    mismatches: number;
    adjustments: number;
    status: string;
  }): Promise<void> {
    await this.ensureInitialized();

    const lines: string[] = [];
    lines.push(`## ${getTimestamp()} — Pipeline Summary`);
    lines.push(`- Status: ${summary.status}`);
    lines.push(`- Total Duration: ${summary.totalDurationMs}ms`);
    lines.push(`- Nodes Analyzed: ${summary.nodesAnalyzed}`);
    lines.push(`- Nodes Converted: ${summary.nodesConverted}`);
    lines.push(`- Mismatches Found: ${summary.mismatches}`);
    lines.push(`- Adjustments Proposed: ${summary.adjustments}`);
    lines.push("");
    lines.push("---");
    lines.push("");

    await appendFile(this.logPath, lines.join("\n") + "\n", "utf-8");
  }

  getLogPath(): string {
    return this.logPath;
  }
}
