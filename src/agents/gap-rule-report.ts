import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { RULE_CONFIGS } from "../core/rules/rule-config.js";
import type { RuleId } from "../core/contracts/rule.js";
import { runCalibrationEvaluate } from "./calibration-compute.js";
import { GapAnalyzerOutputSchema } from "./contracts/gap-analyzer.js";
import { loadCalibrationEvidence } from "./evidence-collector.js";

type CalibrationAnalysisJson = Parameters<typeof runCalibrationEvaluate>[0] & {
  ruleScores: Record<string, { score: number; severity: string }>;
};

export interface GapRuleReportOptions {
  calibrationDir: string;
  minPatternRepeat: number;
}

export interface GapRuleReportResult {
  markdown: string;
  runCount: number;
  gapRunCount: number;
}

interface NormalizedGap {
  category: string;
  description: string;
  area?: string;
  coveredByExistingRule: boolean;
  existingRule: string | null;
  actionable: boolean;
  fixtureKey: string;
}

interface ParsedGapFile {
  runDir: string;
  fixtureKey: string;
  similarity: number | undefined;
  gaps: NormalizedGap[];
  newRuleSuggestions: Array<{ ruleId: string; rationale?: string }>;
}

function fixtureKeyFromRunDir(runDir: string, raw: Record<string, unknown>): string {
  const fromJson =
    (typeof raw["fileKey"] === "string" && raw["fileKey"]) ||
    (typeof raw["fixture"] === "string" && raw["fixture"]);
  if (fromJson) return fromJson;
  // Extract fixture name from run dir name: <fixture-name>--<timestamp>
  const dirName = runDir.split(/[/\\]/).pop() ?? runDir;
  const idx = dirName.lastIndexOf("--");
  return idx === -1 ? dirName : dirName.slice(0, idx);
}

function normalizeGapEntry(
  raw: Record<string, unknown>,
  fixtureKey: string
): NormalizedGap | null {
  const category = typeof raw["category"] === "string" ? raw["category"] : "unknown";
  const description =
    typeof raw["description"] === "string" ? raw["description"] : "";
  const area = typeof raw["area"] === "string" ? raw["area"] : undefined;

  let covered = false;
  if (typeof raw["coveredByExistingRule"] === "boolean") {
    covered = raw["coveredByExistingRule"];
  } else if (raw["coveredByRule"] === true) {
    covered = true;
  }

  let existingRule: string | null = null;
  if (typeof raw["existingRule"] === "string") {
    existingRule = raw["existingRule"];
  }

  const actionable = raw["actionable"] !== false;

  if (!description && !area) return null;

  return {
    category,
    description,
    ...(area !== undefined ? { area } : {}),
    coveredByExistingRule: covered,
    existingRule,
    actionable,
    fixtureKey,
  };
}

function parseGapFile(runDir: string, gapsPath: string): ParsedGapFile | null {
  let raw: Record<string, unknown>;
  try {
    const parsed = JSON.parse(readFileSync(gapsPath, "utf-8")) as unknown;
    // Validate with Zod schema; fall back to best-effort parsing on failure
    const validation = GapAnalyzerOutputSchema.safeParse(parsed);
    if (validation.success) {
      raw = validation.data as unknown as Record<string, unknown>;
    } else {
      // Schema validation failed — use raw data with best-effort parsing
      raw = parsed as Record<string, unknown>;
    }
  } catch {
    return null;
  }

  const fixtureKey = fixtureKeyFromRunDir(runDir, raw);
  const gapsRaw = raw["gaps"];
  const gaps: NormalizedGap[] = [];
  if (Array.isArray(gapsRaw)) {
    for (const g of gapsRaw) {
      if (!g || typeof g !== "object") continue;
      const n = normalizeGapEntry(g as Record<string, unknown>, fixtureKey);
      if (n) gaps.push(n);
    }
  }

  const newRuleSuggestions: Array<{ ruleId: string; rationale?: string }> = [];
  const sug = raw["newRuleSuggestions"];
  if (Array.isArray(sug)) {
    for (const s of sug) {
      if (!s || typeof s !== "object") continue;
      const o = s as Record<string, unknown>;
      if (typeof o["ruleId"] === "string") {
        const entry: { ruleId: string; rationale?: string } = { ruleId: o["ruleId"] };
        if (typeof o["rationale"] === "string") {
          entry.rationale = o["rationale"];
        }
        newRuleSuggestions.push(entry);
      }
    }
  }

  return {
    runDir,
    fixtureKey,
    similarity: typeof raw["similarity"] === "number" ? raw["similarity"] : undefined,
    gaps,
    newRuleSuggestions,
  };
}

