import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { compareScreenshots } from "../src/core/engine/visual-compare-helpers.js";
import { PNG } from "pngjs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";

const RUN_DIR = "logs/ablation/mcp-vite-all--2026-03-27";
const MCP_DIR = "/Users/minseon/.claude/projects/-Users-minseon-Code-design-readiness-checker/0734b7d3-2c51-4bf7-8987-5f57b082c269/tool-results";
const RENDERER = "/tmp/mcp-renderer";
const MIME: Record<string,string> = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css" };

const FIXTURES: Record<string,string> = {
  "good": "toolu_0165iWatHVLaTDvd6f2wp22X.json",
  "bad-structure": "toolu_012ivUDTrt8LL1VTaMrUkjDi.json",
  "bad-token": "toolu_01UvfcnRHzCB3QkB3Tc5jNPT.json",
  "bad-component": "toolu_01AgEgZpsHHnxDc5X6xpRUep.json",
  "bad-naming": "toolu_01K3zymEqhMtFZuMj4pSZeKa.json",
  "bad-behavior": "toolu_01WktrAEaSYQfomrjU6sYDxY.json",
};

function extractCode(path: string): string {
  const data = JSON.parse(readFileSync(path, "utf-8"));
  let code = "";
  for (const b of data) { if (b.type === "text") code += b.text; }
  const idx = code.indexOf("SUPER CRITICAL");
  if (idx > 0) { code = code.substring(0, idx); const lb = code.lastIndexOf("}"); if (lb > 0) code = code.substring(0, lb+1); }
  return code.trim();
}

async function run(name: string, code: string): Promise<number> {
  console.error(`\n=== ${name} ===`);
  
  // Check if code has export default already
  const hasDefault = code.includes("export default");
  let appCode: string;
  
  if (hasDefault) {
    // Code already exports default, use it directly
    appCode = `import './index.css'\n\n${code}\n`;
  } else {
    // Find last function or arrow component name
    const functionMatches = [...code.matchAll(/function\s+(\w+)/g)];
    const arrowMatches = [...code.matchAll(/const\s+(\w+)(?:\s*:\s*[^=]+)?\s*=\s*(?:\([^)]*\)|\w+)\s*=>/g)];
    const rootName = functionMatches[functionMatches.length-1]?.[1] ?? arrowMatches[arrowMatches.length-1]?.[1] ?? "Component";
    appCode = `import './index.css'\n\n${code}\n\nexport default function App() {\n  return <${rootName} />\n}\n`;
  }
  
  writeFileSync(join(RENDERER, "src/App.tsx"), appCode);
  
  try {
    execSync("npx vite build", { cwd: RENDERER, stdio: "pipe", timeout: 30000 });
  } catch (e: any) {
    console.error(`  Build FAILED`);
    return -1;
  }
  
  const figmaScreenshot = resolve(`fixtures/ablation-large-${name}/screenshot.png`);
  const figmaPng = PNG.sync.read(readFileSync(figmaScreenshot));
  const s = 2, w = Math.round(figmaPng.width/s), h = Math.round(figmaPng.height/s);
  
  const port = 4200 + Math.floor(Math.random()*100);
  const srv = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const fp = join(RENDERER, "dist", req.url === "/" ? "index.html" : req.url!);
    try { const d = await readFile(fp); res.writeHead(200, {"Content-Type": MIME[extname(fp)]||"application/octet-stream"}); res.end(d); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise<void>(r => srv.listen(port, r));
  
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{width:w,height:h}, deviceScaleFactor:s });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:${port}`, { waitUntil:"networkidle", timeout:30000 });
  await page.waitForTimeout(2000);
  
  const vcDir = join(RUN_DIR, `vc-${name}`);
  mkdirSync(vcDir, { recursive: true });
  const codePng = join(vcDir, "code.png");
  const root = page.locator("#root > *:first-child");
  if (await root.count() > 0 && await root.isVisible()) await root.screenshot({ path: codePng });
  else await page.screenshot({ path: codePng, fullPage: true });
  
  await browser.close();
  srv.close();
  
  copyFileSync(figmaScreenshot, join(vcDir, "figma.png"));
  const result = compareScreenshots(join(vcDir, "figma.png"), codePng, join(vcDir, "diff.png"));
  console.error(`  similarity: ${result.similarity}%`);
  return result.similarity;
}

async function main() {
  mkdirSync(RUN_DIR, { recursive: true });
  const results: Record<string,number> = {};
  
  for (const [name, file] of Object.entries(FIXTURES)) {
    const code = extractCode(join(MCP_DIR, file));
    results[name] = await run(name, code);
  }
  
  const dt: Record<string,number> = { good:94, "bad-structure":84, "bad-token":90, "bad-component":91, "bad-naming":94, "bad-behavior":94 };
  const raw: Record<string,number> = { good:78, "bad-structure":3, "bad-token":69, "bad-component":66, "bad-naming":78, "bad-behavior":80 };
  
  console.error("\n=== 3-way comparison ===");
  console.error("| Fixture | MCP Vite | design-tree | figma-raw |");
  console.error("|---|---|---|---|");
  for (const name of Object.keys(FIXTURES)) {
    console.error(`| ${name} | ${results[name]}% | ${dt[name]}% | ${raw[name]}% |`);
  }
  
  writeFileSync(join(RUN_DIR, "results.json"), JSON.stringify(results, null, 2));
}
main();
