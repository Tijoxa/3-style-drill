// Fetches 3-style commutator algorithms live from blddb.net (CORS-enabled).
// Data files are regularly updated on blddb.net, so we fetch fresh per session
// and keep a localStorage fallback for offline use.
import { blddbCode } from "./cube.mjs";
import { commutator } from "./commutator.js";

const BASE = "https://blddb.net/assets/json/";
const CACHE_PREFIX = "blddb_cache_v1_";
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

// style -> which json files hold the "info" list and the single "recommended" alg
const STYLE_FILES = {
  corner: {
    nightmare: { std: "cornerAlgToStandard", info: "cornerAlgToInfo", rec: "cornerAlgToNightmare" },
    balance: { std: "cornerAlgToStandard", info: "cornerAlgToInfoBalance", rec: "cornerAlgToBalance" },
    yuanzi: { std: "cornerAlgToStandard", info: "cornerAlgToInfoYuanzi", rec: "cornerAlgToYuanzi" },
    manmade: { std: "cornerAlgToStandard", info: "cornerAlgToInfoManmade", manmade: true },
  },
  edge: {
    nightmare: { std: "edgeAlgToStandard", info: "edgeAlgToInfo", rec: "edgeAlgToNightmare" },
    manmade: { std: "edgeAlgToStandard", info: "edgeAlgToInfoManmade", manmade: true },
  },
};

export const STYLE_OPTIONS = {
  corner: [
    ["nightmare", "Nightmare"],
    ["balance", "Balance"],
    ["yuanzi", "Yuanzi"],
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

// Returns { notFound, key, std, style, recommended, list } where list = [{ alg, commutator, sources? }]
export async function fetchHints({ type, buffer, t1, t2, style, maps }) {
  const bc = blddbCode(buffer, type, maps);
  const c1 = blddbCode(t1, type, maps);
  const c2 = blddbCode(t2, type, maps);
  const styles = STYLE_FILES[type];
  const cfg = styles[style] || styles.nightmare;
  if (!bc || !c1 || !c2) return { notFound: true, key: null, style };

  const key = `${bc}${c1}${c2}`;
  const stdMap = await loadFile(cfg.std);
  const std = stdMap[key];
  if (!std) return { notFound: true, key, style };

  const infoMap = await loadFile(cfg.info);
  const entry = infoMap[std];
  if (!entry) return { notFound: true, key, std, style };

  let list;
  let recommended = null;
  if (cfg.manmade) {
    list = entry.map((e) => {
      const algs = e[0] || [];
      const sources = e[1] || [];
      const alg = algs[0] || "";
      return { alg, variations: algs, commutator: comm(alg), sources };
    });
    recommended = list[0] ? list[0].alg : null;
  } else {
    list = entry.map((a) => ({ alg: a, commutator: comm(a) }));
    const recMap = await loadFile(cfg.rec);
    recommended = recMap[std] || (list[0] && list[0].alg) || null;
  }
  const recCommutator = recommended ? comm(recommended) : null;
  return { notFound: false, key, std, style, recommended, recCommutator, list };
}