function patternKey(g: NormalizedGap): string {
  const label = (g.area ?? g.description).trim().slice(0, 120);
  return `${g.category}|${label.toLowerCase().replace(/\s+/g, " ")}`;
}

/**
 * List all run directories under the calibration dir.
 * Each run dir is expected to be `<name>--<timestamp>`.
 */
function listRunDirs(calibrationDir: string): string[] {
  if (!existsSync(calibrationDir)) return [];
  return readdirSync(calibrationDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.includes("--"))
    .map((e) => join(calibrationDir, e.name))
    .sort();
}

interface RunSnapshot {
  dir: string;
  label: string;
  analysis: CalibrationAnalysisJson;
  conversion: Record<string, unknown>;
}

function loadRunSnapshot(dir: string): RunSnapshot | null {
  const aPath = join(dir, "analysis.json");
  const cPath = join(dir, "conversion.json");
  if (!existsSync(aPath) || !existsSync(cPath)) return null;
  try {
    const analysis = JSON.parse(readFileSync(aPath, "utf-8")) as CalibrationAnalysisJson;
    const conversion = JSON.parse(readFileSync(cPath, "utf-8")) as Record<string, unknown>;
    if (!analysis.nodeIssueSummaries || !analysis.ruleScores) return null;
    const label = dir.split(/[/\\]/).pop() ?? dir;
    return { dir, label, analysis, conversion };
  } catch {
    return null;
  }
}

function enabledRuleIds(): RuleId[] {
  return (Object.keys(RULE_CONFIGS) as RuleId[]).filter(
    (id) => RULE_CONFIGS[id]?.enabled !== false
  );
}

/**
 * Aggregates gap data and calibration snapshots from run directories into a markdown report.
 */
