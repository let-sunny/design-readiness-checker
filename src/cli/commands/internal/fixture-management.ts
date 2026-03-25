import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CAC } from "cac";

import {
  listActiveFixtures,
  listDoneFixtures,
  moveFixtureToDone,
  parseDebateResult,
  extractAppliedRuleIds,
  extractFixtureName,
  resolveLatestRunDir,
  checkConvergence,
} from "../../../agents/run-directory.js";
import {
  pruneCalibrationEvidence,
  pruneDiscoveryEvidence,
} from "../../../agents/evidence-collector.js";

export function registerFixtureManagement(cli: CAC): void {
  cli
    .command(
      "fixture-list [fixturesDir]",
      "List active and done fixtures"
    )
    .option("--json", "Output as JSON")
    .action((fixturesDir: string | undefined, options: { json?: boolean }) => {
      const dir = fixturesDir ?? "fixtures";
      const active = listActiveFixtures(dir);
      const done = listDoneFixtures(dir);

      if (options.json) {
        console.log(JSON.stringify({ active, done }, null, 2));
      } else {
        console.log(`Active fixtures (${active.length}):`);
        for (const p of active) {
          console.log(`  ${p}`);
        }
        console.log(`\nDone fixtures (${done.length}):`);
        for (const p of done) {
          console.log(`  ${p}`);
        }
      }
    });

  cli
    .command(
      "fixture-done <fixturePath>",
      "Move a converged fixture to done/"
    )
    .option("--fixtures-dir <path>", "Fixtures root directory", { default: "fixtures" })
    .option("--force", "Skip convergence check")
    .option("--run-dir <path>", "Run directory to check for convergence (auto-resolves latest if omitted)")
    .option("--dry-run", "Show convergence judgment without moving files")
    .option(
      "--lenient-convergence",
      "Converged when no applied/revised decisions (ignore rejected; see calibration issue #14)"
    )
    .action(
      (fixturePath: string, options: {
        fixturesDir?: string;
        force?: boolean;
        runDir?: string;
        dryRun?: boolean;
        lenientConvergence?: boolean;
      }) => {
      const fixtureName = extractFixtureName(fixturePath);

      // Resolve run directory: explicit --run-dir or auto-resolve latest
      let runDir = options.runDir ? resolve(options.runDir) : null;
      if (!runDir && !options.force) {
        const latest = resolveLatestRunDir(fixtureName);
        if (latest) {
          runDir = latest;
          console.log(`Auto-resolved latest run: ${runDir}`);
        }
      }

      if (!options.force) {
        if (!runDir) {
          console.error(`Error: no run directory found for fixture "${fixtureName}". Specify --run-dir, or use --force to skip check.`);
          process.exitCode = 1; return;
        }
        const summary = checkConvergence(runDir, { lenient: options.lenientConvergence });
        console.log(`\nConvergence check (${summary.mode}):`);
        console.log(`  ${summary.reason}`);
        if (summary.total > 0) {
          console.log(`  applied=${summary.applied} revised=${summary.revised} rejected=${summary.rejected} kept=${summary.kept}`);
        }

        if (options.dryRun) {
          console.log(`\n[dry-run] Would ${summary.converged ? "move" : "NOT move"} fixture: ${fixturePath}`);
          return;
        }

        if (!summary.converged) {
          console.error(`\nError: fixture has not converged. Use --force to override or --lenient-convergence.`);
          process.exitCode = 1; return;
        }
      } else if (options.dryRun) {
        console.log(`[dry-run] --force: would move fixture without convergence check: ${fixturePath}`);
        return;
      }

      const dest = moveFixtureToDone(fixturePath, options.fixturesDir ?? "fixtures");
      if (dest) {
        console.log(`\nMoved to: ${dest}`);
      } else {
        console.error(`Error: fixture not found: ${fixturePath}`);
        process.exitCode = 1;
      }
    });
}

export function registerEvidencePrune(cli: CAC): void {
  cli
    .command(
      "calibrate-prune-evidence <runDir>",
      "Prune evidence for rules applied by the Arbitrator in the given run"
    )
    .action((runDir: string) => {
      if (!existsSync(resolve(runDir))) {
        console.log(`Run directory not found: ${runDir}`);
        return;
      }
      const debate = parseDebateResult(resolve(runDir));
      if (!debate) {
        console.log("No debate.json found — nothing to prune.");
        return;
      }

      const appliedIds = extractAppliedRuleIds(debate);
      if (appliedIds.length === 0) {
        console.log("No applied/revised rules — nothing to prune.");
        return;
      }

      pruneCalibrationEvidence(appliedIds);
      console.log(`Pruned calibration evidence for ${appliedIds.length} rule(s): ${appliedIds.join(", ")}`);
    });

  cli
    .command(
      "discovery-prune-evidence <category>",
      "Prune discovery evidence for a category addressed by /add-rule"
    )
    .action((category: string | string[]) => {
      const categories = Array.isArray(category) ? category : [category];
      try {
        pruneDiscoveryEvidence(categories);
        console.log(`Pruned discovery evidence for categories: ${categories.join(", ")}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[evidence] Failed to prune discovery evidence: ${msg}`);
        process.exitCode = 1;
      }
    });
}
