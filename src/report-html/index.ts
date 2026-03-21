// Report HTML module - shadcn/ui styled HTML report generation

import type { AnalysisFile } from "../contracts/figma-node.js";
import type { Category } from "../contracts/category.js";
import type { Severity } from "../contracts/severity.js";
import { CATEGORIES, CATEGORY_LABELS } from "../contracts/category.js";
import { SEVERITY_LABELS } from "../contracts/severity.js";
import type { AnalysisResult, AnalysisIssue } from "../core/rule-engine.js";
import type { ScoreReport, Grade } from "../core/scoring.js";
import { buildFigmaDeepLink } from "../adapters/figma-url-parser.js";

export interface NodeScreenshot {
  nodeId: string;
  nodePath: string;
  screenshotBase64: string;
  issueCount: number;
  topSeverity: string;
}

export interface HtmlReportOptions {
  nodeScreenshots?: NodeScreenshot[];
}

// Gauge geometry
const GAUGE_R = 54;
const GAUGE_C = Math.round(2 * Math.PI * GAUGE_R); // ~339

const CATEGORY_DESCRIPTIONS: Record<Category, string> = {
  layout: "Auto Layout, responsive constraints, nesting depth, absolute positioning",
  token: "Design token binding for colors, fonts, shadows, spacing grid",
  component: "Component reuse, detached instances, variant coverage",
  naming: "Semantic layer names, naming conventions, default names",
  "ai-readability": "Structure clarity for AI code generation, z-index, empty frames",
  "handoff-risk": "Hardcoded values, text truncation, image placeholders, dev status",
};

const SEVERITY_ORDER: Severity[] = ["blocking", "risk", "missing-info", "suggestion"];

function gaugeColor(pct: number): string {
  if (pct >= 75) return "#22c55e";
  if (pct >= 50) return "#f59e0b";
  return "#ef4444";
}

function severityBadge(sev: Severity): string {
  const map: Record<Severity, string> = {
    blocking: "bg-red-500/10 text-red-600 border-red-500/20",
    risk: "bg-amber-500/10 text-amber-600 border-amber-500/20",
    "missing-info": "bg-zinc-500/10 text-zinc-600 border-zinc-500/20",
    suggestion: "bg-green-500/10 text-green-600 border-green-500/20",
  };
  return map[sev];
}

function scoreBadgeStyle(pct: number): string {
  if (pct >= 75) return "bg-green-500/10 text-green-700 border-green-500/20";
  if (pct >= 50) return "bg-amber-500/10 text-amber-700 border-amber-500/20";
  return "bg-red-500/10 text-red-700 border-red-500/20";
}

function severityDot(sev: Severity): string {
  const map: Record<Severity, string> = {
    blocking: "bg-red-500",
    risk: "bg-amber-500",
    "missing-info": "bg-zinc-400",
    suggestion: "bg-green-500",
  };
  return map[sev];
}

// ---- Main ----

