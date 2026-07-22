// 3x3 cube engine: Kociemba facelet model (URFDLB, 54 chars), Speffz lettering,
// moves generated from 3D geometry, and piece 3-cycles for 3-style training.

// --- Facelet geometry (index -> {pos:[x,y,z], n:[nx,ny,nz]}) in URFDLB row-major order ---
const P = [
  // U (n=[0,1,0]) idx 0-8, rows back->front, cols left->right
  [[-1,1,-1],[0,1,-1],[1,1,-1],[-1,1,0],[0,1,0],[1,1,0],[-1,1,1],[0,1,1],[1,1,1]],
  // R (n=[1,0,0]) idx 9-17
  [[1,1,1],[1,1,0],[1,1,-1],[1,0,1],[1,0,0],[1,0,-1],[1,-1,1],[1,-1,0],[1,-1,-1]],
  // F (n=[0,0,1]) idx 18-26
  [[-1,1,1],[0,1,1],[1,1,1],[-1,0,1],[0,0,1],[1,0,1],[-1,-1,1],[0,-1,1],[1,-1,1]],
  // D (n=[0,-1,0]) idx 27-35
  [[-1,-1,1],[0,-1,1],[1,-1,1],[-1,-1,0],[0,-1,0],[1,-1,0],[-1,-1,-1],[0,-1,-1],[1,-1,-1]],
  // L (n=[-1,0,0]) idx 36-44
  [[-1,1,-1],[-1,1,0],[-1,1,1],[-1,0,-1],[-1,0,0],[-1,0,1],[-1,-1,-1],[-1,-1,0],[-1,-1,1]],
  // B (n=[0,0,-1]) idx 45-53
  [[1,1,-1],[0,1,-1],[-1,1,-1],[1,0,-1],[0,0,-1],[-1,0,-1],[1,-1,-1],[0,-1,-1],[-1,-1,-1]],
];
const NORMS = [[0,1,0],[1,0,0],[0,0,1],[0,-1,0],[-1,0,0],[0,0,-1]];

const FACELETS = [];
for (let f = 0; f < 6; f++) for (let i = 0; i < 9; i++) FACELETS.push({ pos: P[f][i], n: NORMS[f] });
export const FACE_ORDER = "URFDLB";
export const SOLVED = FACE_ORDER.split("").map(c => c.repeat(9)).join("");

const key = (a) => a.join(",");
const posIndex = {}; // "pos,normal" -> facelet index
FACELETS.forEach((fl, i) => { posIndex[key([...fl.pos, ...fl.n])] = i; });

// Rotation transforms per face (clockwise viewed from outside)
const T = {
  U: (p) => [-p[2], p[1], p[0]],
  D: (p) => [p[2], p[1], -p[0]],
  R: (p) => [p[0], p[2], -p[1]],
  L: (p) => [p[0], -p[2], p[1]],
  F: (p) => [p[1], -p[0], p[2]],
  B: (p) => [-p[1], p[0], p[2]],
};
const AXIS = { U: [1, 1], D: [1, -1], R: [0, 1], L: [0, -1], F: [2, 1], B: [2, -1] };

// Build base clockwise permutation for a face: perm[i] = destination index
function buildFacePerm(face) {
  const [ax, sign] = AXIS[face];
  const t = T[face];
  const perm = FACELETS.map((_, i) => i);
  FACELETS.forEach((fl, i) => {
    if (fl.pos[ax] === sign) {
      const np = t(fl.pos);
      const nn = t(fl.n);
      const j = posIndex[key([...np, ...nn])];
      perm[i] = j;
    }
  });
  return perm;
}
const BASE = {};
"URFDLB".split("").forEach(f => { BASE[f] = buildFacePerm(f); });

function applyPerm(state, perm) {
  const out = new Array(54);
  for (let i = 0; i < 54; i++) out[perm[i]] = state[i];
  return out.join("");
}
function invert(perm) { const inv = new Array(54); for (let i = 0; i < 54; i++) inv[perm[i]] = i; return inv; }
function compose(p2, p1) { return p1.map((_, i) => p2[p1[i]]); }

// Full move table incl primes and doubles
export const MOVES = {};
"URFDLB".split("").forEach(f => {
  MOVES[f] = BASE[f];
  MOVES[f + "'"] = invert(BASE[f]);
  MOVES[f + "2"] = compose(BASE[f], BASE[f]);
});

export function applyMove(state, move) {
  const p = MOVES[move];
  if (!p) return state;
  return applyPerm(state, p);
}
export function applyAlg(state, alg) {
  const tokens = Array.isArray(alg) ? alg : alg.trim().split(/\s+/).filter(Boolean);
  let s = state;
  for (const m of tokens) s = applyMove(s, m);
  return s;
}

