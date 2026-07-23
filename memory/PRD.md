# 3-Style Trainer — PRD

## Original problem statement
Build an app to drill 3x3 Rubik's cube 3-style (blind method) commutators with a connected smart cube (Web Bluetooth via poliva/smartcube-web-bluetooth). UX like blindtrainer.com: a letter pair appears; user performs the commutator; when the cube reaches the resulting state, the next pair appears immediately.

## User choices
- Train BOTH corners and edges (3-style).
- Detection = cube reaches the state it should be after the algorithm (state comparison, no stored algs).
- Speffz lettering (corner buffer C = UFR, edge buffer c = UF), configurable.
- Local-only stats. Dark, focused speedcubing UI.

## Architecture
- Frontend: React SPA (CRA). Cube engine `src/lib/cube.mjs` (Kociemba 54-facelet model, moves from 3D geometry, Speffz mapping, apply3Cycle, relativeState via cubie conversion). Bluetooth wrapper `src/lib/smartcube.js` (statically imports smartcube-web-bluetooth; macAddressProvider). UI in `src/App.js` + `src/components/CubeNet.jsx`.
- Backend: untouched default FastAPI template (not used; stats are localStorage).
- Smart cube library compiled from TS source into node_modules/.../dist/esm (github package ships no build).

## Cube tracking model
- The app tracks the cube RELATIVE to a "solved reference" captured on connect and on "Cube Solved".
- Live state arrives via MOVE and/or FACELETS events; FACELETS are converted with relativeState(reference, current) so the puzzle displays/detects relative to the floating reference.
- "Cube Solved" re-baselines reference := current raw facelets (no more unsolve-after-reset).

## Implemented (verified)
- 2025 initial build: dark trainer UI, giant letter pair, corners/edges mode switch, HUD (solved/streak/best/time/cpm), 2D cube net with buffer+targets highlighted, settings drawer (buffers, sound, manual buttons, MAC field), stats drawer, local stats, keyboard + manual move controls.
- Cube engine validated in Node (moves, Speffz, apply3Cycle handedness == real commutator, relativeState identities).
- Core auto-advance loop verified (5 solves -> solved=5, streak=5). [testing_agent]
- Bluetooth: fixed user-gesture break (static import), manual MAC entry (modal + saved setting), GAN/MoYu/QiYi MAC provider.
- Fixed "cube solved unsolves" and "not responding to movements" via relative facelet tracking. [testing_agent iteration_2: 100%]
- Added **Chichu (彳亍) Chinese lettering scheme** selectable alongside Speffz (scheme registry in cube.mjs; buffers reset per scheme; maps generated from BLDDB source, validated). [testing_agent iteration_3: 100%]
- Made the app **GitHub Pages compatible**: vendored the smart-cube library into src/vendor, homepage:".", gh-pages script + GitHub Actions workflow; removed Emergent badge/analytics from index.html.
- **Mobile responsive layout** (useIsMobile hook): header wraps so the corners/edges toggle gets its own full-width row (was clipped); HUD becomes 2 columns; MAC modal anchors to top (94vw, scrollable) so it fits + isn't covered by the keyboard; root scrolls on small screens. Verified visually via forced breakpoint; testing_agent unavailable (sustained infra timeouts).
- **Hint button (live blddb.net algorithms)** [2026-06]: "Hint (H)" button + Escape/keyboard shortcut opens a portal modal showing the 3-style algorithms for the current pair, fetched LIVE from blddb.net (CORS `*`), cached in localStorage as offline fallback. Algorithm-style selector persisted per type (corners: Nightmare/Balance/Yuanzi/Manmade; edges: Nightmare/Manmade), default Nightmare. Shows the recommended alg large + full expandable list, each with commutator notation (commutator solver vendored from blddb `commutator.js`). Manmade entries list source counts.
  - Mapping: blddb internal "code" letters == the app's Chichu letters (uppercased). `blddbCode(letter,type,maps)` in cube.mjs converts any scheme (Speffz/Chichu) letter -> facelet idx -> blddb code. Key = code(buffer)+code(t1)+code(t2) -> `*AlgToStandard[key]` -> `*AlgToInfo*[std]` (list) + `*AlgTo{Style}[std]` (recommended).
  - Verified offline (slice/rotation-aware engine): corner buf J = 378/378 ok, edge buf a = 440/440 ok (misses = same-piece invalid combos); + in-app spot checks Speffz VD (JXA) and qp (AFR) solve exactly. New files: `src/lib/blddb.js`, `src/lib/commutator.js`.

## Backlog / next
- P1: Per-case timing stats and slow-case review (like blddb/blindtrainer "slow cases").
- P1: Add flips/twists/parity and wings/x-centers/midges categories (big cube 3-style).
- P2: Auto-request facelets after each move for GAN to improve mid-solve accuracy; whole-cube-rotation (x/y/z) handling.
- P2: Chrome experimental-flag hint for automatic MAC detection.
- P2: Custom lettering scheme editor.

## Debug hooks (dev/testing)
window.__trainer: solveCurrent, getSuccess, getState, getTarget, feedFacelets, markSolved, openMacPrompt.
window.__cube: SOLVED, applyMove, applyAlg, scramble.
