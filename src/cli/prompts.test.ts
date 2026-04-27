import { Writable } from "node:stream";

import { vi } from "vitest";

const createInterface = vi.hoisted(() => vi.fn());
vi.mock("node:readline/promises", () => ({ createInterface }));

import { maskFigmaToken, NonInteractiveError, promptForFigmaToken } from "./prompts.js";

function sinkOutput(): { stream: NodeJS.WritableStream; chunks: string[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(chunk.toString());
      cb();
    },
  });
  return { stream, chunks };
}

function makeRl(answers: string[]): { question: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> } {
  const queue = [...answers];
  const question = vi.fn().mockImplementation(async () => {
    if (queue.length === 0) {
      throw new Error("No more queued answers");
    }
    return queue.shift()!;
  });
  const close = vi.fn();
  return { question, close };
}

beforeEach(() => {
  createInterface.mockReset();
});

describe("promptForFigmaToken", () => {
  it("reads a trimmed token from injected input", async () => {
    const rl = makeRl(["  figd_abc123  "]);
    createInterface.mockReturnValue(rl);
    const { stream: output } = sinkOutput();
    const token = await promptForFigmaToken({ output, isTTY: true });
    expect(token).toBe("figd_abc123");
    expect(rl.close).toHaveBeenCalled();
  });

  it("re-prompts when input is empty, then returns the next non-empty value", async () => {
    const rl = makeRl(["", "   ", "figd_ok"]);
    createInterface.mockReturnValue(rl);
    const { stream: output, chunks } = sinkOutput();
    const token = await promptForFigmaToken({ output, isTTY: true, maxAttempts: 3 });
    expect(token).toBe("figd_ok");
    expect(chunks.join("")).toContain("Token cannot be empty");
    expect(rl.question).toHaveBeenCalledTimes(3);
  });

  it("throws after maxAttempts of empty input", async () => {
    const rl = makeRl(["", "", ""]);
    createInterface.mockReturnValue(rl);
    const { stream: output } = sinkOutput();
    await expect(
      promptForFigmaToken({ output, isTTY: true, maxAttempts: 3 }),
    ).rejects.toThrow(/No token provided/);
    expect(rl.close).toHaveBeenCalled();
  });

  it("throws NonInteractiveError when isTTY is false (without opening readline)", async () => {
    const { stream: output } = sinkOutput();
    await expect(
      promptForFigmaToken({ output, isTTY: false }),
    ).rejects.toBeInstanceOf(NonInteractiveError);
    expect(createInterface).not.toHaveBeenCalled();
  });
});

describe("maskFigmaToken", () => {
  it("masks a figd_ token preserving prefix and last 4 chars", () => {
    expect(maskFigmaToken("figd_abcdefgh1234")).toBe("figd_••••••••1234");
  });

  it("masks a generic long token with last 4 chars", () => {
    expect(maskFigmaToken("0123456789abcd")).toBe("••••••••abcd");
  });

  it("returns bullets only for short tokens (< 4 chars)", () => {
    expect(maskFigmaToken("abc")).toBe("•••");
  });

  it("returns (empty) for undefined", () => {
    expect(maskFigmaToken(undefined)).toBe("(empty)");
  });

  it("returns (empty) for empty string", () => {
    expect(maskFigmaToken("")).toBe("(empty)");
  });

  it("masks figd_ token shorter than 10 chars as a generic token (no prefix branch)", () => {
    // length 6 — fails `> 9` check, falls through to the >= 4 branch
    expect(maskFigmaToken("figd_x")).toBe("••••••••gd_x");
  });
});
