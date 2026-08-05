import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { SCHEMES } from "./cube.mjs";
import {
  BLDDB_FETCH_TIMEOUT_MS,
  fetchCaseHints,
  fetchHints,
  loadCategoryCases,
} from "./blddb.js";

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
}

beforeEach(() => {
  globalThis.localStorage = memoryStorage();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
  if (originalLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalLocalStorage;
});

describe("BLDDB category loading", () => {
  test("returns an empty pool for unsupported categories without fetching", async () => {
    let calls = 0;
    globalThis.fetch = async () => { calls++; };

    expect(await loadCategoryCases("unsupported")).toEqual({});
    expect(calls).toBe(0);
  });

  test("loads selected cases, caches them, and builds nightmare hints", async () => {
    const fixtures = {
      flipsNightmareSelected: { BD: "R U R'" },
      flipsNightmare: { BD: ["R U R'", "U R U'"] },
    };
    globalThis.fetch = async (url) => {
      const name = new URL(url).pathname.split("/").pop().replace(".json", "");
      return new Response(JSON.stringify(fixtures[name]), { status: fixtures[name] ? 200 : 404 });
    };

    expect(await loadCategoryCases("flips")).toEqual({ BD: "R U R'" });
    expect(JSON.parse(localStorage.getItem("blddb_cache_v2_flipsNightmareSelected"))).toEqual(fixtures.flipsNightmareSelected);

    const hints = await fetchCaseHints({ category: "flips", key: "BD", style: "nightmare" });
    expect(hints.notFound).toBeFalse();
    expect(hints.recommended).toBe("R U R'");
    expect(hints.list.map(({ alg }) => alg)).toEqual(["R U R'", "U R U'"]);
    expect(JSON.parse(localStorage.getItem("blddb_cache_v2_flipsNightmare"))).toEqual(fixtures.flipsNightmare);
  });

  test("normalizes list-backed categories into flat case pools", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({
      JAE: ["R U"],
      DAM: "F R",
    }), { status: 200 });

    expect(await loadCategoryCases("t2c")).toEqual({ JAE: "R U", DAM: "F R" });
  });

  test("falls back to a persisted cache when the network is unavailable", async () => {
    globalThis.localStorage = memoryStorage({
      blddb_cache_v2_parityNightmareSelected: JSON.stringify({ GAJA: "R2 U2" }),
    });
    globalThis.fetch = async () => { throw new Error("offline"); };

    expect(await loadCategoryCases("parity")).toEqual({ GAJA: "R2 U2" });
  });

  test("serves algorithm hints from localStorage while offline", async () => {
    globalThis.localStorage = memoryStorage({
      blddb_cache_v2_edgeNightmareSelected: JSON.stringify({ AET: "R U R'" }),
      blddb_cache_v2_edgeNightmare: JSON.stringify({ AET: ["R U R'", "U R U'"] }),
    });
    globalThis.fetch = async () => { throw new Error("offline"); };

    const hints = await fetchHints({
      type: "edge",
      buffer: "c",
      t1: "a",
      t2: "f",
      style: "nightmare",
      maps: SCHEMES.speffz,
    });

    expect(hints.notFound).toBeFalse();
    expect(hints.key).toBe("AET");
    expect(hints.recommended).toBe("R U R'");
    expect(hints.list.map(({ alg }) => alg)).toEqual(["R U R'", "U R U'"]);
  });

  test("falls back to cached cases after a five-second request timeout", async () => {
    globalThis.localStorage = memoryStorage({
      blddb_cache_v2_twistsNightmare: JSON.stringify({ JPR: ["R2 U2"] }),
    });
    let requestSignal;
    globalThis.fetch = async (_url, { signal }) => {
      requestSignal = signal;
      return await new Promise((_, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    jest.useFakeTimers();

    const casesPromise = loadCategoryCases("twists");
    await Promise.resolve();
    jest.advanceTimersByTime(BLDDB_FETCH_TIMEOUT_MS - 1);
    expect(requestSignal.aborted).toBeFalse();

    jest.advanceTimersByTime(1);
    expect(await casesPromise).toEqual({ JPR: "R2 U2" });
    expect(requestSignal.aborted).toBeTrue();
  });

  test("preserves the network error when localStorage is unavailable", async () => {
    delete globalThis.localStorage;
    globalThis.fetch = async () => { throw new Error("offline"); };

    await expect(fetchHints({
      type: "corner",
      buffer: "C",
      t1: "A",
      t2: "F",
      style: "manmade",
      maps: SCHEMES.speffz,
    })).rejects.toThrow("offline");
  });
});
