#!/usr/bin/env tsx
/**
 * #508 H — Stage 3 base rate audit.
 * Runs analyze on all 24 fixtures and aggregates `missing-component`
 * subType=structure-repetition issue stats.
 *
 * Output: logs/h-audit-stage3.json
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";

const FIXTURES_DIR = resolve("fixtures/done");
const OUT_DIR = resolve("logs/h-audit");
const OUT_PATH = join(OUT_DIR, "stage3-base-rate.json");
const PER_FIXTURE_DIR = join(OUT_DIR, "per-fixture");

mkdirSync(PER_FIXTURE_DIR, { recursive: true });

const fixtures = readdirSync(FIXTURES_DIR).filter((d) => {
  try {
    readFileSync(join(FIXTURES_DIR, d, "data.json"));
    return true;
  } catch {
    return false;
  }
});

interface PerFixture {
  fixture: string;
  nodeCount: number;
  totalIssues: number;
  stage3Count: number;
  stage1Count: number;
  stage2Count: number;
  stage4Count: number;
  groupSizes: number[];
  groups: Array<{ nodeId: string; nodeName: string; siblingCount: number; total: number }>;
}

const results: PerFixture[] = [];

const cli = `node ${resolve("dist/cli/index.js")}`;

for (const fixture of fixtures) {
  const fixturePath = join(FIXTURES_DIR, fixture, "data.json");
  const outFile = join(PER_FIXTURE_DIR, `${fixture}.json`);
  process.stderr.write(`[h-audit] ${fixture}... `);

  const r = spawnSync(cli, ["calibrate-analyze", fixturePath, "--output", outFile, "--scope", "page"], {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FIGMA_TOKEN: process.env["FIGMA_TOKEN"] ?? "noop" },
  });

  if (r.status !== 0) {
    process.stderr.write(`FAIL\n${r.stderr.toString()}\n`);
    continue;
  }

  const raw = JSON.parse(readFileSync(outFile, "utf-8"));
  const issues = raw.scoreReport?.issues ?? raw.nodeIssueSummaries ?? [];

  // nodeIssueSummaries shape is per-node grouped — we need raw issue list.
  // calibrate-analyze doesn't dump raw issues. Re-derive from scoreReport.ruleScores or fall back.
  // Use ruleScores to get count per rule, then re-scan for per-issue subType.
  // Simpler: also dump scoreReport issues if present.

  // The output JSON includes scoreReport which has perRule but not per-issue subType.
  // Pull per-rule:
  const perRule = raw.scoreReport?.perRule ?? {};
  const missingComponentRule = perRule["missing-component"];

  // Without subType breakdown in calibrate-analyze output, walk nodeIssueSummaries
  // (which is filtered) for the rule id at minimum.
  let stage1 = 0;
  let stage2 = 0;
  let stage3 = 0;
  let stage4 = 0;
  const groupsRaw: Array<{ nodeId: string; nodeName: string; siblingCount: number; total: number }> = [];

  for (const nodeSummary of raw.nodeIssueSummaries ?? []) {
    for (const issue of nodeSummary.issues ?? []) {
      if (issue.ruleId !== "missing-component") continue;
      const sub = issue.subType ?? "";
      if (sub === "name-match-with-frame-repetition") stage1++;
      else if (sub === "name-repetition") stage2++;
      else if (sub === "structure-repetition") {
        stage3++;
        // message format: `"NAME" and N sibling frame(s) share the same internal structure`
        const m = (issue.message ?? "").match(/and (\d+) sibling/);
        const siblingCount = m ? parseInt(m[1] ?? "0", 10) : 0;
        groupsRaw.push({
          nodeId: nodeSummary.nodeId,
          nodeName: nodeSummary.nodeName ?? "",
          siblingCount,
          total: siblingCount + 1,
        });
      } else if (sub === "style-override") stage4++;
    }
  }

  results.push({
    fixture,
    nodeCount: raw.nodeCount ?? 0,
    totalIssues: raw.issueCount ?? 0,
    stage1Count: stage1,
    stage2Count: stage2,
    stage3Count: stage3,
    stage4Count: stage4,
    groupSizes: groupsRaw.map((g) => g.total),
    groups: groupsRaw,
  });

  process.stderr.write(`stage3=${stage3} groups=${groupsRaw.length}\n`);
}

// Aggregate
const fixtureCount = results.length;
const stage3FiringFixtures = results.filter((r) => r.stage3Count > 0).length;
const totalStage3Groups = results.reduce((s, r) => s + r.stage3Count, 0);
const totalNodes = results.reduce((s, r) => s + r.nodeCount, 0);
const groupSizeAll = results.flatMap((r) => r.groupSizes);
const groupSizeBuckets: Record<string, number> = {};
for (const size of groupSizeAll) {
  const bucket = size >= 5 ? "5+" : String(size);
  groupSizeBuckets[bucket] = (groupSizeBuckets[bucket] ?? 0) + 1;
}

const summary = {
  generatedAt: new Date().toISOString(),
  fixtureCount,
  totalNodes,
  stage3FiringFixtures,
  stage3FiringRate: fixtureCount > 0 ? +(stage3FiringFixtures / fixtureCount).toFixed(3) : 0,
  totalStage3Groups,
  meanGroupsPerFiringFixture: stage3FiringFixtures > 0 ? +(totalStage3Groups / stage3FiringFixtures).toFixed(2) : 0,
  groupSizeBuckets,
  perFixture: results,
};

writeFileSync(OUT_PATH, JSON.stringify(summary, null, 2), "utf-8");
process.stderr.write(`\n=== Summary ===\n`);
process.stderr.write(`fixtures: ${fixtureCount}\n`);
process.stderr.write(`stage3 firing fixtures: ${stage3FiringFixtures}/${fixtureCount} (${(summary.stage3FiringRate * 100).toFixed(1)}%)\n`);
process.stderr.write(`total stage3 groups: ${totalStage3Groups}\n`);
process.stderr.write(`mean groups/firing fixture: ${summary.meanGroupsPerFiringFixture}\n`);
process.stderr.write(`group size buckets: ${JSON.stringify(groupSizeBuckets)}\n`);
process.stderr.write(`\nReport: ${OUT_PATH}\n`);
