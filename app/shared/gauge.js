// Shared gauge SVG rendering — delegates to CanICode.* globals (source of truth in src/core/ui-helpers.ts)
// This thin alias keeps backward compatibility for web app and Figma plugin inline scripts.

var renderGaugeSvg = CanICode.renderGaugeSvg;
