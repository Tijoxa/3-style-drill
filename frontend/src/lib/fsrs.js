// Lightweight FSRS-style scheduler adapted for a continuous 3-style drill.
// - Grade is derived from solve time vs the user's rolling average per type
//   (adaptive: <60% avg => Easy, <=150% => Good, else Hard).
// - Retrievability decays over minutes (not days) so weak cases resurface within a session.
// - Case selection is a SOFT weighted-random draw by (1 - retrievability); every case keeps
//   a small floor weight so nothing is impossible. New (unseen) cases get a high weight.
// The FSRS memory model starts fresh; solve times are still recorded elsewhere.

const STORE_KEY = "bld3style_fsrs_v1";

// FSRS-4.5 default parameters (17 weights).
const W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234, 1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407, 2.9466];
const DECAY = -0.5;
const FACTOR = 19 / 81; // so R = 0.9 exactly when t == S
const MIN_D = 1, MAX_D = 10;
const WEIGHT_FLOOR = 0.05;   // soft: weak cases more frequent, none impossible
const NEW_WEIGHT = 1.0;      // unseen cases get max urgency
const EMA_ALPHA = 0.2;       // rolling average responsiveness
const EMA_MIN_SAMPLES = 3;   // before this, grade defaults to "Good"

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const D0 = (g) => clamp(W[4] - (g - 3) * W[5], MIN_D, MAX_D);
const initS = (g) => W[g - 1];

// Retrievability after `tMin` minutes with stability `sMin` (minutes).
function retrievability(tMin, sMin) {
  if (!sMin || sMin <= 0) return 0;
  return Math.pow(1 + FACTOR * (tMin / sMin), DECAY);
}

function nextDifficulty(d, g) {
  const dp = d - W[6] * (g - 3);
  return clamp(W[7] * D0(4) + (1 - W[7]) * dp, MIN_D, MAX_D);
}

function nextStability(d, s, r, g) {
  const hard = g === 2 ? W[15] : 1;
  const easy = g === 4 ? W[16] : 1;
  const inc = Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hard * easy;
  return Math.max(0.1, s * (1 + inc));
}

export function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { cards: s.cards || {}, ema: s.ema || {}, emaCount: s.emaCount || {} };
    }
  } catch {}
  return { cards: {}, ema: {}, emaCount: {} };
}

export function saveStore(store) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

export function resetStore(store) {
  store.cards = {}; store.ema = {}; store.emaCount = {};
  saveStore(store);
}

// Grade (2=Hard, 3=Good, 4=Easy) from solve time vs adaptive per-type average.
function gradeFromTime(store, type, elapsedMs) {
  const n = store.emaCount[type] || 0;
  const avg = store.ema[type];
  if (n < EMA_MIN_SAMPLES || !avg) return 3; // not enough data yet -> Good
  const ratio = elapsedMs / avg;
  if (ratio < 0.6) return 4;      // fast -> Easy
  if (ratio <= 1.5) return 3;     // around average -> Good
  return 2;                       // slow -> Hard
}

// Record a successful, non-timed-out review. Mutates store; returns it.
export function recordReview(store, key, type, elapsedMs, now = Date.now()) {
  const g = gradeFromTime(store, type, elapsedMs);
  const card = store.cards[key];
  if (!card) {
    store.cards[key] = { S: initS(g), D: D0(g), last: now, reps: 1 };
  } else {
    const tMin = Math.max(0, (now - (card.last || now)) / 60000);
    const r = retrievability(tMin, card.S);
    const D = nextDifficulty(card.D, g);
    const S = nextStability(D, card.S, r, g);
    store.cards[key] = { S, D, last: now, reps: (card.reps || 0) + 1 };
  }
  // update rolling average AFTER grading (so grade reflects prior performance)
  const prev = store.ema[type];
  store.ema[type] = prev == null ? elapsedMs : prev * (1 - EMA_ALPHA) + elapsedMs * EMA_ALPHA;
  store.emaCount[type] = (store.emaCount[type] || 0) + 1;
  return store;
}

// Selection weight for a case (higher = more likely). now injected for testability.
export function caseWeight(store, key, now = Date.now()) {
  const card = store.cards[key];
  if (!card) return NEW_WEIGHT;
  const tMin = Math.max(0, (now - (card.last || now)) / 60000);
  const r = retrievability(tMin, card.S);
  return Math.max(1 - r, WEIGHT_FLOOR);
}

// Soft weighted-random pick from a list of [t1,t2] pairs. keyFn(pair) -> case key.
export function pickWeightedPair(pairs, keyFn, store, now = Date.now()) {
  let total = 0;
  const weights = pairs.map((p) => { const w = caseWeight(store, keyFn(p), now); total += w; return w; });
  if (total <= 0) return pairs[Math.floor(Math.random() * pairs.length)];
  let r = Math.random() * total;
  for (let i = 0; i < pairs.length; i++) {
    r -= weights[i];
    if (r <= 0) return pairs[i];
  }
  return pairs[pairs.length - 1];
}
