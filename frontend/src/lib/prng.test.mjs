import { describe, expect, test } from "bun:test";
import { createPRNG } from "./prng.js";

const sequence = (seed, length = 5) => {
  const random = createPRNG(seed);
  return Array.from({ length }, () => random());
};

describe("createPRNG", () => {
  test("reproduces the Mulberry32 reference sequence", () => {
    expect(sequence(42, 3)).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
    ]);
  });

  test.each([undefined, null, "", "not-a-number"])("uses seed 42 for %p", (seed) => {
    expect(sequence(seed)).toEqual(sequence(42));
  });

  test("is deterministic and separates different seeds", () => {
    expect(sequence(12345)).toEqual(sequence(12345));
    expect(sequence(12345)).not.toEqual(sequence(54321));
  });

  test("normalizes seeds to unsigned 32-bit values", () => {
    expect(sequence(0)).toEqual(sequence(2 ** 32));
    expect(sequence(-1)).toEqual(sequence(2 ** 32 - 1));
    expect(sequence("42")).toEqual(sequence(42));
  });

  test("always emits values in the half-open unit interval", () => {
    const values = sequence(987654321, 2_000);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(new Set(values).size).toBe(values.length);
  });
});