// --- Speffz lettering: letter -> facelet index ---
export const CORNER_LETTERS = {
  A:0,B:2,C:8,D:6,E:36,F:38,G:44,H:42,I:18,J:20,K:26,L:24,
  M:9,N:11,O:17,P:15,Q:45,R:47,S:53,T:51,U:27,V:29,W:35,X:33,
};
export const EDGE_LETTERS = {
  a:1,b:5,c:7,d:3,e:37,f:41,g:43,h:39,i:19,j:23,k:25,l:21,
  m:10,n:14,o:16,p:12,q:46,r:50,s:52,t:48,u:28,v:32,w:34,x:30,
};

// --- Chichu (彳亍) lettering: the common Chinese scheme (default in BLDDB) ---
// Generated from the BLDDB source scheme string, mapped to our facelet indices.
export const CHICHU_CORNER_LETTERS = {
  D:0,G:2,A:6,J:8,E:36,C:38,Q:42,M:44,B:18,L:20,N:24,Y:26,
  K:9,I:11,Z:15,S:17,H:45,F:47,T:51,P:53,W:27,X:29,O:33,R:35,
};
export const CHICHU_EDGE_LETTERS = {
  e:1,c:3,g:5,a:7,d:37,x:39,t:41,l:43,b:19,s:21,q:23,j:25,
  h:10,r:12,z:14,p:16,f:46,y:48,w:50,n:52,i:28,k:30,o:32,m:34,
};

export const SCHEMES = {
  speffz: {
    name: "Speffz",
    corner: CORNER_LETTERS,
    edge: EDGE_LETTERS,
    cornerBuffer: "C", // UFR
    edgeBuffer: "c",   // UF
  },
  chichu: {
    name: "Chichu (彳亍)",
    corner: CHICHU_CORNER_LETTERS,
    edge: CHICHU_EDGE_LETTERS,
    cornerBuffer: "J", // UFR
    edgeBuffer: "a",   // UF
  },
};

// Group facelets into pieces by cubie position; corners have no zero coord, edges one zero.
function isCorner(pos) { return pos.every(c => c !== 0); }
function pieceKey(pos) { return pos.join(","); }
const cornerPieces = {}; const edgePieces = {};
FACELETS.forEach((fl, i) => {
  const k = pieceKey(fl.pos);
  if (isCorner(fl.pos)) (cornerPieces[k] = cornerPieces[k] || []).push(i);
  else if (fl.pos.filter(c => c === 0).length === 1) (edgePieces[k] = edgePieces[k] || []).push(i);
});

// For a corner facelet, return its 3 facelets ordered clockwise (viewed from outside) starting at that facelet.
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

function cornerOrdered(startIdx) {
  const start = FACELETS[startIdx];
  const group = cornerPieces[pieceKey(start.pos)].slice();
  const others = group.filter(i => i !== startIdx);
  const outward = start.pos; // outward diagonal ~ position of corner
  const [a, b] = others;
  // pick the one that is clockwise-next from start when viewed from outside
  const c = cross(FACELETS[startIdx].n, FACELETS[a].n);
  const next = dot(c, outward) < 0 ? a : b;
  const last = next === a ? b : a;
  return [startIdx, next, last];
}
function edgeOrdered(startIdx) {
  const start = FACELETS[startIdx];
  const group = edgePieces[pieceKey(start.pos)];
  const other = group.find(i => i !== startIdx);
  return [startIdx, other];
}

function letterToFacelet(letter, type, maps = SCHEMES.speffz) {
  return (type === "corner" ? maps.corner : maps.edge)[letter];
}
export function letterPieceId(letter, type, maps = SCHEMES.speffz) {
  const idx = letterToFacelet(letter, type, maps);
  return pieceKey(FACELETS[idx].pos);
}
function orderedFor(letter, type, maps = SCHEMES.speffz) {
  const idx = letterToFacelet(letter, type, maps);
  return type === "corner" ? cornerOrdered(idx) : edgeOrdered(idx);
}

// Apply a 3-cycle of pieces: content flows buffer -> t1 -> t2 -> buffer, matching sticker roles.
export function apply3Cycle(state, [buffer, t1, t2], type, maps = SCHEMES.speffz) {
  const bo = orderedFor(buffer, type, maps), o1 = orderedFor(t1, type, maps), o2 = orderedFor(t2, type, maps);
  const out = state.split("");
  const n = bo.length;
  for (let k = 0; k < n; k++) {
    out[o1[k]] = state[bo[k]];
    out[o2[k]] = state[o1[k]];
    out[bo[k]] = state[o2[k]];
  }
  return out.join("");
}

