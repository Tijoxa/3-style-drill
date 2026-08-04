import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  caseWeight,
  loadStore,
  pickWeightedPair,
  recordReview,
  resetStore,
  saveStore,
} from "./fsrs.js";

const originalLocalStorage = globalThis.localStorage;
let values;

beforeEach(() => {
  values = new Map();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
});

afterEach(() => {
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
});

const emptyStore = () => ({ cards: {}, ema: {}, emaCount: {} });

describe("FSRS persistence", () => {
  test("loads a clean store when persistence is empty or malformed", () => {
    expect(loadStore()).toEqual(emptyStore());
    values.set("bld3style_fsrs_v1", "not-json");
    expect(loadStore()).toEqual(emptyStore());
  });

  test("saves, restores, and resets scheduler state", () => {
    const store = emptyStore();
    recordReview(store, "case-a", "corner", 1_000, 10_000);
    saveStore(store);

    expect(loadStore()).toEqual(store);
    resetStore(store);
    expect(store).toEqual(emptyStore());
    expect(loadStore()).toEqual(emptyStore());
  });
});

describe("FSRS review scheduling", () => {
  test("creates a card and updates rolling solve-time statistics", () => {
    const store = emptyStore();
    const result = recordReview(store, "case-a", "corner", 1_200, 60_000);

    expect(result).toBe(store);
    expect(store.cards["case-a"]).toMatchObject({ last: 60_000, reps: 1 });
    expect(store.cards["case-a"].S).toBeGreaterThan(0);
    expect(store.cards["case-a"].D).toBeWithin(1, 10);
    expect(store.ema.corner).toBe(1_200);
    expect(store.emaCount.corner).toBe(1);
  });

  test("grades later reviews relative to the prior rolling average", () => {
    const fast = emptyStore();
    const slow = emptyStore();
    for (const store of [fast, slow]) {
      recordReview(store, "case-a", "corner", 1_000, 0);
      recordReview(store, "case-a", "corner", 1_000, 60_000);
      recordReview(store, "case-a", "corner", 1_000, 120_000);
    }
    const fastDifficulty = fast.cards["case-a"].D;
    const slowDifficulty = slow.cards["case-a"].D;

    recordReview(fast, "case-a", "corner", 500, 180_000);
    recordReview(slow, "case-a", "corner", 2_000, 180_000);

    expect(fast.cards["case-a"].D).toBeLessThan(fastDifficulty);
    expect(slow.cards["case-a"].D).toBeGreaterThan(slowDifficulty);
    expect(fast.cards["case-a"].reps).toBe(4);
    expect(slow.cards["case-a"].reps).toBe(4);
  });

  test("assigns maximum urgency to new cards and increasing urgency over time", () => {
    const store = emptyStore();
    recordReview(store, "seen", "edge", 900, 1_000_000);

    expect(caseWeight(store, "new", 1_000_000)).toBe(1);
    expect(caseWeight(store, "seen", 1_000_000)).toBe(0.05);
    expect(caseWeight(store, "seen", 61_000_000)).toBeGreaterThan(0.05);
    expect(caseWeight(store, "seen", 61_000_000)).toBeLessThanOrEqual(1);
  });

  test("selects pairs using their weighted intervals", () => {
    const store = emptyStore();
    recordReview(store, "seen", "edge", 900, 1_000_000);
    const random = spyOn(Math, "random");

    random.mockReturnValue(0);
    expect(pickWeightedPair(["seen", "new"], (key) => key, store, 1_000_000)).toBe("seen");
    random.mockReturnValue(0.99);
    expect(pickWeightedPair(["seen", "new"], (key) => key, store, 1_000_000)).toBe("new");

    random.mockRestore();
  });
});
