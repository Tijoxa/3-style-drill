import assert from "node:assert";
import { createPRNG } from "./prng.js";

console.log("Running PRNG unit tests...");

// Test 1: Determinism with default seed 42
const rng1 = createPRNG(42);
const seq1 = [rng1(), rng1(), rng1(), rng1(), rng1()];

const rng2 = createPRNG(42);
const seq2 = [rng2(), rng2(), rng2(), rng2(), rng2()];

assert.deepStrictEqual(seq1, seq2, "PRNG output sequence with seed 42 must be identical");

// Test 2: Default fallback to 42 for undefined/null/empty/invalid
const rngDef1 = createPRNG(undefined);
const rngDef2 = createPRNG(null);
const rngDef3 = createPRNG("");
const seqDef1 = [rngDef1(), rngDef1()];
const seqDef2 = [rngDef2(), rngDef2()];
const seqDef3 = [rngDef3(), rngDef3()];

assert.deepStrictEqual(seqDef1, seq1.slice(0, 2), "Undefined seed must default to 42");
assert.deepStrictEqual(seqDef2, seq1.slice(0, 2), "Null seed must default to 42");
assert.deepStrictEqual(seqDef3, seq1.slice(0, 2), "Empty seed must default to 42");

// Test 3: Different seed produces different sequence
const rngDiff = createPRNG(12345);
const seqDiff = [rngDiff(), rngDiff(), rngDiff(), rngDiff(), rngDiff()];
assert.notDeepStrictEqual(seq1, seqDiff, "Different seeds should produce different sequences");

// Test 4: All numbers in [0, 1)
for (let i = 0; i < 1000; i++) {
  const v = rng1();
  assert(v >= 0 && v < 1, `Value ${v} outside [0, 1)`);
}

console.log("All PRNG unit tests passed!");