// Random scramble
const SCR_MOVES = ["U","U'","U2","R","R'","R2","F","F'","F2","D","D'","D2","L","L'","L2","B","B'","B2"];
export function scramble(len = 25) {
  const faces = ["U","R","F","D","L","B"];
  const out = []; let prev = "", prev2 = "";
  while (out.length < len) {
    const m = SCR_MOVES[Math.floor(Math.random() * SCR_MOVES.length)];
    const f = m[0];
    if (f === prev) continue;
    if (f === prev2 && areOpposite(f, prev)) continue;
    out.push(m); prev2 = prev; prev = f;
  }
  return out;
}
function areOpposite(a, b) {
  const pairs = { U:"D", D:"U", R:"L", L:"R", F:"B", B:"F" };
  return pairs[a] === b;
}

export const CORNER_LETTER_LIST = Object.keys(CORNER_LETTERS);
export const EDGE_LETTER_LIST = Object.keys(EDGE_LETTERS);

// Facelet index -> face char, for rendering the net with true colors
export function stateToFaceMap(state) { return state.split(""); }

// ---- Cubie-level conversion for relative (floating-reference) tracking ----
// Canonical ordered facelets per corner/edge slot (clockwise for corners).
const CORNER_SLOTS = Object.values(cornerPieces).map((g) => cornerOrdered(Math.min(...g)));
const EDGE_SLOTS = Object.values(edgePieces).map((g) => edgeOrdered(Math.min(...g)));
const CORNER_HOME = CORNER_SLOTS.map((o) => o.map((i) => SOLVED[i])); // solved colors per slot
const EDGE_HOME = EDGE_SLOTS.map((o) => o.map((i) => SOLVED[i]));

function multisetEq(a, b) { return [...a].sort().join("") === [...b].sort().join(""); }

function faceletsToCubies(state) {
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let s = 0; s < 8; s++) {
    const colors = CORNER_SLOTS[s].map((i) => state[i]);
    let h = 0; for (let k = 0; k < 8; k++) if (multisetEq(colors, CORNER_HOME[k])) { h = k; break; }
    let r = 0; for (let rr = 0; rr < 3; rr++) if (colors.every((c, k) => c === CORNER_HOME[h][(k + rr) % 3])) { r = rr; break; }
    cp[s] = h; co[s] = r;
  }
  for (let s = 0; s < 12; s++) {
    const colors = EDGE_SLOTS[s].map((i) => state[i]);
    let h = 0; for (let k = 0; k < 12; k++) if (multisetEq(colors, EDGE_HOME[k])) { h = k; break; }
    const r = colors[0] === EDGE_HOME[h][0] ? 0 : 1;
    ep[s] = h; eo[s] = r;
  }
  return { cp, co, ep, eo };
}

function cubiesToFacelets(c) {
  const out = SOLVED.split("");
  for (let s = 0; s < 8; s++) {
    const h = c.cp[s], r = c.co[s];
    for (let k = 0; k < 3; k++) out[CORNER_SLOTS[s][k]] = CORNER_HOME[h][(k + r) % 3];
  }
  for (let s = 0; s < 12; s++) {
    const h = c.ep[s], r = c.eo[s];
    for (let k = 0; k < 2; k++) out[EDGE_SLOTS[s][k]] = EDGE_HOME[h][(k + r) % 2];
  }
  return out.join("");
}

