import { readFile } from "node:fs/promises";

import type { CAC } from "cac";
import { z } from "zod";

import {
  ReanalyzeForTallySchema,
  StepFourReportSchema,
} from "../../core/contracts/roundtrip-tally.js";
import { EVENTS, trackError, trackEvent } from "../../core/monitoring/index.js";
import { computeRoundtripTally } from "../../core/roundtrip/compute-roundtrip-tally.js";

const RoundtripTallyCliOptionsSchema = z.object({
  analyze: z.string().min(1),
  step4: z.string().min(1),
});

function parseJsonFile(label: string, path: string, raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch (err) {
    throw new Error(
      `roundtrip-tally: ${label} is not valid JSON (${path})`,
      { cause: err },
    );
  }
}

async function readUtf8File(label: string, path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`roundtrip-tally: cannot read ${label} (${path}): ${detail}`, {
      cause: err,
    });
  }
}

/**
 * Reads a `canicode analyze --json` (re-analyze) file and a Step 4 structured
 * outcome-count file, then returns the same tally the canicode-roundtrip SKILL
 * renders after Step 5.
 */
export async function computeRoundtripTallyFromSavedFiles(args: {
  analyzePath: string;
  step4Path: string;
}): Promise<ReturnType<typeof computeRoundtripTally>> {
  const [analyzeRaw, step4Raw] = await Promise.all([
    readUtf8File("--analyze", args.analyzePath),
    readUtf8File("--step4", args.step4Path),
  ]);

  const analyzeParsed = parseJsonFile("--analyze", args.analyzePath, analyzeRaw);
  const step4Parsed = parseJsonFile("--step4", args.step4Path, step4Raw);

  const reanalyzeResult = ReanalyzeForTallySchema.safeParse(analyzeParsed);
  if (!reanalyzeResult.success) {
    const msg = reanalyzeResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `roundtrip-tally: --analyze must include issueCount and acknowledgedCount (${args.analyzePath}): ${msg}`,
    );
  }

  const stepFourResult = StepFourReportSchema.safeParse(step4Parsed);
  if (!stepFourResult.success) {
    const msg = stepFourResult.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(
      `roundtrip-tally: --step4 must match StepFourReport (${args.step4Path}): ${msg}`,
    );
  }

  return computeRoundtripTally({
    stepFourReport: stepFourResult.data,
    reanalyzeResponse: reanalyzeResult.data,
  });
}

export function registerRoundtripTally(cli: CAC): void {
  cli
    .command(
      "roundtrip-tally",
      "Print the Step 5 roundtrip tally from re-analyze JSON and Step 4 outcome counts",
    )
    .option("--analyze <path>", "Path to re-analyze JSON (`canicode analyze --json` output)")
    .option("--step4 <path>", "Path to Step 4 structured counts (resolved / annotated / definitionWritten / skipped)")
    .example("  canicode roundtrip-tally --analyze ./reanalyze.json --step4 ./step4-report.json")
    .action(async (rawOptions: Record<string, unknown>) => {
      const parsed = RoundtripTallyCliOptionsSchema.safeParse(rawOptions);
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `--${i.path.join(".")}: ${i.message}`)
          .join("\n");
        console.error(`\nroundtrip-tally requires --analyze and --step4:\n${msg}`);
        process.exit(1);
      }

      try {
        const tally = await computeRoundtripTallyFromSavedFiles({
          analyzePath: parsed.data.analyze,
          step4Path: parsed.data.step4,
        });
        console.log(JSON.stringify(tally, null, 2));
        trackEvent(EVENTS.ROUNDTRIP_TALLY);
      } catch (err) {
        if (err instanceof Error) {
          trackError(err, { command: "roundtrip-tally" });
          console.error(err.message);
        } else {
          console.error(err);
        }
        process.exit(1);
      }
    });
}
