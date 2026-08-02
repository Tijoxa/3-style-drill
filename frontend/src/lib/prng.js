// Mulberry32 deterministic 32-bit pseudo-random number generator
export function createPRNG(seed) {
  let s = (seed === undefined || seed === null || seed === "" || isNaN(Number(seed)) ? 42 : Number(seed)) >>> 0;
  return function() {
    let t = (s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
