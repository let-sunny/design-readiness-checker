#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import cac from "cac";

import { FigmaClient } from "../adapters/figma-client.js";
import { loadFigmaFileFromJson } from "../adapters/figma-file-loader.js";
import { transformFigmaResponse } from "../adapters/figma-transformer.js";
import { parseFigmaUrl } from "../adapters/figma-url-parser.js";
import type { AnalysisFile } from "../contracts/figma-node.js";
import { analyzeFile } from "../core/rule-engine.js";
import { calculateScores, formatScoreSummary } from "../core/scoring.js";
import { getConfigsWithPreset, type Preset } from "../rules/rule-config.js";
import { generateHtmlReport } from "../report-html/index.js";

// Import rules to register them
import "../rules/index.js";

const cli = cac("drc");

interface AnalyzeOptions {
  preset?: Preset;
  output?: string;
  token?: string;
}

function isFigmaUrl(input: string): boolean {
  return input.includes("figma.com/");
}

function isJsonFile(input: string): boolean {
  return input.endsWith(".json");
}

async function loadFile(
  input: string,
  token?: string
): Promise<AnalysisFile> {
  if (isJsonFile(input)) {
    // Load from JSON fixture
    const filePath = resolve(input);
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }
    console.log(`Loading from JSON: ${filePath}`);
    return loadFigmaFileFromJson(filePath);
  }

  if (isFigmaUrl(input)) {
    // Fetch from Figma API
    const { fileKey } = parseFigmaUrl(input);
    console.log(`Fetching from Figma API: ${fileKey}`);

    const figmaToken = token ?? process.env["FIGMA_TOKEN"];
    if (!figmaToken) {
      throw new Error(
        "Figma token required. Provide --token or set FIGMA_TOKEN environment variable."
      );
    }

    const client = new FigmaClient({ token: figmaToken });
    const response = await client.getFile(fileKey);
    return transformFigmaResponse(fileKey, response);
  }

  throw new Error(
    `Invalid input: ${input}. Provide a Figma URL or JSON file path.`
  );
}

cli
  .command("analyze <input>", "Analyze a Figma file or JSON fixture")
  .option("--preset <preset>", "Analysis preset (relaxed | dev-friendly | ai-ready | strict)")
  .option("--output <path>", "HTML report output path")
  .option("--token <token>", "Figma API token (or use FIGMA_TOKEN env var)")
  .example("  drc analyze https://www.figma.com/design/ABC123/MyDesign")
  .example("  drc analyze ./fixtures/design.json --output report.html")
  .example("  drc analyze ./fixtures/design.json --preset strict")
  .action(async (input: string, options: AnalyzeOptions) => {
    try {
      // Load file
      const file = await loadFile(input, options.token);
      console.log(`\nAnalyzing: ${file.name}`);
      console.log(`Nodes: analyzing...`);

      // Run analysis with preset if specified
      const result = options.preset
        ? analyzeFile(file, { configs: getConfigsWithPreset(options.preset) })
        : analyzeFile(file);
      console.log(`Nodes: ${result.nodeCount} (max depth: ${result.maxDepth})`);

      // Calculate scores
      const scores = calculateScores(result);

      // Print summary to terminal
      console.log("\n" + "=".repeat(50));
      console.log(formatScoreSummary(scores));
      console.log("=".repeat(50));

      // Generate HTML report if output specified
      if (options.output) {
        const outputPath = resolve(options.output);
        const html = generateHtmlReport(file, result, scores);
        await writeFile(outputPath, html, "utf-8");
        console.log(`\nReport saved: ${outputPath}`);
      }

      // Exit with error code if grade is F
      if (scores.overall.grade === "F") {
        process.exit(1);
      }
    } catch (error) {
      console.error(
        "\nError:",
        error instanceof Error ? error.message : String(error)
      );
      process.exit(1);
    }
  });

cli.help();
cli.version("0.1.0");

cli.parse();