export function generateHtmlReport(
  file: AnalysisFile,
  result: AnalysisResult,
  scores: ScoreReport,
  options?: HtmlReportOptions
): string {
  const screenshotMap = new Map(
    (options?.nodeScreenshots ?? []).map((ns) => [ns.nodeId, ns])
  );
  const quickWins = getQuickWins(result.issues, 5);
  const issuesByCategory = groupIssuesByCategory(result.issues);

  return `<!DOCTYPE html>
<html lang="en" class="antialiased">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AIReady Report — ${esc(file.name)}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
    tailwind.config = {
      theme: {
        extend: {
          fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'] },
          colors: {
            border: 'hsl(240 5.9% 90%)',
            ring: 'hsl(240 5.9% 10%)',
            background: 'hsl(0 0% 100%)',
            foreground: 'hsl(240 10% 3.9%)',
            muted: { DEFAULT: 'hsl(240 4.8% 95.9%)', foreground: 'hsl(240 3.8% 46.1%)' },
            card: { DEFAULT: 'hsl(0 0% 100%)', foreground: 'hsl(240 10% 3.9%)' },
          },
          borderRadius: { lg: '0.5rem', md: 'calc(0.5rem - 2px)', sm: 'calc(0.5rem - 4px)' },
        }
      }
    }
  </script>
  <style>
    details summary::-webkit-details-marker { display: none; }
    details summary::marker { content: ""; }
    details summary { list-style: none; }
    .gauge-fill { transition: stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1); }
    @media print {
      .no-print { display: none !important; }
      .topbar-print { position: static !important; background: white !important; color: hsl(240 10% 3.9%) !important; }
    }
  </style>
</head>
<body class="bg-muted font-sans text-foreground min-h-screen">

  <!-- Top Bar -->
  <header class="topbar-print sticky top-0 z-50 bg-zinc-950 text-white border-b border-zinc-800">
    <div class="max-w-[960px] mx-auto px-6 py-3 flex items-center gap-4">
      <span class="font-semibold text-sm tracking-tight">AIReady</span>
      <span class="text-zinc-400 text-sm truncate">${esc(file.name)}</span>
      <span class="ml-auto text-zinc-500 text-xs no-print">${new Date().toLocaleDateString()}</span>
    </div>
  </header>

  <main class="max-w-[960px] mx-auto px-6 pb-16">

    <!-- Overall Score -->
    <section class="flex flex-col items-center pt-12 pb-6">
      ${renderGaugeSvg(scores.overall.percentage, 200, 10, scores.overall.grade)}
      <div class="mt-3 text-center">
        <span class="text-lg font-semibold">${scores.overall.percentage}</span>
        <span class="text-muted-foreground text-sm ml-1">/ 100</span>
      </div>
      <p class="text-muted-foreground text-sm mt-1">Overall Score</p>
    </section>

    <!-- Category Gauges -->
    <section class="bg-card border border-border rounded-lg shadow-sm p-6 mb-6">
      <div class="grid grid-cols-3 sm:grid-cols-6 gap-4">
${CATEGORIES.map(cat => {
    const cs = scores.byCategory[cat];
    const desc = CATEGORY_DESCRIPTIONS[cat];
    return `        <div class="flex flex-col items-center group relative">
          ${renderGaugeSvg(cs.percentage, 100, 7)}
          <span class="text-xs font-medium mt-2.5 text-center leading-tight">${CATEGORY_LABELS[cat]}</span>
          <span class="text-[11px] text-muted-foreground">${cs.issueCount} issues</span>
          <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block bg-zinc-900 text-white text-xs px-3 py-2 rounded-md whitespace-nowrap z-10 shadow-lg pointer-events-none">
            ${esc(desc)}
            <div class="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-zinc-900"></div>
          </div>
        </div>`;
  }).join("\n")}
      </div>
    </section>

    <!-- Issue Summary -->
    <section class="bg-card border border-border rounded-lg shadow-sm p-4 mb-6">
      <div class="flex flex-wrap items-center justify-center gap-6">
        ${renderSummaryDot("bg-red-500", scores.summary.blocking, "Blocking")}
        ${renderSummaryDot("bg-amber-500", scores.summary.risk, "Risk")}
        ${renderSummaryDot("bg-zinc-400", scores.summary.missingInfo, "Missing Info")}
        ${renderSummaryDot("bg-green-500", scores.summary.suggestion, "Suggestion")}
        <div class="border-l border-border pl-6 flex items-center gap-2">
          <span class="text-xl font-bold tracking-tight">${scores.summary.totalIssues}</span>
          <span class="text-sm text-muted-foreground">Total</span>
        </div>
      </div>
    </section>

${quickWins.length > 0 ? renderOpportunities(quickWins, file.fileKey) : ""}

    <!-- Categories -->
    <div class="space-y-3">
${CATEGORIES.map(cat => renderCategory(cat, scores, issuesByCategory.get(cat) ?? [], file.fileKey, screenshotMap)).join("\n")}
    </div>

    <!-- Footer -->
    <footer class="mt-12 pt-6 border-t border-border text-center">
      <p class="text-sm text-muted-foreground">Generated by <span class="font-semibold text-foreground">AIReady</span></p>
      <p class="text-xs text-muted-foreground/60 mt-1">${new Date().toLocaleString()} · ${result.nodeCount} nodes · Max depth ${result.maxDepth}</p>
    </footer>

  </main>

  <script>
    async function postComment(btn) {
      let token = sessionStorage.getItem('figma_token');
      if (!token) {
        token = prompt('Enter your Figma API token to post comments:');
        if (!token) return;
        sessionStorage.setItem('figma_token', token);
      }

      const fileKey = btn.dataset.fileKey;
      const nodeId = btn.dataset.nodeId.replace(/-/g, ':');
      const rule = btn.dataset.rule;
      const message = btn.dataset.message;
      const path = btn.dataset.path;
      const fix = btn.dataset.fix;

      const commentBody = '[AIReady] ' + rule + ': ' + message + '\\nNode: ' + path + '\\nFix: ' + fix;

      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        const res = await fetch('https://api.figma.com/v1/files/' + fileKey + '/comments', {
          method: 'POST',
          headers: {
            'X-FIGMA-TOKEN': token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: commentBody,
            client_meta: { node_id: nodeId },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(errText);
        }

        btn.textContent = 'Sent \\u2713';
        btn.classList.remove('hover:bg-muted');
        btn.classList.add('text-green-600', 'border-green-500/30');
      } catch (e) {
        btn.textContent = 'Failed \\u2717';
        btn.classList.remove('hover:bg-muted');
        btn.classList.add('text-red-600', 'border-red-500/30');
        btn.disabled = false;
        console.error('Failed to post Figma comment:', e);
        // Clear stored token on auth failure so user can re-enter
        if (e.message && e.message.includes('403')) {
          sessionStorage.removeItem('figma_token');
        }
      }
    }
  </script>
</body>
</html>`;
}

