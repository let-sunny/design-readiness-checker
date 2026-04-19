#!/usr/bin/env tsx
/**
 * ADR-016 enforcement — flags deterministic logic that has crept into
 * `.claude/skills/*` SKILL.md files (either as imperative prose or as inline
 * JS/TS code that re-implements something a TypeScript helper should own).
 *
 * Companion to the helpers.js bundle drift CI added in PR #303 — that one
 * catches "helper changed but bundle didn't rebuild"; this one catches the
 * inverse, "prose got new logic that should have been a helper".
 *
 * Findings can be silenced with an inline ACK marker on the line directly
 * above the offending fenced code block (`<!-- adr-016-ack: reason -->`),
 * inside the code block (`// adr-016-ack: reason`), or on the same line for
 * prose findings (`<!-- adr-016-ack: reason -->`). Reviewers are expected to
 * justify each marker in the PR description.
 *
 * Run locally: `pnpm check:skill-determinism` (also runs in CI before tests).
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface Finding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

interface Pattern {
  re: RegExp;
  rule: string;
}

/**
 * Files in scope. Each is checked independently. The list is hard-coded
 * rather than glob-expanded so adding a new SKILL deliberately requires a
 * one-line edit here, which forces the author to read this file (and the ACK
 * grammar) before introducing new prose surface.
 */
export const SKILL_FILES = [
  ".claude/skills/canicode-roundtrip/SKILL.md",
  ".claude/skills/canicode-gotchas/SKILL.md",
  ".claude/skills/canicode/SKILL.md",
];

/**
 * Patterns flagged inside fenced JS / TS code blocks. Each pattern matches a
 * historical violation shape (see ADR-016 Why for the regression record).
 * Genuine SDK / helper invocations (`figma.<api>(...)`,
 * `CanICodeRoundtrip.<helper>(...)`, plain property reads/writes) do not
 * match any of these.
 */
export const CODE_BLOCK_PATTERNS: Pattern[] = [
  { re: /\.(filter|reduce|flatMap)\(/, rule: "code:array-transform" },
  { re: /\bfor\s*(\(|await\s*\()/, rule: "code:for-loop" },
  { re: /\bwhile\s*\(/, rule: "code:while-loop" },
  { re: /\bnew\s+(Set|Map)\(/, rule: "code:collection-construct" },
  { re: /\b(parseInt|parseFloat)\b/, rule: "code:numeric-parse" },
  { re: /\.split\(['"`]/, rule: "code:string-split" },
  { re: /\.match\(\//, rule: "code:string-match" },
];

/**
 * Patterns flagged in prose (anywhere outside a fenced code block).
 * Targeting the imperative shape "tell the LLM to compute X by doing Y" —
 * the surface that historically masked dead `fileKey` extraction, the
 * `<count of ✅>` tally inputs, and the URL parsing `survey.designKey`
 * replaced.
 */
export const PROSE_PATTERNS: Pattern[] = [
  { re: /<count\s+of\s/i, rule: "prose:count-of-template" },
  { re: /count of (✅|🔧|🔗|📝|❌)/u, rule: "prose:emoji-counting" },
  {
    re: /\b(extract|parse)\b[^.\n]*\bfrom\b[^.\n]*\b(URL|node[- ]id|fileKey|file key)\b/i,
    rule: "prose:url-parse",
  },
];

const ACK_INLINE = /<!--\s*adr-016-ack:\s*([^>]+?)\s*-->/;
const ACK_CODE_LINE = /\/\/\s*adr-016-ack:\s*(.+?)$/;

const CHECKED_FENCE_LANGS = new Set(["js", "javascript", "ts", "typescript", ""]);

/**
 * Returns true only when the line carries an ACK marker AND the captured
 * reason has at least one non-whitespace character. An empty / whitespace-only
 * reason (e.g. `<!-- adr-016-ack: -->`) is treated as a missing ACK so a
 * silenced finding still surfaces in CI — reviewer must add a real reason.
 */
function hasNonEmptyAck(line: string, re: RegExp): boolean {
  const match = line.match(re);
  if (!match) return false;
  const reason = match[1] ?? "";
  return reason.trim().length > 0;
}

export function scan(file: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");

  let inFence = false;
  let fenceLang = "";
  let blockAcked = false; // entire current block exempted via ACK on opening fence

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const lineNum = i + 1;

    const fenceOpen = line.match(/^```([\w-]+)?\s*$/);
    if (fenceOpen) {
      if (!inFence) {
        inFence = true;
        fenceLang = (fenceOpen[1] ?? "").toLowerCase();
        const prev = lines[i - 1] ?? "";
        blockAcked = hasNonEmptyAck(prev, ACK_INLINE);
      } else {
        inFence = false;
        fenceLang = "";
        blockAcked = false;
      }
      continue;
    }

    if (inFence) {
      if (!CHECKED_FENCE_LANGS.has(fenceLang)) continue;
      if (blockAcked) continue;
      if (hasNonEmptyAck(line, ACK_CODE_LINE)) continue;
      for (const { re, rule } of CODE_BLOCK_PATTERNS) {
        if (re.test(line)) {
          findings.push({ file, line: lineNum, rule, excerpt: line.trim() });
        }
      }
    } else {
      if (hasNonEmptyAck(line, ACK_INLINE)) continue;
      for (const { re, rule } of PROSE_PATTERNS) {
        if (re.test(line)) {
          findings.push({ file, line: lineNum, rule, excerpt: line.trim() });
        }
      }
    }
  }

  return findings;
}

function main(): void {
  const root = process.cwd();
  const allFindings: Finding[] = [];

  for (const rel of SKILL_FILES) {
    const path = resolve(root, rel);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf-8");
    allFindings.push(...scan(rel, content));
  }

  if (allFindings.length === 0) {
    console.log("✓ check-skill-determinism: no ADR-016 violations found");
    process.exit(0);
  }

  console.error("✗ check-skill-determinism: ADR-016 violations found\n");
  console.error("  Per ADR-016 (.claude/docs/ADR.md), deterministic logic in");
  console.error("  SKILL.md must be extracted to TypeScript with vitest coverage.");
  console.error("  Each finding must either be:");
  console.error("    (a) extracted to a helper in src/core/ + consumed via");
  console.error("        helpers.js (canicode-roundtrip) or a response field");
  console.error("        (canicode-gotchas), OR");
  console.error("    (b) marked with `<!-- adr-016-ack: <reason> -->` on the");
  console.error("        preceding line (for code blocks), or with");
  console.error("        `// adr-016-ack: <reason>` inline (for individual code");
  console.error("        lines), or `<!-- adr-016-ack: <reason> -->` on the");
  console.error("        same line (for prose). Justify each ACK in the PR");
  console.error("        description.\n");

  for (const f of allFindings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.excerpt}\n`);
  }
  console.error(`  ${allFindings.length} finding(s).`);
  process.exit(1);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-skill-determinism.ts");
if (isMain) {
  main();
}
