export const CONVENTIONAL_PREFIX_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s/;

export function conventionalizeTitle(title: string): string {
  return CONVENTIONAL_PREFIX_RE.test(title) ? title : `feat: ${title}`;
}