// ---- Components ----

function renderGaugeSvg(pct: number, size: number, strokeW: number, grade?: Grade): string {
  const offset = GAUGE_C * (1 - pct / 100);
  const color = gaugeColor(pct);
  if (grade) {
    // Large gauge with grade inside
    return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" class="block">
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="${strokeW}" class="stroke-border" />
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${GAUGE_C}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)" class="gauge-fill" />
            <text x="60" y="60" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="52" font-weight="700" class="font-sans">${esc(grade)}</text>
          </svg>`;
  }
  const fontSize = 32;
  return `<svg width="${size}" height="${size}" viewBox="0 0 120 120" class="block">
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke-width="${strokeW}" class="stroke-border" />
            <circle cx="60" cy="60" r="${GAUGE_R}" fill="none" stroke="${color}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="${GAUGE_C}" stroke-dashoffset="${offset}" transform="rotate(-90 60 60)" class="gauge-fill" />
            <text x="60" y="62" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="${fontSize}" font-weight="700" class="font-sans">${pct}</text>
          </svg>`;
}

function renderSummaryDot(dotClass: string, count: number, label: string): string {
  return `<div class="flex items-center gap-2">
          <span class="w-2.5 h-2.5 rounded-full ${dotClass}"></span>
          <span class="text-lg font-bold tracking-tight">${count}</span>
          <span class="text-sm text-muted-foreground">${label}</span>
        </div>`;
}


function renderOpportunities(issues: AnalysisIssue[], fileKey: string): string {
  const maxAbs = issues.reduce((m, i) => Math.max(m, Math.abs(i.calculatedScore)), 1);
  return `
    <!-- Opportunities -->
    <section class="bg-card border border-border rounded-lg shadow-sm mb-6 overflow-hidden">
      <div class="px-6 py-4 border-b border-border">
        <h2 class="text-sm font-semibold flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-red-500"></span>
          Opportunities
        </h2>
        <p class="text-xs text-muted-foreground mt-1">Top blocking issues — fix these first for the biggest improvement.</p>
      </div>
      <div class="divide-y divide-border">
${issues.map(issue => {
    const def = issue.rule.definition;
    const link = buildFigmaDeepLink(fileKey, issue.violation.nodeId);
    const barW = Math.round((Math.abs(issue.calculatedScore) / maxAbs) * 100);
    return `        <div class="px-6 py-3 flex items-center gap-4 hover:bg-muted/50 transition-colors">
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium truncate">${esc(def.name)}</div>
            <div class="text-xs text-muted-foreground truncate mt-0.5">${esc(issue.violation.message)}</div>
          </div>
          <div class="w-32 flex items-center gap-2 shrink-0">
            <div class="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
              <div class="h-full bg-red-500 rounded-full" style="width:${barW}%"></div>
            </div>
            <span class="text-xs font-medium text-red-600 w-12 text-right">${issue.calculatedScore}</span>
          </div>
          <a href="${link}" target="_blank" rel="noopener" class="text-xs text-muted-foreground hover:text-foreground shrink-0 no-print">Figma →</a>
        </div>`;
  }).join("\n")}
      </div>
    </section>`;
}

function renderCategory(
  cat: Category,
  scores: ScoreReport,
  issues: AnalysisIssue[],
  fileKey: string,
  screenshotMap: Map<string, NodeScreenshot>
): string {
  const cs = scores.byCategory[cat];
  const hasProblems = issues.some(i => i.config.severity === "blocking" || i.config.severity === "risk");

  const bySeverity = new Map<Severity, AnalysisIssue[]>();
  for (const sev of SEVERITY_ORDER) bySeverity.set(sev, []);
  for (const issue of issues) bySeverity.get(issue.config.severity)?.push(issue);

  return `
      <details class="bg-card border border-border rounded-lg shadow-sm overflow-hidden group"${hasProblems ? " open" : ""}>
        <summary class="px-5 py-3.5 flex items-center gap-3 cursor-pointer hover:bg-muted/50 transition-colors select-none">
          <span class="inline-flex items-center justify-center w-10 h-6 rounded-md text-xs font-bold border ${scoreBadgeStyle(cs.percentage)}">${cs.percentage}</span>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold">${CATEGORY_LABELS[cat]}</div>
            <div class="text-xs text-muted-foreground">${esc(CATEGORY_DESCRIPTIONS[cat])}</div>
          </div>
          <span class="text-xs text-muted-foreground">${cs.issueCount} issues</span>
          <svg class="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180 shrink-0 no-print" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 9l-7 7-7-7"/></svg>
        </summary>
        <div class="border-t border-border">
${issues.length === 0
    ? '          <div class="px-5 py-4 text-sm text-green-600 font-medium">No issues found</div>'
    : SEVERITY_ORDER
        .filter(sev => (bySeverity.get(sev)?.length ?? 0) > 0)
        .map(sev => renderSeverityGroup(sev, bySeverity.get(sev) ?? [], fileKey, screenshotMap))
        .join("\n")
}
        </div>
      </details>`;
}

function renderSeverityGroup(
  sev: Severity,
  issues: AnalysisIssue[],
  fileKey: string,
  screenshotMap: Map<string, NodeScreenshot>
): string {
  return `          <div class="px-5 py-3">
            <div class="flex items-center gap-2 mb-2">
              <span class="w-2 h-2 rounded-full ${severityDot(sev)}"></span>
              <span class="text-xs font-semibold uppercase tracking-wider">${SEVERITY_LABELS[sev]}</span>
              <span class="text-xs text-muted-foreground ml-auto">${issues.length}</span>
            </div>
            <div class="space-y-1">
${issues.map(issue => renderIssueRow(issue, fileKey, screenshotMap)).join("\n")}
            </div>
          </div>`;
}

function renderIssueRow(
  issue: AnalysisIssue,
  fileKey: string,
  screenshotMap: Map<string, NodeScreenshot>
): string {
  const sev = issue.config.severity;
  const def = issue.rule.definition;
  const link = buildFigmaDeepLink(fileKey, issue.violation.nodeId);
  const screenshot = screenshotMap.get(issue.violation.nodeId);

  const screenshotHtml = screenshot
    ? `<div class="mt-3"><a href="${link}" target="_blank" rel="noopener"><img src="data:image/png;base64,${screenshot.screenshotBase64}" alt="${esc(screenshot.nodePath)}" class="max-w-[240px] border border-border rounded-md"></a></div>`
    : "";

  return `              <details class="border border-border rounded-md overflow-hidden">
                <summary class="flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 transition-colors">
                  <span class="w-1.5 h-1.5 rounded-full ${severityDot(sev)} shrink-0"></span>
                  <span class="font-medium shrink-0">${esc(def.name)}</span>
                  <span class="text-muted-foreground truncate text-xs flex-1">${esc(issue.violation.message)}</span>
                  <span class="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${severityBadge(sev)} shrink-0">${issue.calculatedScore}</span>
                </summary>
                <div class="px-3 py-3 bg-muted/30 border-t border-border text-sm space-y-2">
                  <div class="font-mono text-xs text-muted-foreground break-all">${esc(issue.violation.nodePath)}</div>
                  <div class="text-muted-foreground leading-relaxed space-y-1">
                    <p><span class="font-medium text-foreground">Why:</span> ${esc(def.why)}</p>
                    <p><span class="font-medium text-foreground">Impact:</span> ${esc(def.impact)}</p>
                    <p><span class="font-medium text-foreground">Fix:</span> ${esc(def.fix)}</p>
                  </div>${screenshotHtml}
                  <div class="flex items-center gap-2 mt-1 no-print">
                    <a href="${link}" target="_blank" rel="noopener" class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors">Open in Figma <span>→</span></a>
                    <button onclick="postComment(this)" data-file-key="${esc(fileKey)}" data-node-id="${esc(issue.violation.nodeId)}" data-rule="${esc(def.name)}" data-message="${esc(issue.violation.message)}" data-path="${esc(issue.violation.nodePath)}" data-fix="${esc(def.fix)}" class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-border rounded-md hover:bg-muted transition-colors cursor-pointer">Comment on Figma</button>
                  </div>
                </div>
              </details>`;
}

// ---- Utils ----

function getQuickWins(issues: AnalysisIssue[], limit: number): AnalysisIssue[] {
  return issues
    .filter(issue => issue.config.severity === "blocking")
    .sort((a, b) => a.calculatedScore - b.calculatedScore)
    .slice(0, limit);
}

function groupIssuesByCategory(issues: AnalysisIssue[]): Map<Category, AnalysisIssue[]> {
  const grouped = new Map<Category, AnalysisIssue[]>();
  for (const category of CATEGORIES) grouped.set(category, []);
  for (const issue of issues) grouped.get(issue.rule.definition.category)!.push(issue);
  return grouped;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
