#!/usr/bin/env tsx
/**
 * Verifies server.json (MCP registry manifest) is in sync with package.json
 * and the rule registry. Prevents stale metadata from reaching the registry
 * (see #476).
 *
 * Checks:
 * 1. server.json `version` matches package.json `version`
 * 2. server.json `packages[0].version` matches package.json `version`
 * 3. server.json `description` rule count matches RULE_ID_CATEGORY entry count
 *
 * Run via: pnpm check:server-json
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RULE_ID_CATEGORY } from "../src/core/rules/rule-config.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface PackageJson {
  version: string;
}

interface ServerJson {
  description: string;
  version: string;
  packages: Array<{ version: string }>;
}

const pkg = JSON.parse(
  readFileSync(resolve(repoRoot, "package.json"), "utf8")
) as PackageJson;

const server = JSON.parse(
  readFileSync(resolve(repoRoot, "server.json"), "utf8")
) as ServerJson;

const expectedRuleCount = Object.keys(RULE_ID_CATEGORY).length;

const errors: string[] = [];

if (server.version !== pkg.version) {
  errors.push(
    `server.json version "${server.version}" !== package.json version "${pkg.version}"`
  );
}

const packageVersion = server.packages[0]?.version;
if (packageVersion !== pkg.version) {
  errors.push(
    `server.json packages[0].version "${packageVersion}" !== package.json version "${pkg.version}"`
  );
}

const ruleCountMatch = server.description.match(/(\d+)\s+rules/i);
if (!ruleCountMatch) {
  errors.push(
    `server.json description does not contain "<N> rules" — got: ${server.description}`
  );
} else {
  const claimedCount = Number(ruleCountMatch[1]);
  if (claimedCount !== expectedRuleCount) {
    errors.push(
      `server.json description claims ${claimedCount} rules, but rule-config.ts has ${expectedRuleCount}`
    );
  }
}

if (errors.length > 0) {
  console.error("server.json is out of sync:");
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  console.error(
    "\nUpdate server.json to match package.json + rule-config.ts, then re-run."
  );
  process.exit(1);
}

console.log(
  `server.json is in sync (version ${pkg.version}, ${expectedRuleCount} rules)`
);
