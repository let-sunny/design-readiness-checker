import * as readline from "node:readline/promises";

/**
 * Thrown by `promptForFigmaToken` when stdin is not a TTY.
 *
 * Callers pattern-match on this so each command can choose its own non-TTY
 * fallback (init prints the setup guide; config set-token prints a CI hint).
 */
export class NonInteractiveError extends Error {
  constructor(message = "Interactive prompt requires a TTY") {
    super(message);
    this.name = "NonInteractiveError";
  }
}

interface PromptOpts {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
  isTTY?: boolean;
  maxAttempts?: number;
}

/**
 * Read a Figma token interactively from stdin.
 *
 * Input is echoed (Node readline does not expose hidden-input cleanly without
 * a third-party dep). For sensitive workflows use `--token` or `FIGMA_TOKEN=…`.
 */
export async function promptForFigmaToken(opts: PromptOpts = {}): Promise<string> {
  const isTTY = opts.isTTY ?? process.stdin.isTTY ?? false;
  if (!isTTY) {
    throw new NonInteractiveError();
  }

  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const maxAttempts = opts.maxAttempts ?? 3;

  // Let readline auto-detect terminal mode from output.isTTY — real CLI use
  // gets line-editing; tests with PassThrough streams parse line-by-line.
  const rl = readline.createInterface({ input, output });
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const answer = (await rl.question("Figma token: ")).trim();
      if (answer.length > 0) {
        return answer;
      }
      if (attempt < maxAttempts) {
        output.write("Token cannot be empty. Try again.\n");
      }
    }
    throw new Error(`No token provided after ${maxAttempts} attempts`);
  } finally {
    rl.close();
  }
}

/**
 * Mask a Figma token for display: `figd_••••••••1234`.
 *
 * Preserves the `figd_` prefix when present so users can tell at a glance the
 * stored value looks like a Figma personal access token.
 */
export function maskFigmaToken(token: string | undefined): string {
  if (!token) return "(empty)";

  const BULLETS = "••••••••";
  if (token.startsWith("figd_") && token.length > 9) {
    return `figd_${BULLETS}${token.slice(-4)}`;
  }
  if (token.length >= 4) {
    return `${BULLETS}${token.slice(-4)}`;
  }
  return "•".repeat(token.length);
}
