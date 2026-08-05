import { describe, expect, test } from "bun:test";
import { commutator, expand } from "./commutator.js";

describe("commutator notation", () => {
  test.each([
    ["[R,U]", "R U R' U'"],
    ["[R:U]", "R U R'"],
    ["[R U R',D']", "R U R' D' R U' R' D"],
  ])("expands %s", (notation, algorithm) => {
    expect(expand(notation)).toBe(algorithm);
  });

  test("recognizes a pure commutator", () => {
    expect(commutator("R U R' D' R U' R' D")).toBe("[R U R',D']");
  });

  test("reports algorithms with no commutator representation", () => {
    expect(commutator("R U R'")).toBe("Not found.");
  });

  test("normalizes typography and redundant moves", () => {
    expect(expand("[R R, U]")).toBe("R2 U R2 U'");
    expect(expand("[R，U]")).toBe("R U R' U'");
  });
});