// rel = ref^-1 * cur  (physical delta from ref to cur, expressed on a solved cube)
export function relativeState(refFacelets, curFacelets) {
  if (!refFacelets || refFacelets.length !== 54) return curFacelets;
  const ref = faceletsToCubies(refFacelets), cur = faceletsToCubies(curFacelets);
  // inverse of ref
  const rInvCp = new Array(8), rInvCo = new Array(8), rInvEp = new Array(12), rInvEo = new Array(12);
  for (let i = 0; i < 8; i++) { rInvCp[ref.cp[i]] = i; rInvCo[ref.cp[i]] = (3 - ref.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { rInvEp[ref.ep[i]] = i; rInvEo[ref.ep[i]] = (2 - ref.eo[i]) % 2; }
  const cp = new Array(8), co = new Array(8), ep = new Array(12), eo = new Array(12);
  for (let i = 0; i < 8; i++) { cp[i] = rInvCp[cur.cp[i]]; co[i] = (rInvCo[cur.cp[i]] + cur.co[i]) % 3; }
  for (let i = 0; i < 12; i++) { ep[i] = rInvEp[cur.ep[i]]; eo[i] = (rInvEo[cur.ep[i]] + cur.eo[i]) % 2; }
  return cubiesToFacelets({ cp, co, ep, eo });
}

// ---- Self tests (imported by cube.test.mjs) ----
export function runTests() {
  let pass = 0, fail = 0;
  const check = (name, cond) => { if (cond) { pass++; } else { fail++; console.log("FAIL:", name); } };

  check("solved length 54", SOLVED.length === 54);
  // move^4 identity & inverse
  for (const f of "URFDLB") {
    let s = SOLVED;
    for (let i = 0; i < 4; i++) s = applyMove(s, f);
    check(`${f}^4 = solved`, s === SOLVED);
    check(`${f} ${f}' = solved`, applyMove(applyMove(SOLVED, f), f + "'") === SOLVED);
  }
  // scramble + inverse
  const scr = scramble(30);
  let s = applyAlg(SOLVED, scr);
  const inv = scr.slice().reverse().map(m => m.length === 1 ? m + "'" : m.endsWith("'") ? m[0] : m);
  check("scramble + inverse = solved", applyAlg(s, inv) === SOLVED && s !== SOLVED);

  // single U move known result: UFR U-sticker (idx8) should go to UFL U-slot (idx6)? U CW: F->L side on top... verify a facelet moved and stays on U
  const uState = applyMove(SOLVED, "U");
  check("U keeps U face solid", uState.slice(0,9) === "UUUUUUUUU");

  // 3-cycle is a valid pure 3-cycle: applied 3 times = identity, touches only expected stickers
  const t = apply3Cycle(SOLVED, ["C", "A", "F"], "corner");
  check("corner 3cycle x3 = solved", apply3Cycle(apply3Cycle(t, ["C","A","F"], "corner"), ["C","A","F"], "corner") === SOLVED);
  let diff = 0; for (let i=0;i<54;i++) if (t[i]!==SOLVED[i]) diff++;
  check("corner 3cycle touches 9 stickers", diff === 9);

  const te = apply3Cycle(SOLVED, ["c", "a", "f"], "edge");
  check("edge 3cycle x3 = solved", apply3Cycle(apply3Cycle(te, ["c","a","f"], "edge"), ["c","a","f"], "edge") === SOLVED);
  let diffe = 0; for (let i=0;i<54;i++) if (te[i]!==SOLVED[i]) diffe++;
  check("edge 3cycle touches 6 stickers", diffe === 6);

  // Handedness: a real pure 3-cycle commutator must equal SOME apply3Cycle with buffer C.
  // [R U R', D'] is a pure 3-corner cycle. Result must be reproducible by a Speffz pair.
  const comm = applyAlg(SOLVED, "R U R' D' R U' R' D");
  let commDiff = 0; for (let i=0;i<54;i++) if (comm[i]!==SOLVED[i]) commDiff++;
  check("comm is pure corner 3-cycle (9 stickers)", commDiff === 9);
  // try to reproduce with any ordered pair of corner letters (any buffer)
  let reproduced = false;
  const L = CORNER_LETTER_LIST;
  outer:
  for (const b of L) for (const x of L) for (const y of L) {
    if (b===x||x===y||b===y) continue;
    if (letterPieceId(b,"corner")===letterPieceId(x,"corner")) continue;
    if (letterPieceId(x,"corner")===letterPieceId(y,"corner")) continue;
    if (letterPieceId(b,"corner")===letterPieceId(y,"corner")) continue;
    if (apply3Cycle(SOLVED, [b,x,y], "corner") === comm) { reproduced = true; console.log("comm == pair", b,x,y); break outer; }
  }
  check("comm reproducible by Speffz 3-cycle (handedness ok)", reproduced);

  // relative-state tests (floating reference tracking)
  check("relative(SOLVED, cur) == cur", relativeState(SOLVED, comm) === comm);
  check("relative(cur, cur) == SOLVED", relativeState(comm, comm) === SOLVED);
  const A = applyAlg(SOLVED, "R U F' L2 D");
  const AR = applyMove(A, "R");
  check("relative(A, A·R) == solved·R", relativeState(A, AR) === applyMove(SOLVED, "R"));
  const B = applyAlg(SOLVED, "U2 B D' L F2");
  const seq = "R U R' U' F2 D";
  check("relative(B, B·seq) == solved·seq", relativeState(B, applyAlg(B, seq)) === applyAlg(SOLVED, seq));
  check("roundtrip cubies", (() => { const c = applyAlg(SOLVED, "R U R' F D2 L'"); return relativeState(SOLVED, c) === c; })());

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail === 0;
}
