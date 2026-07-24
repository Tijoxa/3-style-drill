// Fetches 3-style commutator algorithms live from v2.blddb.net (CORS-enabled).
// v2 stores flat dictionaries keyed by the 3-letter case code (buffer+t1+t2),
// e.g. { "ADM": "U' R' D R U' R' D' R U2" }. We fetch fresh per session and keep
// a localStorage fallback for offline use.
import { blddbCode } from "./cube.mjs";
import { commutator } from "./commutator.js";

const BASE = "https://v2.blddb.net/data/";
const CACHE_PREFIX = "blddb_cache_v2_";
const mem = {};

async function loadFile(name) {
  if (mem[name]) return mem[name];
  try {
    const res = await fetch(`${BASE}${name}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    mem[name] = data;
    try { localStorage.setItem(CACHE_PREFIX + name, JSON.stringify(data)); } catch {}
    return data;
  } catch (e) {
    const cached = localStorage.getItem(CACHE_PREFIX + name);
    if (cached) { const d = JSON.parse(cached); mem[name] = d; return d; }
    throw e;
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

// Returns { notFound, key, style, recommended, recCommutator, recSources, list }
// where list = [{ alg, commutator, sources? }]. Commutator is prioritized: for
// manmade it comes from the database, for nightmare it is derived from the alg.
export async function fetchHints({ type, buffer, t1, t2, style, maps }) {
  const bc = blddbCode(buffer, type, maps);
  const c1 = blddbCode(t1, type, maps);
  const c2 = blddbCode(t2, type, maps);
  const styles = STYLE_FILES[type] || STYLE_FILES.corner;
  const cfg = styles[style] || styles.nightmare;
  if (!bc || !c1 || !c2) return { notFound: true, key: null, style };

  const key = `${bc}${c1}${c2}`;

  if (cfg.manmade) {
    const map = await loadFile(cfg.manmade);
    const entry = map[key];
    if (!entry || !entry.length) return { notFound: true, key, style };
    const srcUrls = await loadFile("sourceToUrl").catch(() => ({}));
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
  const recMap = await loadFile(cfg.rec);
  const recommended = recMap[key];
  if (!recommended) return { notFound: true, key, style };
  const listMap = await loadFile(cfg.list).catch(() => ({}));
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
