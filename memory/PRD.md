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
- **Hint button (live v2.blddb.net algorithms)** [2026-06, migrated 2026-07]: "Hint (H)" button + Escape/keyboard shortcut opens a portal modal showing the 3-style algorithms for the current pair, fetched LIVE from **v2.blddb.net** (CORS `*`, flat JSON dicts under `/data/`), cached in localStorage (`blddb_cache_v2_`) as offline fallback. Algorithm-style selector persisted per type — v2 offers only **Nightmare** and **Manmade** for both corners and edges (Balance/Yuanzi removed, no longer in v2), default Nightmare. **Commutator notation is displayed as primary** (large) with the full expanded alg beneath; falls back to alg if no commutator. Manmade sources shown as a hoverable/clickable (i) info popover listing author names, each linking to its `sourceToUrl` when available.
  - v2 file mapping: nightmare uses `{corner,edge}NightmareSelected.json` (recommended, flat `{key:alg}`) + `{corner,edge}Nightmare.json` (all variants `{key:[algs]}`). Manmade uses `{corner,edge}Manmade.json` (`{key:[[[algs],[sources],[commutators]],...]}` — commutator provided directly). Key = code(buffer)+code(t1)+code(t2) via `blddbCode(letter,type,maps)` (unchanged from v1). `sourceToUrl.json` resolves author -> per-type URL.
  - `blddbCode` internal "code" letters == the app's Chichu letters (uppercased); converts any scheme (Speffz/Chichu) letter -> facelet idx -> blddb code. Files: `src/lib/blddb.js` (rewritten for v2), `src/lib/commutator.js` (vendored solver, still used for nightmare commutator derivation). Verified via screenshot 2026-07: nightmare + manmade modes render, commutator-first display, source (i) popover with links.
  - Hint modal made scrollable (was cropping when "Show all algorithms" expanded): now flex-centered full-screen container + `display:block; overflowY:auto; maxHeight:100%` so it stays in-viewport and scrolls internally. Dark-themed scrollbars added globally (`*` + `.theme-scroll` in index.css, thumb #3f3f46 / transparent track). Verified by testing_agent iteration_4 (100%, desktop+mobile).
- **Timer starts on first move** [2026-06]: recognition timer stays at 0 until the first actual cube move of a case, then counts; stats elapsed measured from first move. Manual move buttons now OFF by default; edge letters shown uppercased everywhere (display only, internal letters stay lowercase).
- **Timer start refinement** [2026-06]: `buildCase(startImmediately)` — first load / mode switch / skip / reset wait for the first move; after finishing a pair (`onSuccess` -> `buildCase(true)`) the timer runs immediately. **Inactivity: a 30s timeout STOPS/freezes the chrono** only while it is *running* (post-solve/immediate mode) when no move is made; cancelled on the first move. Wait-for-move states (first pair on load, mode switch, skip) have NO freeze so the first move always launches the timer regardless of elapsed idle time. Chrono shows a visual state via `data-timer-state` (waiting/running/stopped): greyed (#52525B) when waiting-for-move or stopped, brighter (#D4D4D8) while running (no blinking). Frozen time is used for stats if the case is later solved. Verified all transitions.
- **PWA / installable standalone app** [2026-06]: `public/manifest.json` (display standalone, theme #0a0a0a, user's cube logo -> icon-192/512, maskable-512, apple-180, favicon), `public/service-worker.js` (same-origin stale-while-revalidate, cross-origin like blddb passes through), PWA meta + SW registration in `index.js`. Verified: manifest linked, display standalone, SW registered (root scope), all assets 200.
- **Case subset selector** [2026-06]: Settings -> "Select case subset" opens a portal grid modal (`SubsetModal`) per type (corner/edge toggle). 24x24 grid: row=first target, col=second target. Five cell states: enabled(green)/disabled(dark)/impossible(locked, same-piece or diagonal)/buffer-excluded-enabled & buffer-excluded-disabled (striped+dimmed). Click or **drag to paint**; click row/col label to toggle a whole line; Enable/Disable-all buttons; live "active/total" count. Selection persisted in `settings.disabledCases` keyed `scheme:type:t1:t2` (only disabled stored; default all enabled). `buildCase` builds the valid+enabled ordered-pair pool and picks from it; empty pool -> pair "--". Drag = **gallery-style rectangle marquee** (anchor cell sets enable/disable mode; live preview; touch-safe via `elementFromPoint` since pointer capture blocks pointerenter). Modal centered via a full-screen flex container (NOT transform — framer-motion's scale animation overrides `transform: translate`, which caused the earlier off-center/cropped overflow). Responsive: cell size computed from viewport width so the 24-col grid matches phone width (`floor(avail/25 - gap)`, capped 22 on desktop); modal is a **block scroll container** (`display:block; overflowY:auto`) so the WHOLE widget scrolls (flex column was shrinking/clipping the grid). Layout order: header + type switch + count, then GRID, then Enable/Disable-all + instructions + legend below. Grid `touch-action: pan-y` on mobile so vertical swipe scrolls the widget even over the grid (desktop keeps `none` for crisp mouse rectangle-select). Verified desktop 1440x900 (centered, fits, full A-X) and mobile 393x620 (cell 12, full width, scrollHeight>clientHeight, scroll works, grid above controls).

## Backlog / next
- BUGFIX [2026-06] disconnect-on-turn: vendored `gan-cube-protocol.js` MOVE handler had a custom multi-chunk `while` loop that fabricated phantom moves -> FIFO move buffer stalled/overflowed (>16) -> `conn.disconnect()`. Reverted to upstream single-move-per-notification read. Also wrapped `smartcube.js` events$ subscribe in try/catch so app-side handler errors can't drop the BLE connection. Regression verified by testing_agent iteration_5 (100%, 0 console errors) via simulated feedFacelets flow; REAL hardware disconnect needs physical-cube confirmation by user (not reproducible in automation).
- P1: Add flips/twists/parity and wings/x-centers/midges categories (big cube 3-style).
- P2: Auto-request facelets after each move for GAN to improve mid-solve accuracy; whole-cube-rotation (x/y/z) handling.
- P2: Chrome experimental-flag hint for automatic MAC detection.
- P2: Custom lettering scheme editor.

## Debug hooks (dev/testing)
window.__trainer: solveCurrent, getSuccess, getState, getTarget, feedFacelets, markSolved, openMacPrompt.
window.__cube: SOLVED, applyMove, applyAlg, scramble.
