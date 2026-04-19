import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CAC } from "cac";
import { z } from "zod";

import { renderUpsertedFile } from "../../core/gotcha/upsert-gotcha-section.js";

/**
 * Atomic read → upsert → write of the per-design gotcha section into the
 * `canicode-gotchas` SKILL.md. Owns the deterministic markdown parsing
 * the SKILL used to inline as prose (file-state detection, `## #NNN — ...`
 * walking, monotonic numbering) — see ADR-303 / PR #303 and #385.
 *
 * Inputs:
 * - `--file <path>`: the SKILL.md path. Required.
 * - `--design-key <key>`: canonical design key from `gotcha-survey`'s
 *   response. Required.
 * - `--section <markdown>`: the already-rendered per-design section body
 *   the SKILL produced from its template. The header line is expected to
 *   contain the literal `{{SECTION_NUMBER}}` placeholder, which this
 *   command substitutes with either the preserved existing NNN (replace)
 *   or the next monotonic NNN (append). If the placeholder is absent the
 *   section markdown is written verbatim. Either pass via `--section` or
 *   pipe through stdin (`--section -`).
 *
 * Outputs (stdout, JSON):
 * ```
 * {
 *   "state": "valid" | "missing" | "missing-heading" | "clobbered",
 *   "action": "replace" | "append" | null,
 *   "sectionNumber": "NNN" | null,
 *   "wrote": true | false,
 *   "userMessage": string | null
 * }
 * ```
 *
 * For `state === "missing"` and `state === "clobbered"` the helper does
 * not write — the SKILL surfaces `userMessage` to the user (asking them to
 * run `canicode init` or `canicode init --force`) and stops.
 */
const UpsertOptionsSchema = z.object({
  file: z.string().min(1, "--file is required"),
  designKey: z.string().min(1, "--design-key is required"),
  section: z.string().min(1, "--section is required (use '-' to read stdin)"),
});

type UpsertOptions = z.infer<typeof UpsertOptionsSchema>;

interface UpsertCliResult {
  state: string;
  action: "replace" | "append" | null;
  sectionNumber: string | null;
  wrote: boolean;
  userMessage: string | null;
}

const USER_MESSAGES: Record<string, string> = {
  missing:
    "Gotchas SKILL.md not found at the given path. Run `canicode init` first, then re-invoke this skill.",
  clobbered:
    "Your gotchas SKILL.md is missing the canicode YAML frontmatter (pre-#340 single-design clobber). Run `canicode init --force` to restore the workflow, then re-run this survey.",
};

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

export async function runUpsertGotchaSection(
  options: UpsertOptions,
): Promise<UpsertCliResult> {
  const sectionMarkdown =
    options.section === "-" ? await readStdin() : options.section;

  const currentContent = existsSync(options.file)
    ? readFileSync(options.file, "utf-8")
    : null;

  const { state, newContent, plan } = renderUpsertedFile({
    currentContent,
    designKey: options.designKey,
    sectionMarkdown,
  });

  if (newContent === null) {
    return {
      state,
      action: null,
      sectionNumber: null,
      wrote: false,
      userMessage: USER_MESSAGES[state] ?? null,
    };
  }

  writeFileSync(options.file, newContent, "utf-8");
  return {
    state,
    action: plan?.action ?? null,
    sectionNumber: plan?.sectionNumber ?? null,
    wrote: true,
    userMessage: null,
  };
}

export function registerUpsertGotchaSection(cli: CAC): void {
  cli
    .command(
      "upsert-gotcha-section",
      "Upsert a per-design section into the canicode-gotchas SKILL.md (used by the canicode-gotchas skill — Step 4b)",
    )
    .option("--file <path>", "Path to the canicode-gotchas SKILL.md")
    .option(
      "--design-key <key>",
      "Canonical design key from gotcha-survey's response",
    )
    .option(
      "--section <markdown>",
      "Already-rendered per-design section markdown. Use '-' to read from stdin.",
    )
    .action(async (rawOptions: Record<string, unknown>) => {
      const parseResult = UpsertOptionsSchema.safeParse(rawOptions);
      if (!parseResult.success) {
        const msg = parseResult.error.issues
          .map((i) => `--${i.path.join(".")}: ${i.message}`)
          .join("\n");
        console.error(`\nInvalid options:\n${msg}`);
        process.exit(1);
      }

      try {
        const result = await runUpsertGotchaSection(parseResult.data);
        console.log(JSON.stringify(result, null, 2));
        if (!result.wrote && result.userMessage) {
          // Non-zero exit so a wrapping shell script / SKILL knows to
          // surface the userMessage and stop, rather than treating an
          // unwritten file as success.
          process.exitCode = 2;
        }
      } catch (error) {
        console.error(
          "\nError:",
          error instanceof Error ? error.message : String(error),
        );
        process.exitCode = 1;
      }
    });
}
