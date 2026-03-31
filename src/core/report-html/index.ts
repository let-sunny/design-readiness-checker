// Report HTML module — full page generation for CLI
// Rendering logic lives in render.ts (shared with web/plugin)

import type { AnalysisFile } from "../contracts/figma-node.js";
import type { AnalysisResult } from "../engine/rule-engine.js";
import type { ScoreReport } from "../engine/scoring.js";
import { escapeHtml } from "../ui-helpers.js";
import { renderReportBody, initReportInteractions } from "./render.js";
import type { ReportData } from "./render.js";

declare const __REPORT_CSS__: string;
const reportCss: string = __REPORT_CSS__;

export type { ReportData } from "./render.js";
export { renderReportBody, initReportInteractions } from "./render.js";

export interface NodeScreenshot {
  nodeId: string;
  nodePath: string;
  screenshotBase64: string;
  issueCount: number;
  topSeverity: string;
}

export interface HtmlReportOptions {
  nodeScreenshots?: NodeScreenshot[];
  figmaToken?: string | undefined;
}

const esc = escapeHtml;

/**
 * Generate a complete standalone HTML report page.
 * Used by CLI — opens in browser.
 */
export function generateHtmlReport(
  file: AnalysisFile,
  result: AnalysisResult,
  scores: ScoreReport,
  options?: HtmlReportOptions
): string {
  const figmaToken = options?.figmaToken;

  const data: ReportData = {
    fileName: file.name,
    fileKey: file.fileKey,
    scores,
    issues: result.issues,
    nodeCount: result.nodeCount,
    maxDepth: result.maxDepth,
    ...(figmaToken && { figmaToken }),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CanICode Report — ${esc(file.name)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
${reportCss}
    .cli-topbar {
      background: #09090b; color: white;
      border-bottom: 1px solid #27272a;
    }
    .cli-topbar-inner {
      max-width: 960px; margin: 0 auto;
      padding: 12px 24px;
      display: flex; align-items: center; gap: 16px;
    }
    .cli-topbar-logo { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }
    .cli-topbar-file { color: #a1a1aa; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cli-topbar-date { margin-left: auto; color: #71717a; font-size: 12px; }
    .cli-main { max-width: 960px; margin: 0 auto; padding: 0 24px 64px; }
    @media print {
      .cli-topbar { position: static !important; background: white !important; color: var(--fg) !important; }
      .cli-topbar-file { color: var(--fg-muted) !important; }
    }
  </style>
</head>
<body>

  <!-- Top Bar -->
  <header class="cli-topbar">
    <div class="cli-topbar-inner">
      <span class="cli-topbar-logo">CanICode</span>
      <span class="cli-topbar-file">${esc(file.name)}</span>
      <span class="cli-topbar-date no-print">${new Date().toLocaleDateString()}</span>
    </div>
  </header>

  <main class="cli-main">
${renderReportBody(data)}
  </main>

  <script>(${String(initReportInteractions)})(document.querySelector('.cli-main'));</script>
${figmaToken ? renderFigmaCommentScript(figmaToken) : ""}
</body>
</html>`;
}

function renderFigmaCommentScript(figmaToken: string): string {
  return `  <script>
    const FIGMA_TOKEN = '${figmaToken}';
    async function postComment(btn) {
      const fileKey = btn.dataset.fileKey;
      const nodeId = btn.dataset.nodeId.replace(/-/g, ':');
      const commentNodeId = nodeId.split(';')[0].replace(/^I/, '');
      const message = btn.dataset.message;
      const commentBody = '[CanICode] ' + message;
      btn.disabled = true;
      btn.textContent = 'Sending...';
      btn.title = '';
      try {
        const res = await fetch('https://api.figma.com/v1/files/' + fileKey + '/comments', {
          method: 'POST',
          headers: { 'X-FIGMA-TOKEN': FIGMA_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: commentBody, client_meta: { node_id: commentNodeId, node_offset: { x: 0, y: 0 } } }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          const errMsg = res.status === 400 ? 'Bad request' : res.status === 403 ? 'Token lacks file access' : res.status === 404 ? 'File not found' : res.status === 429 ? 'Rate limited' : 'HTTP ' + res.status;
          throw new Error(errMsg + (errBody ? ': ' + errBody.slice(0, 100) : ''));
        }
        btn.textContent = 'Sent';
        btn.classList.remove('rpt-btn-fail');
        btn.classList.add('rpt-btn-ok');
      } catch (e) {
        btn.textContent = 'Failed';
        btn.title = e.message || String(e);
        btn.classList.remove('rpt-btn-ok');
        btn.classList.add('rpt-btn-fail');
        btn.disabled = false;
      }
    }
  </script>`;
}
