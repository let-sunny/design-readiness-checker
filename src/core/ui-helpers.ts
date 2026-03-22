// Shared UI helper functions — single source of truth for report-html (Node) and app/shared (browser)
// All functions here must be pure (no Node.js or DOM dependencies)

import type { Severity } from "./contracts/severity.js";
import { GAUGE_R, GAUGE_C } from "./ui-constants.js";

/** Map a percentage score to a color hex string */
export function gaugeColor(pct: number): string {
  if (pct >= 75) return "#22c55e";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

/** Map a percentage score to a color class name (green/amber/red) */
export function scoreClass(pct: number): string {
  if (pct >= 75) return "green";
  if (pct >= 50) return "amber";
  return "red";
}

/** Escape HTML special characters — works in both Node.js and browser */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Severity to CSS dot class (for plugin UI) */
export function severityDotClass(sev: string): string {
  const map: Record<string, string> = {
    blocking: "dot-blocking",
    risk: "dot-risk",
    "missing-info": "dot-missing",
    suggestion: "dot-suggestion",
  };
  return map[sev] ?? "dot-missing";
}

/** Severity to CSS score class (for plugin UI) */
export function severityScoreClass(sev: string): string {
  const map: Record<string, string> = {
    blocking: "score-blocking",
    risk: "score-risk",
    "missing-info": "score-missing",
    suggestion: "score-suggestion",
  };
  return map[sev] ?? "score-missing";
}

/** Severity to Tailwind dot class (for report-html / web app) */
export function severityDot(sev: Severity): string {
  const map: Record<Severity, string> = {
    blocking: "bg-red-500",
    risk: "bg-amber-500",
    "missing-info": "bg-zinc-400",
    suggestion: "bg-green-500",
  };
  return map[sev];
}

/** Severity to Tailwind badge class (for report-html / web app) */
export function severityBadge(sev: Severity): string {
  const map: Record<Severity, string> = {
    blocking: "bg-red-500/10 text-red-600 border-red-500/20",
    risk: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    "missing-info": "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
    suggestion: "bg-green-500/10 text-green-600 border-green-500/20",
  };
  return map[sev];
}

/** Score percentage to Tailwind badge style (for report-html / web app) */
export function scoreBadgeStyle(pct: number): string {
  if (pct >= 75) return "bg-green-500/10 text-green-700 border-green-500/20";
  if (pct >= 50) return "bg-amber-500/10 text-amber-700 border-amber-500/20";
  return "bg-red-500/10 text-red-700 border-red-500/20";
}

/** Render a circular gauge SVG string — works in both Node.js and browser */
export function renderGaugeSvg(
  pct: number,
  size: number,
  strokeW: number,
  grade?: string
): string {
  const offset = GAUGE_C * (1 - pct / 100);
  const color = gaugeColor(pct);
  if (grade) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" class="gauge-svg block">
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="${strokeW}" stroke="#e4e4e7" class="stroke-border" />
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${GAUGE_C}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)" class="gauge-fill" />
            <text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="48" font-weight="700" font-family="Inter,-apple-system,sans-serif" class="font-sans">${escapeHtml(grade)}</text>
          </svg>`;
  }
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" class="gauge-svg block">
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="${strokeW}" stroke="#e4e4e7" class="stroke-border" />
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${GAUGE_C}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)" class="gauge-fill" />
            <text x="60" y="62" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="28" font-weight="700" font-family="Inter,-apple-system,sans-serif" class="font-sans">${pct}</text>
          </svg>`;
}
