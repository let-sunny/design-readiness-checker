/**
 * Name patterns for nodes that should be excluded from certain rule checks.
 * These are typically decorative, structural, or overlay elements where
 * issues like naming, absolute positioning, etc. are intentional.
 *
 * Matches if the name contains any of these words (case-insensitive).
 */
export const EXCLUDED_NAME_PATTERN = /(badge|close|dismiss|overlay|float|fab|dot|indicator|corner|decoration|tag|status|notification|icon|ico|image|asset|filter|dim|dimmed|bg|background|logo|avatar|divider|separator|nav|navigation|gnb|header|footer|sidebar|toolbar|modal|dialog|popup|toast|tooltip|dropdown|menu|sticky|spinner|loader|cursor|cta|chatbot|thumb|thumbnail|tabbar|tab-bar|statusbar|status-bar)/i;

/**
 * Check if a node name matches excluded patterns.
 */
export function isExcludedName(name: string): boolean {
  return EXCLUDED_NAME_PATTERN.test(name);
}
