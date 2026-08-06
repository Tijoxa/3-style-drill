// Fetches 3-style commutator algorithms live from v2.blddb.net (CORS-enabled).
// v2 stores flat dictionaries keyed by the 3-letter case code (buffer+t1+t2),
// e.g. { "ADM": "U' R' D R U' R' D' R U2" }. We fetch fresh per session and keep
// a localStorage fallback for offline use.
import { blddbCode, caseKeyToPositions } from "./cube.mjs";
import { commutator } from "./commutator.js";

const BASE = "https://v2.blddb.net/data/";
const CACHE_PREFIX = "blddb_cache_v2_";
export const BLDDB_FETCH_TIMEOUT_MS = 3_000;
const mem = new Map();

const scopedKey = (scope, name) => `${scope}:${name}`;
const storageKey = (scope, name) => `${CACHE_PREFIX}${scopedKey(scope, name)}`;

async function loadFile(name, scope) {
  const key = scopedKey(scope, name);
  if (mem.has(key)) return mem.get(key);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BLDDB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${name}.json`, {
      cache: "no-cache",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mem.set(key, data);
    try { localStorage.setItem(storageKey(scope, name), JSON.stringify(data)); } catch { }
    return data;
  } catch (e) {
    let cached = null;
    try {
      const stored = localStorage.getItem(storageKey(scope, name));
      if (stored) cached = JSON.parse(stored);
    } catch { }
    if (cached) { mem.set(key, cached); return cached; }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// style -> which v2 json files provide the data.
// nightmare: `rec` = recommended (Selected) flat dict, `list` = all variants.
// manmade: `manmade` = nested [ [ [algs], [sources], [commutators] ], ... ].
const STYLE_FILES = {
  corner: {
    nightmare: { rec: "cornerNightmareSelected", list: "cornerNightmare" },
    manmade: { manmade: "cornerManmade" },
  },
  edge: {
    nightmare: { rec: "edgeNightmareSelected", list: "edgeNightmare" },
    manmade: { manmade: "edgeManmade" },
  },
};

export const STYLE_OPTIONS = {
  corner: [
    ["nightmare", "Nightmare"],
    ["manmade", "Manmade"],
  ],
  edge: [
    ["nightmare", "Nightmare"],
    ["manmade", "Manmade"],
  ],
};

function comm(alg) {
  try {
    const c = commutator(alg);
    if (!c || c === "Not found.") return null;
    return c;
  } catch { return null; }
}

// Resolve author names into { name, url } using the shared sourceToUrl map.
function resolveSources(names, type, srcUrls) {
  return (names || []).map((name) => ({
    name,
    url: (srcUrls && srcUrls[name] && srcUrls[name][type]) || null,
  }));
}

// Flip datasets use two different sticker-code conventions. Nightmare keys identify
// the displayed stickers (e.g. JT for Speffz KF), while Manmade may identify the same
// physical edge pieces with different stickers (e.g. SI). Match flips by cubie identity.
function flipCaseIdentity(codeKey) {
  const positions = caseKeyToPositions(codeKey, "flips");
  if (positions.length !== 2 || positions.some((position) => typeof position !== "string" || position.length !== 2)) return null;
  return positions
    .map((position) => [...position].sort().join(""))
    .sort()
    .join(":");
}

function categoryEntryKey(map, key, category) {
  if (Object.prototype.hasOwnProperty.call(map, key)) return key;
  if (category !== "flips") return null;
  const identity = flipCaseIdentity(key);
  if (!identity) return null;
  return Object.keys(map).find((candidate) => flipCaseIdentity(candidate) === identity) || null;
}

// Returns { notFound, key, style, recommended, recCommutator, recSources, list }
// where list = [{ alg, commutator, sources? }]. Commutator is prioritized: for
// manmade it comes from the database, for nightmare it is derived from the alg.
export async function fetchHints({ type, buffer, t1, t2, style, maps }) {
  const bc = blddbCode(buffer, type, maps);
  const c1 = blddbCode(t1, type, maps);
  const c2 = blddbCode(t2, type, maps);
  const styles = STYLE_FILES[type] || STYLE_FILES.corner;
  const cfg = styles[style] || styles.nightmare;
  const scope = `pair:${type}`;
  if (!bc || !c1 || !c2) return { notFound: true, key: null, style };

  const key = `${bc}${c1}${c2}`;

  if (cfg.manmade) {
    const map = await loadFile(cfg.manmade, scope);
    const entry = map[key];
    if (!entry || !entry.length) return { notFound: true, key, style };
    const srcUrls = await loadFile("sourceToUrl", scope).catch(() => ({}));
    const list = entry.map((e) => {
      const algs = e[0] || [];
      const sources = resolveSources(e[1], type, srcUrls);
      const comms = e[2] || [];
      const alg = algs[0] || "";
      return { alg, variations: algs, commutator: comms[0] || comm(alg), sources };
    });
    const first = list[0] || null;
    return {
      notFound: false, key, style,
      recommended: first ? first.alg : null,
      recCommutator: first ? first.commutator : null,
      recSources: first ? first.sources : [],
      list,
    };
  }

  // nightmare
  const recMap = await loadFile(cfg.rec, scope);
  const recommended = recMap[key];
  if (!recommended) return { notFound: true, key, style };
  const listMap = await loadFile(cfg.list, scope).catch(() => ({}));
  const algs = (listMap[key] && listMap[key].length) ? listMap[key] : [recommended];
  const list = algs.map((a) => ({ alg: a, commutator: comm(a) }));
  return {
    notFound: false, key, style,
    recommended,
    recCommutator: comm(recommended),
    recSources: [],
    list,
  };
}

// ============================================================================
// Extra 3-BLD categories: edge flips, corner twists, parity, LTCT & T2C.
// Cases are keyed by blddb code (e.g. flips "BD", twists "JPR", parity "GAJA",
// ltct "ADK"). The recommended (nightmare) algorithm defines each case for the
// drill; hints reuse the nightmare/manmade files like corners/edges.
// ============================================================================
const CATEGORY_FILES = {
  flips: { selected: "flipsNightmareSelected", nightmare: "flipsNightmare", manmade: "flipsManmade" },
  twists: { nightmare: "twistsNightmare", manmade: "twistsManmade" },
  parity: { selected: "parityNightmareSelected", nightmare: "parityNightmare", manmade: "parityManmade" },
  ltct: { nightmare: "ltctNightmare", manmade: "ltctManmade" },
  t2c: { nightmare: "ltctNightmare", manmade: "ltctManmade" },
};

export const CATEGORY_STYLE_OPTIONS = [
  ["nightmare", "Nightmare"],
  ["manmade", "Manmade"],
];

// Recommended alg per case key (drives the drill + case pool). Uses nightmare data.
// Returns a flat dict { key: algString }.
export async function loadCategoryCases(category) {
  const cfg = CATEGORY_FILES[category];
  if (!cfg) return {};
  const scope = `category:${category}`;
  if (cfg.selected) return await loadFile(cfg.selected, scope); // flat { key: alg }
  const map = await loadFile(cfg.nightmare, scope);             // { key: [algs] }
  const out = {};
  for (const k in map) { const v = map[k]; out[k] = Array.isArray(v) ? v[0] : v; }
  return out;
}

// Hints for one category case key (same shape as fetchHints).
export async function fetchCaseHints({ category, key, style }) {
  const cfg = CATEGORY_FILES[category];
  if (!cfg || !key) return { notFound: true, key, style };
  const scope = `category:${category}`;

  if (style === "manmade" && cfg.manmade) {
    const map = await loadFile(cfg.manmade, scope);
    const entryKey = categoryEntryKey(map, key, category);
    const entry = entryKey ? map[entryKey] : null;
    if (!entry || !entry.length) return { notFound: true, key, style };
    const srcUrls = await loadFile("sourceToUrl", scope).catch(() => ({}));
    const list = entry.map((e) => {
      const algs = e[0] || [];
      const sources = resolveSources(e[1], category, srcUrls);
      return { alg: algs[0] || "", variations: algs, commutator: null, sources };
    });
    const first = list[0] || null;
    return {
      notFound: false, key, style,
      recommended: first ? first.alg : null,
      recCommutator: null,
      recSources: first ? first.sources : [],
      list,
    };
  }

  // nightmare
  const recMap = cfg.selected ? await loadFile(cfg.selected, scope).catch(() => ({})) : null;
  const listMap = await loadFile(cfg.nightmare, scope).catch(() => ({}));
  let recommended = recMap ? recMap[key] : null;
  const listKey = categoryEntryKey(listMap, key, category);
  const raw = listKey ? listMap[listKey] : null;
  const algs = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  if (!recommended) recommended = algs[0] || null;
  if (!recommended) return { notFound: true, key, style };
  const finalAlgs = algs.length ? algs : [recommended];
  const list = finalAlgs.map((a) => ({ alg: a, commutator: null }));
  return { notFound: false, key, style, recommended, recCommutator: null, recSources: [], list };
}
