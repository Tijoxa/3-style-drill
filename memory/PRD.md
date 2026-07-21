# PRD — 3-Style BLD Cube Trainer

## Original Problem Statement
Build an app to drill 3x3 Rubik's cube 3-style (blindfolded) commutators with a connected smart cube (Web Bluetooth, via `poliva/smartcube-web-bluetooth`). Interface like blindtrainer.com: a letter pair appears; the user executes the commutator on the cube; when correct, a new pair appears instantly.

## User Choices
- Train BOTH corners and edges.
- Validation = cube reaches the resulting state after the algorithm (final-state check, no stored algorithms).
- Speffz lettering; corner buffer UFR (C), edge buffer UF (c).
- Local (browser) stats only.
- Dark, training-focused UI (Barlow Condensed + JetBrains Mono, deep-obsidian palette).

## Architecture
- Frontend-only training logic (React SPA). Backend untouched (default FastAPI/Mongo template).
- Cube engine: `/app/frontend/src/lib/cube.mjs` — Kociemba 54-facelet model, moves generated from 3D geometry, Speffz maps, `apply3Cycle` piece cycler. Unit-validated (real commutator `R U R' D' R U' R' D` reproduces Speffz pair C-P-T → moves + lettering + orientation + cycle direction all correct).
- Bluetooth wrapper: `/app/frontend/src/lib/smartcube.js` (dynamic import of `smartcube-web-bluetooth`, GAN/MoYu/QiYi/GoCube/Giiker). Library shipped without a build → compiled its TS `src` to `dist/esm` during setup; package `main`/`module` repointed.
- UI: `App.js` (trainer loop, HUD, drawers, manual moves, keyboard), `components/CubeNet.jsx` (2D unfolded sticker map with true Rubik colors + buffer/target highlights).

## Implemented (2026-06)
- Auto-advance training loop: random Speffz pair → target state computed via 3-cycle → detection on cube/manual state change → instant next pair. Verified 100% by testing agent.
- Corners & edges modes, Speffz buffers configurable in settings.
- Smart-cube connect (MOVE + FACELETS + BATTERY), graceful failure when no Web Bluetooth/hardware.
- Manual move buttons + keyboard (U R F D L B, Shift=prime, Space=skip) fallback.
- HUD: solved, streak, best streak, last/avg time, cases/min. Recognition timer.
- Local stats (localStorage): total cases, time trained, best streak, best day; stats drawer.
- Sound feedback, reset cube, reset stats.

## Core Requirements (static)
- Web Bluetooth only on Chrome/Edge desktop or Android over HTTPS (not iOS).
- Final-state validation must match real 3-style algorithms (Speffz standard convention).

## Backlog
- P1: 3D cube view (twisty-player) instead of 2D net; per-case timing table / slowest cases; case filtering (train specific letter sets / buffers only like blindtrainer).
- P1: Cloud sync of stats (optional account) — currently local only.
- P2: Wings/x-centers/midges, parity, twists/flips modules; custom lettering scheme editor; algsheet import.
- P2: Verify move-direction convention against several physical cube brands; auto-resync from FACELETS.

## Next Tasks
- Gather user feedback on the training feel and validation with a real cube; refine `smartcube.js` move/direction mapping if any brand mismatches.

## Notes
- No auth, no backend data, no external API keys. `window.__trainer` test hook exposed (getState/getTarget/solveCurrent) for automated E2E.
