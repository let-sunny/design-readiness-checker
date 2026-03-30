import { stripDeltaToDifficulty } from "./delta.js";

describe("stripDeltaToDifficulty", () => {
  it("maps delta ≤ 5 to easy", () => {
    expect(stripDeltaToDifficulty(-10)).toBe("easy"); // stripped better than baseline
    expect(stripDeltaToDifficulty(0)).toBe("easy");
    expect(stripDeltaToDifficulty(3)).toBe("easy");
    expect(stripDeltaToDifficulty(5)).toBe("easy");
  });

  it("maps delta 6-15 to moderate", () => {
    expect(stripDeltaToDifficulty(6)).toBe("moderate");
    expect(stripDeltaToDifficulty(10)).toBe("moderate");
    expect(stripDeltaToDifficulty(15)).toBe("moderate");
  });

  it("maps delta 16-30 to hard", () => {
    expect(stripDeltaToDifficulty(16)).toBe("hard");
    expect(stripDeltaToDifficulty(25)).toBe("hard");
    expect(stripDeltaToDifficulty(30)).toBe("hard");
  });

  it("maps delta > 30 to failed", () => {
    expect(stripDeltaToDifficulty(31)).toBe("failed");
    expect(stripDeltaToDifficulty(50)).toBe("failed");
    expect(stripDeltaToDifficulty(100)).toBe("failed");
  });

  it("throws on NaN", () => {
    expect(() => stripDeltaToDifficulty(NaN)).toThrow(TypeError);
  });

  it("throws on Infinity", () => {
    expect(() => stripDeltaToDifficulty(Infinity)).toThrow(TypeError);
    expect(() => stripDeltaToDifficulty(-Infinity)).toThrow(TypeError);
  });
});
