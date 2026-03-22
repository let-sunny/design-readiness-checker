// Shared utility functions — delegates to CanICode.* globals (source of truth in src/core/ui-helpers.ts)
// These thin aliases keep backward compatibility for web app and Figma plugin inline scripts.

var escapeHtml = CanICode.escapeHtml;
var gaugeColor = CanICode.gaugeColor;
var scoreClass = CanICode.scoreClass;
var severityDotClass = CanICode.severityDotClass;
var severityScoreClass = CanICode.severityScoreClass;

function toggleSection(el) {
  el.parentElement.classList.toggle('collapsed');
}

function toggleIssue(el) {
  el.parentElement.classList.toggle('open');
}