export function generateGapRuleReport(options: GapRuleReportOptions): GapRuleReportResult {
  const calibrationDir = resolve(options.calibrationDir);
  const minRepeat = options.minPatternRepeat;

  const runDirs = listRunDirs(calibrationDir);

  // Parse gaps from each run directory
  const parsed: ParsedGapFile[] = [];
  for (const dir of runDirs) {
    const gapsPath = join(dir, "gaps.json");
    if (!existsSync(gapsPath) || !statSync(gapsPath).isFile()) continue;
    const g = parseGapFile(dir, gapsPath);
    if (g && (g.gaps.length > 0 || g.newRuleSuggestions.length > 0)) parsed.push(g);
  }

  const allGaps = parsed.flatMap((f) => f.gaps);
  const fixtureKeys = [...new Set(parsed.map((p) => p.fixtureKey))];
  const totalFixtures = fixtureKeys.length;

  const byCategory = new Map<string, number>();
  for (const g of allGaps) {
    byCategory.set(g.category, (byCategory.get(g.category) ?? 0) + 1);
  }

  const patternMap = new Map<
    string,
    { count: number; fixtures: Set<string>; sample: string; category: string }
  >();
  for (const g of allGaps) {
    const key = patternKey(g);
    const cur = patternMap.get(key);
    if (cur) {
      cur.count++;
      cur.fixtures.add(g.fixtureKey);
    } else {
      patternMap.set(key, {
        count: 1,
        fixtures: new Set([g.fixtureKey]),
        sample: g.description.slice(0, 200),
        category: g.category,
      });
    }
  }

  const repeatingPatterns = [...patternMap.entries()]
    .filter(([, v]) => v.fixtures.size >= minRepeat)
    .sort((a, b) => b[1].fixtures.size - a[1].fixtures.size);

  const existingRuleMentions = new Map<string, Set<string>>();
  for (const g of allGaps) {
    if (g.existingRule) {
      let set = existingRuleMentions.get(g.existingRule);
      if (!set) {
        set = new Set();
        existingRuleMentions.set(g.existingRule, set);
      }
      set.add(g.fixtureKey);
    }
  }

  const notCoveredActionable = allGaps.filter((g) => !g.coveredByExistingRule && g.actionable);
  const suggestionCounts = new Map<string, { count: number; fixtures: Set<string> }>();
  for (const f of parsed) {
    for (const s of f.newRuleSuggestions) {
      const id = s.ruleId.trim();
      if (!id) continue;
      const cur = suggestionCounts.get(id);
      if (cur) {
        cur.count++;
        cur.fixtures.add(f.fixtureKey);
      } else {
        suggestionCounts.set(id, { count: 1, fixtures: new Set([f.fixtureKey]) });
      }
    }
  }

  // Load run snapshots for score-vs-impact analysis
  const runs: RunSnapshot[] = [];
  for (const dir of runDirs) {
    const snap = loadRunSnapshot(dir);
    if (snap) runs.push(snap);
  }

  const flaggedRules = new Set<string>();
  const overscoredRuns = new Map<string, Set<number>>();
  const underscoredRuns = new Map<string, Set<number>>();
  const validatedRuns = new Map<string, Set<number>>();

  for (let i = 0; i < runs.length; i++) {
    const snap = runs[i];
    if (!snap) continue;
    for (const n of snap.analysis.nodeIssueSummaries) {
      for (const id of n.flaggedRuleIds) {
        flaggedRules.add(id);
      }
    }

    const a = snap.analysis;
    const { evaluationOutput } = runCalibrationEvaluate(
      {
        nodeIssueSummaries: a.nodeIssueSummaries,
        scoreReport: a.scoreReport,
        fileKey: a.fileKey,
        fileName: a.fileName,
        analyzedAt: a.analyzedAt,
        nodeCount: a.nodeCount,
        issueCount: a.issueCount,
      },
      snap.conversion,
      a.ruleScores
    );

    const seenO = new Set<string>();
    const seenU = new Set<string>();
    const seenV = new Set<string>();
    for (const m of evaluationOutput.mismatches) {
      if (!m.ruleId) continue;
      if (m.type === "overscored") {
        if (!seenO.has(m.ruleId)) {
          seenO.add(m.ruleId);
          let s = overscoredRuns.get(m.ruleId);
          if (!s) {
            s = new Set();
            overscoredRuns.set(m.ruleId, s);
          }
          s.add(i);
        }
      } else if (m.type === "underscored") {
        if (!seenU.has(m.ruleId)) {
          seenU.add(m.ruleId);
          let s = underscoredRuns.get(m.ruleId);
          if (!s) {
            s = new Set();
            underscoredRuns.set(m.ruleId, s);
          }
          s.add(i);
        }
      } else if (m.type === "validated") {
        if (!seenV.has(m.ruleId)) {
          seenV.add(m.ruleId);
          let s = validatedRuns.get(m.ruleId);
          if (!s) {
            s = new Set();
            validatedRuns.set(m.ruleId, s);
          }
          s.add(i);
        }
      }
    }
  }

  const nRuns = runs.length;
  const neverFlagged = enabledRuleIds().filter((id) => !flaggedRules.has(id));

  // Similarity summary per run
  const similaritySummary: Array<{ label: string; similarity: number | undefined }> = [];
  for (const f of parsed) {
    const dirName = f.runDir.split(/[/\\]/).pop() ?? f.runDir;
    similaritySummary.push({ label: dirName, similarity: f.similarity });
  }

  const lines: string[] = [];
  lines.push("# Gap-based rule review");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Run directories scanned | ${runDirs.length} |`);
  lines.push(`| Runs with gap data | ${parsed.length} |`);
  lines.push(`| Runs with analysis+conversion | ${nRuns} |`);
  lines.push(`| Distinct fixtures (from gaps) | ${totalFixtures} |`);
  lines.push(`| Total gap entries | ${allGaps.length} |`);
  lines.push(`| Actionable gaps not covered by existing rule | ${notCoveredActionable.length} |`);
  lines.push("");

  if (similaritySummary.length > 0) {
    lines.push("## Similarity per run");
    lines.push("");
    lines.push("| Run | Similarity |");
    lines.push("| --- | --- |");
    for (const s of similaritySummary) {
      lines.push(`| ${s.label} | ${s.similarity != null ? `${s.similarity}%` : "N/A"} |`);
    }
    lines.push("");
  }

  lines.push("## Gaps by category");
  lines.push("");
  if (byCategory.size === 0) {
    lines.push("_No gap entries found._");
  } else {
    lines.push("| Category | Count |");
    lines.push("| --- | --- |");
    for (const [k, v] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`| ${k} | ${v} |`);
    }
  }
  lines.push("");

  lines.push(`## Repeating patterns (${minRepeat}+ fixtures)`);
  lines.push("");
  lines.push(
    "_Patterns use category + area/description. Review for **new rule** candidates when not covered by existing rules._"
  );
  lines.push("");
  if (repeatingPatterns.length === 0) {
    lines.push(`_No patterns appearing in at least ${minRepeat} distinct fixtures._`);
  } else {
    lines.push("| Pattern (category) | Fixtures | Sample |");
    lines.push("| --- | --- | --- |");
    for (const [, info] of repeatingPatterns) {
      const fx = [...info.fixtures].sort().join(", ");
      const safe = info.sample.replace(/\|/g, "\\|").replace(/\n/g, " ");
      lines.push(`| ${info.category} | ${info.fixtures.size} (${fx}) | ${safe} |`);
    }
  }
  lines.push("");

  lines.push("## Existing rules mentioned in gaps");
  lines.push("");
  lines.push("_When a gap is attributed to an existing rule, which fixtures reported it._");
  lines.push("");
  if (existingRuleMentions.size === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Rule ID | Fixture count | Fixtures |");
    lines.push("| --- | --- | --- |");
    for (const [ruleId, set] of [...existingRuleMentions.entries()].sort(
      (a, b) => b[1].size - a[1].size
    )) {
      const fx = [...set].sort().join(", ");
      lines.push(`| \`${ruleId}\` | ${set.size} | ${fx} |`);
    }
  }
  lines.push("");

  lines.push("## New rule candidates (from gap files)");
  lines.push("");
  const strongSuggestions = [...suggestionCounts.entries()].filter(
    ([, v]) => v.fixtures.size >= minRepeat
  );
  if (strongSuggestions.length === 0) {
    lines.push(`_No suggestion keys appearing in ${minRepeat}+ fixtures. Lower the threshold or add more gap data._`);
  } else {
    lines.push("| Candidate | Appearances | Fixtures |");
    lines.push("| --- | --- | --- |");
    for (const [id, v] of strongSuggestions.sort((a, b) => b[1].fixtures.size - a[1].fixtures.size)) {
      const fx = [...v.fixtures].sort().join(", ");
      lines.push(`| ${id} | ${v.count} | ${fx} |`);
    }
  }
  lines.push("");

  lines.push("## Rule score vs conversion impact (from run snapshots)");
  lines.push("");
  if (nRuns === 0) {
    lines.push(
      "_No runs with both `analysis.json` and `conversion.json`. Run calibration first to populate this section._"
    );
  } else {
    lines.push(
      "_Per run, `calibrate-evaluate`-style comparison: **overscored** means the rule penalty looks too harsh for actual impact; **underscored** means too lenient._"
    );
    lines.push("");
    lines.push(`| Rule ID | Overscored (runs) | Underscored (runs) | Validated (runs) |`);
    lines.push("| --- | --- | --- | --- |");
    const ruleIds = new Set<string>([
      ...overscoredRuns.keys(),
      ...underscoredRuns.keys(),
      ...validatedRuns.keys(),
    ]);
    for (const id of [...ruleIds].sort()) {
      const o = overscoredRuns.get(id)?.size ?? 0;
      const u = underscoredRuns.get(id)?.size ?? 0;
      const val = validatedRuns.get(id)?.size ?? 0;
      lines.push(`| \`${id}\` | ${o}/${nRuns} | ${u}/${nRuns} | ${val}/${nRuns} |`);
    }
    lines.push("");
    lines.push("**Heuristic:** many **overscored** rows with high similarity → consider lowering severity or score in `rule-config.ts`. Many **underscored** → consider raising.");
  }
  lines.push("");

  lines.push("## Enabled rules never flagged in any run");
  lines.push("");
  if (nRuns === 0) {
    lines.push("_Skipped (no run snapshots)._");
  } else if (neverFlagged.length === 0) {
    lines.push("_Every enabled rule was flagged at least once across runs._");
  } else {
    lines.push(
      `_These rules did not appear in \`flaggedRuleIds\` in any saved analysis. They may still be valuable for other designs._`
    );
    lines.push("");
    for (const id of neverFlagged) {
      lines.push(`- \`${id}\``);
    }
  }
  lines.push("");

  // Cross-run evidence from git-tracked files
  const calibrationEvidence = loadCalibrationEvidence();
  const calibrationEvidenceRules = Object.keys(calibrationEvidence);
  lines.push("## Cross-run calibration evidence (git-tracked)");
  lines.push("");
  if (calibrationEvidenceRules.length === 0) {
    lines.push("_No accumulated calibration evidence. Evidence is collected during `calibrate-evaluate --run-dir` runs._");
  } else {
    lines.push("_Evidence persisted in `data/calibration-evidence.json` across sessions. Pruned when Arbitrator applies score changes._");
    lines.push("");
    lines.push("| Rule ID | Overscored | Underscored |");
    lines.push("| --- | --- | --- |");
    for (const ruleId of calibrationEvidenceRules.sort()) {
      const ev = calibrationEvidence[ruleId];
      if (!ev) continue;
      lines.push(`| \`${ruleId}\` | ${ev.overscoredCount} | ${ev.underscoredCount} |`);
    }
  }
  lines.push("");

  lines.push("## Next step (manual)");
  lines.push("");
  lines.push(
    "Review this report. To add a new rule, implement it manually and re-run calibration for verification."
  );
  lines.push("");

  return {
    markdown: lines.join("\n"),
    runCount: nRuns,
    gapRunCount: parsed.length,
  };
}
