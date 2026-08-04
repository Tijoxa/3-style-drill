import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fetchCaseHints, loadCategoryCases } from "./blddb.js";

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

  test("preserves the network error when localStorage is unavailable", async () => {
    delete globalThis.localStorage;
    globalThis.fetch = async () => { throw new Error("offline"); };

    await expect(loadCategoryCases("twists")).rejects.toThrow("offline");
  });
});
