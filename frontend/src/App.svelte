<script>
  import "./App.css";
  import { onMount, onDestroy } from "svelte";
  import { fade, fly, scale } from "svelte/transition";
  import Toaster from "./components/Toaster.svelte";
  import HintModal from "./components/HintModal.svelte";
  import SubsetModal from "./components/SubsetModal.svelte";
  import RecognitionTimer from "./components/RecognitionTimer.svelte";
  import { toast } from "./lib/toast.js";
  import {
    Bluetooth, BluetoothConnected, Settings as SettingsIcon, BarChart3,
    X, RotateCcw, SkipForward, Keyboard, BatteryMedium, Lightbulb, ExternalLink, Loader2, Grid3X3, Github, Info, ChevronDown, AlertTriangle, Pause, Play
  } from "lucide-svelte";
  import {
    SOLVED, applyMove, applyAlg, scramble, apply3Cycle, letterPieceId, relativeState, SCHEMES,
    orientMaps, CUBE_COLORS, COLOR_LABEL, OPPOSITE_COLOR, caseCodeToDisplay
  } from "./lib/cube.mjs";
  import { connect as btConnect, disconnect as btDisconnect, isBluetoothSupported } from "./lib/smartcube.js";
  import { fetchHints, fetchCaseHints, STYLE_OPTIONS, CATEGORY_STYLE_OPTIONS, loadCategoryCases } from "./lib/blddb.js";
  import { loadStore as loadFsrs, saveStore as saveFsrs, resetStore as resetFsrs, recordReview, pickWeightedPair } from "./lib/fsrs.js";
  import CubeNet from "./components/CubeNet.svelte";

  const STATS_KEY = "bld3style_stats_v1";
  const SETTINGS_KEY = "bld3style_settings_v1";
  const NEW_CATEGORIES = ["flips", "twists", "parity", "ltct"];
  const CATEGORY_META = {
    flips:  { label: "Edge Flips",    short: "EDGE FLIPS",    url: "https://v2.blddb.net/flips" },
    twists: { label: "Corner Twists", short: "CORNER TWISTS", url: "https://v2.blddb.net/twists" },
    parity: { label: "Parity",        short: "PARITY",        url: "https://v2.blddb.net/parity" },
    ltct:   { label: "LTCT & T2C",    short: "LTCT / T2C",    url: "https://v2.blddb.net/ltct" },
  };
  const FLIP_COUNTS_AVAILABLE = [2];
  const TWIST_COUNTS_AVAILABLE = [2, 3, 4, 5, 6, 7, 8];
  const MODE_TO_SUBSET_VIEW = { corners: "corner", edges: "edge", flips: "flips", twists: "twists", parity: "corner", ltct: "corner" };
  const facelet = (l, type, maps) => (type === "corner" ? maps.corner : maps.edge)[l];
  const getMaps = (scheme, orientation) => orientMaps(SCHEMES[scheme] || SCHEMES.speffz, orientation);
  const today = () => new Date().toISOString().slice(0, 10);

  function loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v || fallback; } catch { return fallback; }
  }

  function beep(freq, ok) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = ok ? "triangle" : "sawtooth"; o.frequency.value = freq;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
      o.start(); o.stop(ctx.currentTime + 0.16);
    } catch {}
  }

  const defaultSettings = { scheme: "speffz", cornerBuffer: "C", edgeBuffer: "c", sound: true, showManual: false, macAddress: "", cornerStyle: "nightmare", edgeStyle: "nightmare", catStyle: "nightmare", flipCounts: [2], twistCounts: [2], orientation: { top: "white", front: "green" }, distribution: "uniform", srTimeoutMs: 10000, disabledCases: {} };
  const caseKey = (scheme, type, t1, t2) => `${scheme}:${type}:${t1}:${t2}`;

  // Reactive state
  let mode = "corners";
  let isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  let settings = { ...defaultSettings, ...loadJSON(SETTINGS_KEY, {}) };
  let pair = null;
  let highlights = {};
  let netState = SOLVED;
  let flash = null;
  let btStatus = "disconnected";
  let cubeName = "";
  let battery = null;
  let drawer = null; // 'settings' | 'stats' | 'mode-menu' | null
  let macPrompt = null; // { deviceName, resolve } | null
  let confirmReset = false;
  let hintOpen = false;
  let subsetOpen = false;
  let lifetime = loadJSON(STATS_KEY, { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} });
  let isTimerPaused = false;
  let session = { solved: 0, streak: 0, bestStreak: 0, times: [] };
  let sessionStartRef = Date.now();

  // Reactive timer variables
  let caseStartRef = null;
  let caseStartedRef = false;
  let caseStoppedRef = null;

  // Internal refs
  let cubeStateRef = SOLVED;
  let streakRef = 0;
  let successRef = 0;
  let targetRef = null;
  let noMoveTimeoutRef = null;
  let modeRef = mode;
  let settingsRef = settings;
  let busyRef = false;
  let refFaceletsRef = null;
  let rawFaceletsRef = SOLVED;
  let fsrsRef = loadFsrs();
  let currentCaseKeyRef = null;
  let currentTypeRef = "corner";
  let btStatusRef = "disconnected";
  let tapRef = { timer: null };
  let categoryCacheRef = {};
  let catState = { loading: false, error: null };
  let isTimerPausedRef = isTimerPaused;

  $: {
    isTimerPausedRef = isTimerPaused;
    modeRef = mode;
    btStatusRef = btStatus;
    settingsRef = settings;
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    }
  }

  // Ensure cornerBuffer & edgeBuffer always match the active scheme
  $: {
    const s = SCHEMES[settings.scheme] || SCHEMES.speffz;
    if (settings.cornerBuffer && !s.corner[settings.cornerBuffer]) {
      settings = { ...settings, cornerBuffer: s.cornerBuffer || "C" };
    }
    if (settings.edgeBuffer && !s.edge[settings.edgeBuffer]) {
      settings = { ...settings, edgeBuffer: s.edgeBuffer || "c" };
    }
  }

  function handleResize() {
    isMobile = window.innerWidth < 640;
  }

  function buildCase(startImmediately = false) {
    if (noMoveTimeoutRef) { clearTimeout(noMoveTimeoutRef); noMoveTimeoutRef = null; }
    const m = modeRef;
    const s = settingsRef;

    if (NEW_CATEGORIES.includes(m)) {
      const recMap = categoryCacheRef[m];
      const catMaps = getMaps(s.scheme, s.orientation);
      const clearCase = () => { targetRef = null; caseStartRef = null; caseStartedRef = false; caseStoppedRef = null; pair = null; highlights = {}; };
      if (!recMap) { clearCase(); return; }
      let keys = Object.keys(recMap);
      if (m === "flips") keys = keys.filter((k) => (s.flipCounts || [2]).includes(k.length));
      else if (m === "twists") keys = keys.filter((k) => (s.twistCounts || [2]).includes(k.length));
      if (!keys.length) { clearCase(); return; }
      const cur = cubeStateRef;
      const spaced = s.distribution === "spaced";
      for (let tries = 0; tries < 200; tries++) {
        const kkey = spaced
          ? pickWeightedPair(keys, (k) => `${s.scheme}:${m}:${k}`, fsrsRef)
          : keys[Math.floor(Math.random() * keys.length)];
        const alg = recMap[kkey];
        if (!alg) continue;
        const target = applyAlg(cur, alg);
        if (target !== cur) {
          targetRef = target;
          currentCaseKeyRef = `${s.scheme}:${m}:${kkey}`;
          currentTypeRef = m;
          caseStoppedRef = null;
          if (startImmediately && !isTimerPausedRef) {
            caseStartedRef = true;
            caseStartRef = Date.now();
            noMoveTimeoutRef = setTimeout(() => {
              caseStoppedRef = caseStartRef ? Date.now() - caseStartRef : 0;
              noMoveTimeoutRef = null;
            }, 30000);
          } else {
            caseStartedRef = false;
            caseStartRef = null;
          }
          pair = { code: kkey, display: caseCodeToDisplay(kkey, m, catMaps), type: m };
          const set = [];
          for (let i = 0; i < 54; i++) if (target[i] !== cur[i]) set.push(i);
          highlights = { set };
          return;
        }
      }
      return;
    }

    const maps = getMaps(s.scheme, s.orientation);
    const type = m === "corners" ? "corner" : "edge";
    const list = Object.keys(type === "corner" ? maps.corner : maps.edge);
    const buffer = type === "corner" ? (s.cornerBuffer || "C") : (s.edgeBuffer || "c");
    const bufPiece = letterPieceId(buffer, type, maps);
    const cands = list.filter((l) => letterPieceId(l, type, maps) !== bufPiece);
    const disabled = s.disabledCases || {};
    const validPairs = [];
    for (const t1 of cands) {
      const p1 = letterPieceId(t1, type, maps);
      for (const t2 of cands) {
        if (t2 === t1 || letterPieceId(t2, type, maps) === p1) continue;
        if (disabled[caseKey(s.scheme, type, t1, t2)]) continue;
        validPairs.push([t1, t2]);
      }
    }
    if (validPairs.length === 0) {
      targetRef = null;
      caseStartRef = null;
      caseStartedRef = false;
      caseStoppedRef = null;
      pair = null;
      highlights = {};
      return;
    }
    const cur = cubeStateRef;
    const spaced = s.distribution === "spaced";
    for (let tries = 0; tries < 200; tries++) {
      const [t1, t2] = spaced
        ? pickWeightedPair(validPairs, ([a, b]) => caseKey(s.scheme, type, a, b), fsrsRef)
        : validPairs[Math.floor(Math.random() * validPairs.length)];
      const target = apply3Cycle(cur, [buffer, t1, t2], type, maps);
      if (target !== cur) {
        targetRef = target;
        currentCaseKeyRef = caseKey(s.scheme, type, t1, t2);
        currentTypeRef = type;
        caseStoppedRef = null;
        if (startImmediately && !isTimerPausedRef) {
          caseStartedRef = true;
          caseStartRef = Date.now();
          noMoveTimeoutRef = setTimeout(() => {
            caseStoppedRef = caseStartRef ? Date.now() - caseStartRef : 0;
            noMoveTimeoutRef = null;
          }, 30000);
        } else {
          caseStartedRef = false;
          caseStartRef = null;
        }
        pair = { t1, t2, type };
        highlights = { bufferIdx: facelet(buffer, type, maps), t1Idx: facelet(t1, type, maps), t2Idx: facelet(t2, type, maps) };
        return;
      }
    }
  }

  function onSuccess(capturedElapsed) {
    if (busyRef) return;
    busyRef = true;
    const elapsed = capturedElapsed != null
      ? capturedElapsed
      : (caseStoppedRef != null ? caseStoppedRef : (caseStartRef ? Date.now() - caseStartRef : 0));
    if (settingsRef.sound) beep(880, true);
    flash = "ok";
    const newStreak = streakRef + 1;
    streakRef = newStreak;
    successRef += 1;
    session = {
      solved: session.solved + 1,
      streak: newStreak,
      bestStreak: Math.max(session.bestStreak, newStreak),
      times: [...session.times, elapsed].slice(-500),
    };
    const d = today();
    const perDay = { ...lifetime.perDay, [d]: (lifetime.perDay[d] || 0) + 1 };
    lifetime = {
      totalCases: lifetime.totalCases + 1,
      totalTimeMs: lifetime.totalTimeMs + elapsed,
      bestStreak: Math.max(lifetime.bestStreak, newStreak),
      perDay,
    };
    localStorage.setItem(STATS_KEY, JSON.stringify(lifetime));
    setTimeout(() => { flash = null; }, 180);

    if (settingsRef.distribution === "spaced") {
      const timeout = settingsRef.srTimeoutMs || 10000;
      const key = currentCaseKeyRef;
      if (key && elapsed > 0 && elapsed < timeout) {
        recordReview(fsrsRef, key, currentTypeRef, elapsed);
        saveFsrs(fsrsRef);
      }
    }
    setTimeout(() => { buildCase(true); busyRef = false; }, 60);
  }

  function onStateChanged(newState) {
    const prev = cubeStateRef;
    cubeStateRef = newState;
    netState = newState;
    if (newState !== prev && !busyRef) {
      if (noMoveTimeoutRef) { clearTimeout(noMoveTimeoutRef); noMoveTimeoutRef = null; }
      if (!caseStartedRef && caseStoppedRef == null && !isTimerPausedRef) {
        caseStartedRef = true;
        caseStartRef = Date.now();
      }
    }
    if (targetRef && newState === targetRef) onSuccess();
  }

  function handleFacelets(f) {
    if (!f || f.length !== 54) return;
    rawFaceletsRef = f;
    if (!refFaceletsRef) refFaceletsRef = f;
    onStateChanged(relativeState(refFaceletsRef, f));
  }

  function doMove(move) {
    onStateChanged(applyMove(cubeStateRef, move));
  }

  function resetCube() {
    refFaceletsRef = rawFaceletsRef;
    cubeStateRef = SOLVED;
    netState = SOLVED;
    buildCase();
    toast.success("Cube set as solved");
  }

  function skipCase() {
    if (settingsRef.sound) beep(200, false);
    flash = "err";
    streakRef = 0;
    session = { ...session, streak: 0 };
    setTimeout(() => { flash = null; }, 280);
    buildCase();
  }

  function startTiming() {
    if (!targetRef || isTimerPausedRef) return;
    if (noMoveTimeoutRef) { clearTimeout(noMoveTimeoutRef); noMoveTimeoutRef = null; }
    caseStartedRef = true;
    caseStartRef = Date.now();
    caseStoppedRef = null;
    noMoveTimeoutRef = setTimeout(() => {
      caseStoppedRef = caseStartRef ? Date.now() - caseStartRef : 0;
      noMoveTimeoutRef = null;
    }, 30000);
  }

  function togglePauseTimer() {
    isTimerPaused = !isTimerPaused;
    if (isTimerPaused) {
      if (noMoveTimeoutRef) { clearTimeout(noMoveTimeoutRef); noMoveTimeoutRef = null; }
      if (caseStartRef != null && caseStoppedRef == null) {
        caseStoppedRef = Date.now() - caseStartRef;
      }
    } else {
      if (caseStoppedRef != null && caseStartRef != null) {
        caseStartRef = Date.now() - caseStoppedRef;
        caseStoppedRef = null;
      }
    }
  }

  function resetAndStop() {
    if (noMoveTimeoutRef) { clearTimeout(noMoveTimeoutRef); noMoveTimeoutRef = null; }
    caseStartedRef = false;
    caseStartRef = null;
    caseStoppedRef = null;
    if (settingsRef.sound) beep(300, false);
  }

  function validate() {
    if (busyRef || !targetRef) return;
    const running = caseStartRef != null && caseStoppedRef == null;
    if (running) onSuccess(Date.now() - caseStartRef);
    else startTiming();
  }

  function handleScreenTap(e) {
    if (drawer || hintOpen || subsetOpen || macPrompt) return;
    const el = e.target;
    if (el && el.closest && el.closest("button, a, input, select, textarea")) return;
    const t = tapRef;
    if (t.timer) { clearTimeout(t.timer); t.timer = null; resetAndStop(); return; }
    const running = caseStartRef != null && caseStoppedRef == null;
    const captured = running ? Date.now() - caseStartRef : null;
    t.timer = setTimeout(() => {
      t.timer = null;
      if (captured != null) onSuccess(captured);
      else startTiming();
    }, 250);
  }

  async function handleConnect() {
    if (btStatus === "connected") {
      await btDisconnect();
      btStatus = "disconnected";
      cubeName = "";
      battery = null;
      return;
    }
    if (!isBluetoothSupported()) {
      toast.error("Web Bluetooth not supported. Use Chrome or Edge on desktop or Android (not iOS).");
      return;
    }
    btStatus = "connecting";
    cubeName = "Connecting…";
    refFaceletsRef = null;
    try {
      const info = await btConnect({
        onMove: (m) => onStateChanged(applyMove(cubeStateRef, m)),
        onFacelets: handleFacelets,
        onBattery: (b) => { battery = b; },
        onStatus: (s) => { cubeName = s; },
        onDisconnect: () => {
          btStatus = "disconnected";
          cubeName = "";
          battery = null;
          toast("Cube disconnected");
        },
        requestMac: (deviceName) => new Promise((resolve) => { macPrompt = { deviceName, resolve }; }),
      }, { presetMac: settingsRef.macAddress });
      cubeName = info.name;
      btStatus = "connected";
      cubeStateRef = SOLVED;
      netState = SOLVED;
      buildCase();
      toast.success(`Connected: ${info.name}`);
    } catch (e) {
      btStatus = "disconnected";
      cubeName = "";
      const msg = (e && e.message) ? e.message : String(e);
      if (/cancel|User cancelled|chooser/i.test(msg)) toast("Connection cancelled");
      else if (/mac address/i.test(msg)) toast.error("Could not determine the cube's MAC. Enter it manually in Settings or when prompted.");
      else toast.error(`Connection failed: ${msg}`);
      console.error("Cube connection error:", e);
    }
  }

  function submitMac(mac) {
    if (macPrompt?.resolve) macPrompt.resolve(mac || null);
    macPrompt = null;
  }

  function resetStats() {
    localStorage.removeItem(STATS_KEY);
    lifetime = { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} };
    streakRef = 0;
    session = { solved: 0, streak: 0, bestStreak: 0, times: [] };
    sessionStartRef = Date.now();
    confirmReset = false;
    toast.success("All statistics deleted");
  }

  function resetSchedule() {
    resetFsrs(fsrsRef);
    toast.success("Spaced-repetition memory reset");
  }

  // Keyboard handler
  function handleKeyDown(e) {
    if (drawer || hintOpen || subsetOpen || macPrompt) return;
    const k = e.key;
    if (k === "Backspace") { e.preventDefault(); skipCase(); return; }
    if (k === " ") { e.preventDefault(); validate(); return; }
    if (k === "Escape") { e.preventDefault(); resetAndStop(); return; }
    if (k.toLowerCase() === "h") { e.preventDefault(); hintOpen = true; return; }
    const map = { u: "U", r: "R", f: "F", d: "D", l: "L", b: "B" };
    const face = map[k.toLowerCase()];
    if (face) { e.preventDefault(); doMove(e.shiftKey ? face + "'" : face); }
  }

  // Reactivity for builds
  $: {
    if (mode || settings.scheme || settings.cornerBuffer || settings.edgeBuffer || settings.orientation || settings.disabledCases || settings.flipCounts || settings.twistCounts) {
      buildCase();
    }
  }

  $: {
    if (NEW_CATEGORIES.includes(mode)) {
      if (categoryCacheRef[mode]) {
        buildCase();
      } else {
        catState = { loading: true, error: null };
        loadCategoryCases(mode)
          .then((rec) => {
            categoryCacheRef[mode] = rec;
            catState = { loading: false, error: null };
            buildCase();
          })
          .catch((e) => {
            catState = { loading: false, error: e.message || String(e) };
          });
      }
    }
  }

  onMount(() => {
    window.addEventListener("resize", handleResize);
    window.addEventListener("keydown", handleKeyDown);

    window.__trainer = {
      getState: () => cubeStateRef,
      getTarget: () => targetRef,
      getSuccess: () => successRef,
      isTimerPaused: () => isTimerPausedRef,
      togglePauseTimer: () => togglePauseTimer(),
      solveCurrent: () => { if (targetRef) onStateChanged(targetRef); },
      openMacPrompt: () => new Promise((resolve) => { macPrompt = { deviceName: "GAN-TEST", resolve }; }),
      feedFacelets: (f) => handleFacelets(f),
      markSolved: () => resetCube(),
    };
    window.__cube = { SOLVED, applyMove, applyAlg, scramble };

    buildCase();
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("keydown", handleKeyDown);
    }
  });

  $: avgMs = session.times.length ? session.times.reduce((a, b) => a + b, 0) / session.times.length : 0;
  $: lastMs = session.times.length ? session.times[session.times.length - 1] : 0;
  $: elapsedMin = (Date.now() - sessionStartRef) / 60000;
  $: cpm = elapsedMin > 0.05 ? session.solved / elapsedMin : 0;
  $: pairText = pair ? (pair.display != null ? pair.display : `${pair.t1}${pair.t2}`.toUpperCase()) : (catState.loading ? "…" : "--");
  $: flashColor = flash === "ok" ? "var(--success)" : flash === "err" ? "var(--error)" : "#fff";

  function pillStyle(color) {
    return `display: flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 99px; border: 1px solid ${color}; background: var(--surface); color: #fff; cursor: pointer; font-size: 13px;`;
  }
  const iconBtn = "display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: #fff; cursor: pointer;";
  const ghostBtn = "display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: #A1A1AA; cursor: pointer; font-size: 13px; font-family: 'JetBrains Mono', monospace;";
  const moveBtn = "min-width: 40px; padding: 7px 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); color: #fff; cursor: pointer; font-family: 'JetBrains Mono', monospace; font-size: 14px; font-weight: 700;";
  const selectStyle = "padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 14px;";
</script>

<div class="noise" style="min-height: 100dvh; display: flex; flex-direction: column; position: relative; overflow-x: hidden;">
  <Toaster />

  <!-- Top bar -->
  <header style="position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; row-gap: 10px; padding: {isMobile ? '10px 12px' : '16px 20px'}; border-bottom: 1px solid var(--line);">
    <div style="display: flex; align-items: center; gap: 12px; order: {isMobile ? 1 : 0};">
      <button
        data-testid="bluetooth-connect-btn"
        on:click={handleConnect}
        class="font-mono"
        style={pillStyle(btStatus === "connected" ? "var(--success)" : btStatus === "connecting" ? "#FFD500" : "var(--error)")}
      >
        <span style="width: 8px; height: 8px; border-radius: 99px; background: {btStatus === 'connected' ? 'var(--success)' : btStatus === 'connecting' ? '#FFD500' : 'var(--error)'}; box-shadow: 0 0 8px {btStatus === 'connected' ? 'var(--success)' : 'var(--error)'};"></span>
        {#if btStatus === "connected"}
          <BluetoothConnected size={15} />
        {:else}
          <Bluetooth size={15} />
        {/if}
        <span data-testid="bluetooth-status-text">
          {btStatus === "connected" ? (cubeName || "Connected") : btStatus === "connecting" ? "Connecting…" : "Connect Cube"}
        </span>
      </button>
      {#if battery != null}
        <span class="font-mono" data-testid="battery-level" style="display: flex; align-items: center; gap: 4px; font-size: 13px; color: #A1A1AA;">
          <BatteryMedium size={15} /> {battery}%
        </span>
      {/if}
    </div>

    <!-- mode switcher -->
    <div data-testid="mode-switcher" style="display: flex; border: 1px solid var(--line); border-radius: 10px; overflow: visible; background: var(--surface); {isMobile ? 'order: 3; flex-basis: 100%; justify-content: center;' : ''}">
      {#each ["corners", "edges"] as m, idx}
        <button
          data-testid="mode-{m}"
          on:click={() => { mode = m; }}
          class="overline font-head"
          style="padding: {isMobile ? '10px 0' : '8px 18px'}; flex: {isMobile ? 1 : 'none'}; font-size: 13px; letter-spacing: 0.15em; cursor: pointer; background: {mode === m ? 'var(--surface-2)' : 'transparent'}; color: {mode === m ? '#fff' : '#7a7a7a'}; border: none; border-radius: {mode === m && idx === 0 ? '9px 0 0 9px' : '0px'}; box-shadow: {mode === m ? 'inset 0 0 0 1px var(--active)' : 'none'};"
        >{m}</button>
      {/each}

      <!-- ModeDropdown inline -->
      <div style="position: relative; display: flex; flex: {isMobile ? 1 : 'none'};">
        <button
          data-testid="mode-more-btn"
          on:click={() => { drawer = drawer === 'mode-menu' ? null : 'mode-menu'; }}
          class="overline font-head"
          style="padding: {isMobile ? '10px 8px' : '8px 14px'}; flex: {isMobile ? 1 : 'none'}; width: {isMobile ? '100%' : 'auto'}; display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 13px; letter-spacing: 0.12em; cursor: pointer; white-space: nowrap; background: {NEW_CATEGORIES.includes(mode) ? 'var(--surface-2)' : 'transparent'}; color: {NEW_CATEGORIES.includes(mode) ? '#fff' : '#7a7a7a'}; border: none; border-radius: 0 9px 9px 0; box-shadow: {NEW_CATEGORIES.includes(mode) ? 'inset 0 0 0 1px var(--active)' : 'none'};"
        >
          {NEW_CATEGORIES.includes(mode) ? CATEGORY_META[mode].short : "MORE"} <ChevronDown size={14} />
        </button>
        {#if drawer === 'mode-menu'}
          <div data-testid="mode-more-menu" class="theme-scroll" style="position: absolute; top: calc(100% + 6px); right: 0; z-index: 80; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 6px; min-width: 190px; box-shadow: 0 8px 24px rgba(0,0,0,0.45);">
            {#each NEW_CATEGORIES as c}
              <button
                data-testid="mode-{c}"
                on:click={() => { mode = c; drawer = null; }}
                class="font-mono"
                style="display: block; width: 100%; text-align: left; padding: 9px 10px; font-size: 13px; cursor: pointer; border: none; border-radius: 8px; background: {mode === c ? 'var(--surface)' : 'transparent'}; color: {mode === c ? '#fff' : '#A1A1AA'};"
              >
                {CATEGORY_META[c].label}
              </button>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div style="display: flex; gap: 8px; order: {isMobile ? 2 : 0};">
      <button data-testid="open-stats-btn" on:click={() => { drawer = "stats"; }} style={iconBtn}><BarChart3 size={18} /></button>
      <button data-testid="open-settings-btn" on:click={() => { drawer = "settings"; }} style={iconBtn}><SettingsIcon size={18} /></button>
    </div>
  </header>

  <!-- Center -->
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
  <main data-testid="trainer-main" on:click={handleScreenTap} style="position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: clamp(10px, 2vh, 20px); padding: clamp(10px, 1.5vh, 16px); min-height: 0; cursor: pointer;">
    <div class="overline" style="color: #52525B; font-size: 12px; border-top: 1px solid var(--line); padding-top: 8px;">
      {NEW_CATEGORIES.includes(mode)
        ? `${CATEGORY_META[mode].short} · ${(SCHEMES[settings.scheme] || SCHEMES.speffz).name}`
        : `${mode === "corners" ? "CORNER 3-STYLE" : "EDGE 3-STYLE"} · BUFFER ${(mode === "corners" ? settings.cornerBuffer : settings.edgeBuffer).toUpperCase()} · ${(SCHEMES[settings.scheme] || SCHEMES.speffz).name}`}
    </div>

    <div
      data-testid="letter-pair-display"
      class="font-mono {flash === 'ok' ? 'popok' : flash === 'err' ? 'shake' : ''}"
      style="font-size: clamp(5rem, 15vw, 18rem); line-height: 1; font-weight: 800; letter-spacing: -0.04em; color: {flashColor};"
    >
      {pairText}
    </div>

    <!-- Recognition Timer component -->
    <RecognitionTimer
      {caseStartRef}
      {caseStoppedRef}
      pairKey={pairText}
      isPaused={isTimerPaused}
    />

    <CubeNet state={netState} {highlights} orientation={settings.orientation} />

    <div style="display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; align-items: center;">
      <button data-testid="skip-btn" on:click={skipCase} style={ghostBtn}><SkipForward size={15} /> Skip (Backspace)</button>
      <button data-testid="hint-btn" on:click={() => { hintOpen = true; }} style="{ghostBtn} border-color: var(--active); color: #fff;"><Lightbulb size={15} /> Hint (H)</button>
      <button data-testid="reset-cube-btn" on:click={resetCube} style={ghostBtn}><RotateCcw size={15} /> Cube Solved</button>
      <button
        data-testid="toggle-pause-btn"
        on:click={togglePauseTimer}
        title={isTimerPaused ? "Resume timer" : "Pause timer"}
        aria-label={isTimerPaused ? "Resume timer" : "Pause timer"}
        style="{ghostBtn} width: 36px; height: 36px; padding: 0; justify-content: center; border-color: {isTimerPaused ? '#F59E0B' : 'var(--line)'}; color: {isTimerPaused ? '#F59E0B' : '#A1A1AA'};"
      >
        {#if isTimerPaused}
          <Play size={15} />
        {:else}
          <Pause size={15} />
        {/if}
      </button>
    </div>

    <div data-testid="trainer-help" class="overline" style="color: #3f3f46; font-size: 11px; text-align: center; line-height: 1.7; letter-spacing: 0.06em;">
      Tap screen / Space = validate · Double-tap / Esc = reset timer · Backspace = skip
    </div>
  </main>

  <!-- Manual controls -->
  {#if settings.showManual}
    <div data-testid="manual-controls" style="position: relative; z-index: 2; border-top: 1px solid var(--line); padding: 10px 20px; display: flex; align-items: center; justify-content: center; gap: 6px; flex-wrap: wrap; background: var(--surface);">
      <span class="overline" style="color: #52525B; font-size: 11px; margin-right: 8px;"><Keyboard size={13} style="display: inline; margin-right: 4px;" /> Manual</span>
      {#each ["U", "R", "F", "D", "L", "B"] as f}
        <button data-testid="move-{f}" on:click={() => doMove(f)} style={moveBtn}>{f}</button>
        <button data-testid="move-{f}-prime" on:click={() => doMove(f + "'")} style={moveBtn}>{f}'</button>
      {/each}
    </div>
  {/if}

  <!-- HUD -->
  <div data-testid="live-session-hud" style="position: relative; z-index: 2; display: grid; grid-template-columns: {isMobile ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)'}; border-top: 1px solid var(--line); background: var(--bg);">
    <div data-testid="hud-solved" style="padding: 14px 18px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);">
      <div class="overline font-head" style="font-size: 11px; color: #52525B;">Solved</div>
      <div class="font-mono" style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 2px;">{session.solved}</div>
    </div>
    <div data-testid="hud-streak" style="padding: 14px 18px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);">
      <div class="overline font-head" style="font-size: 11px; color: #52525B;">Streak</div>
      <div class="font-mono" style="font-size: 26px; font-weight: 800; color: var(--success); margin-top: 2px;">{session.streak}</div>
    </div>
    <div data-testid="hud-best-streak" style="padding: 14px 18px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);">
      <div class="overline font-head" style="font-size: 11px; color: #52525B;">Best Streak</div>
      <div class="font-mono" style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 2px;">{session.bestStreak}</div>
    </div>
    <div data-testid="hud-time" style="padding: 14px 18px; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line);">
      <div class="overline font-head" style="font-size: 11px; color: #52525B;">Last / Avg</div>
      <div class="font-mono" style="font-size: 18px; font-weight: 800; color: #fff; margin-top: 2px;">{(lastMs / 1000).toFixed(1)}s / {(avgMs / 1000).toFixed(1)}s</div>
    </div>
    <div data-testid="hud-cpm" style="padding: 14px 18px; border-bottom: 1px solid var(--line);">
      <div class="overline font-head" style="font-size: 11px; color: #52525B;">Cases / min</div>
      <div class="font-mono" style="font-size: 26px; font-weight: 800; color: #fff; margin-top: 2px;">{cpm.toFixed(1)}</div>
    </div>
  </div>

  <!-- Drawers: Settings / Stats -->
  {#if drawer === "settings" || drawer === "stats"}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div transition:fade={{ duration: 150 }} on:click={() => { drawer = null; }} style="position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 40;"></div>
    <aside
      data-testid={drawer === "settings" ? "settings-drawer" : "stats-view-container"}
      transition:fly={{ x: 380, duration: 200 }}
      class="theme-scroll"
      style="position: fixed; top: 0; right: 0; bottom: 0; width: 360px; max-width: 90vw; background: var(--surface); border-left: 1px solid var(--line); z-index: 50; padding: 24px; overflow-y: auto;"
    >
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
        <h2 class="font-head" style="font-size: 28px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">{drawer === "settings" ? "Settings" : "Statistics"}</h2>
        <button data-testid="close-drawer-btn" on:click={() => { drawer = null; }} style={iconBtn}><X size={18} /></button>
      </div>

      {#if drawer === "settings"}
        <div style="display: flex; flex-direction: column; gap: 22px;">
          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Lettering scheme</span>
            <select data-testid="scheme-select" bind:value={settings.scheme} on:change={(e) => {
              const s = SCHEMES[e.target.value] || SCHEMES.speffz;
              settings = { ...settings, scheme: e.target.value, cornerBuffer: s.cornerBuffer, edgeBuffer: s.edgeBuffer };
            }} style={selectStyle}>
              {#each Object.entries(SCHEMES) as [k, v]}
                <option value={k}>{v.name}</option>
              {/each}
            </select>
          </label>

          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Cube orientation</span>
            <div style="display: flex; gap: 10px;">
              <div style="flex: 1;">
                <span class="font-mono" style="font-size: 10px; color: #52525B; display: block; margin-bottom: 4px;">Top face</span>
                <select data-testid="orientation-top-select" bind:value={settings.orientation.top} on:change={(e) => {
                  const top = e.target.value;
                  const front = (top !== settings.orientation.front && OPPOSITE_COLOR[top] !== settings.orientation.front)
                    ? settings.orientation.front
                    : CUBE_COLORS.find((c) => c !== top && c !== OPPOSITE_COLOR[top]);
                  settings = { ...settings, orientation: { top, front } };
                }} style={selectStyle}>
                  {#each CUBE_COLORS as c}
                    <option value={c}>{COLOR_LABEL[c]}</option>
                  {/each}
                </select>
              </div>
              <div style="flex: 1;">
                <span class="font-mono" style="font-size: 10px; color: #52525B; display: block; margin-bottom: 4px;">Front face</span>
                <select data-testid="orientation-front-select" bind:value={settings.orientation.front} style={selectStyle}>
                  {#each CUBE_COLORS.filter((c) => c !== settings.orientation.top && c !== OPPOSITE_COLOR[settings.orientation.top]) as c}
                    <option value={c}>{COLOR_LABEL[c]}</option>
                  {/each}
                </select>
              </div>
            </div>
            <span class="font-mono" style="font-size: 11px; color: #52525B;">
              How you hold the cube while lettering. Default: white top, green front.
            </span>
          </label>

          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Corner buffer</span>
            <select data-testid="corner-buffer-select" bind:value={settings.cornerBuffer} style={selectStyle}>
              {#each Object.keys((SCHEMES[settings.scheme] || SCHEMES.speffz).corner).sort() as l}
                <option value={l}>{l}</option>
              {/each}
            </select>
          </label>

          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Edge buffer</span>
            <select data-testid="edge-buffer-select" bind:value={settings.edgeBuffer} style={selectStyle}>
              {#each Object.keys((SCHEMES[settings.scheme] || SCHEMES.speffz).edge).sort() as l}
                <option value={l}>{l.toUpperCase()}</option>
              {/each}
            </select>
          </label>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Sound feedback</span>
            <button data-testid="sound-toggle" aria-label="Toggle sound feedback" on:click={() => { settings.sound = !settings.sound; }} style="width: 46px; height: 26px; border-radius: 99px; border: 1px solid var(--line); background: {settings.sound ? 'var(--active)' : 'var(--surface-2)'}; position: relative; cursor: pointer;">
              <span style="position: absolute; top: 2px; left: {settings.sound ? '22px' : '2px'}; width: 20px; height: 20px; border-radius: 99px; background: #fff; transition: left 120ms ease;"></span>
            </button>
          </div>

          <div style="display: flex; align-items: center; justify-content: space-between;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Show manual move buttons</span>
            <button data-testid="manual-toggle" aria-label="Toggle manual move buttons" on:click={() => { settings.showManual = !settings.showManual; }} style="width: 46px; height: 26px; border-radius: 99px; border: 1px solid var(--line); background: {settings.showManual ? 'var(--active)' : 'var(--surface-2)'}; position: relative; cursor: pointer;">
              <span style="position: absolute; top: 2px; left: {settings.showManual ? '22px' : '2px'}; width: 20px; height: 20px; border-radius: 99px; background: #fff; transition: left 120ms ease;"></span>
            </button>
          </div>

          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Case distribution</span>
            <select data-testid="distribution-select" bind:value={settings.distribution} style={selectStyle}>
              <option value="uniform">Uniform (random)</option>
              <option value="spaced">Spaced repetition (FSRS)</option>
            </select>
            <span class="font-mono" style="font-size: 11px; color: #52525B;">
              Spaced repetition shows slower / less-recalled cases more often, graded from your solve time.
            </span>
          </label>

          {#if settings.distribution === "spaced"}
            <label style="display: flex; flex-direction: column; gap: 8px;">
              <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Timeout (case not counted above this)</span>
              <div style="display: flex; align-items: center; gap: 10px;">
                <input
                  data-testid="sr-timeout-input"
                  type="number" min="1" max="120" step="1"
                  value={Math.round((settings.srTimeoutMs || 10000) / 1000)}
                  on:input={(e) => {
                    const v = Math.max(1, Math.min(120, Number(e.target.value) || 10));
                    settings.srTimeoutMs = v * 1000;
                  }}
                  style="{selectStyle} width: 90px; box-sizing: border-box;"
                />
                <span class="font-mono" style="font-size: 12px; color: #A1A1AA;">seconds</span>
              </div>
              <span class="font-mono" style="font-size: 11px; color: #52525B;">
                If a solve takes longer, it won't update the schedule (the case stays due).
              </span>
            </label>
            <button data-testid="reset-schedule-btn" on:click={resetSchedule} style="{ghostBtn} justify-content: center;">Reset spaced-repetition memory</button>
          {/if}

          <div>
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA; display: block; margin-bottom: 8px;">Case subset</span>
            <button data-testid="open-subset-btn" on:click={() => { subsetOpen = true; }} style="{moveBtn} width: 100%; padding: 11px 14px; display: flex; align-items: center; justify-content: center; gap: 8px; background: var(--surface-2);">
              <Grid3X3 size={15} /> Select case subset & flip/twist counts
            </button>
            <span class="font-mono" style="font-size: 11px; color: #52525B; margin-top: 6px; display: block;">
              Corners/edges: pick which target pairs get drilled. Flips/twists: pick how many pieces per case.
            </span>
          </div>

          <label style="display: flex; flex-direction: column; gap: 8px;">
            <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Cube MAC address (GAN / MoYu / QiYi)</span>
            <input
              data-testid="settings-mac-input"
              bind:value={settings.macAddress}
              placeholder="AA:BB:CC:DD:EE:FF (optional)"
              style="{selectStyle} width: 100%; box-sizing: border-box; letter-spacing: 0.06em;"
            />
            <span class="font-mono" style="font-size: 11px; color: #52525B;">
              Saved MAC is used automatically when connecting. Leave empty to auto-detect / be prompted.
              Tip: on Chrome/Edge you can read it at <code style="user-select: all; color: var(--active);">chrome://bluetooth-internals</code> → Devices → Scan.
            </span>
          </label>

          <button data-testid="reset-stats-btn" on:click={() => { confirmReset = true; }} style="{ghostBtn} border-color: var(--error); color: var(--error); justify-content: center; margin-top: 8px;">Reset all statistics</button>
          <p class="font-mono" style="color: #52525B; font-size: 12px; line-height: 1.6;">
            Execute the commutator for the shown pair on your cube. When the cube reaches the resulting state, the next pair appears automatically. No cube? Use the manual move buttons or keyboard (U R F D L B, hold Shift for prime).
          </p>
          <a data-testid="github-link" href="https://github.com/Tijoxa/3-style-drill" target="_blank" rel="noreferrer"
            title="View source on GitHub"
            style="display: inline-flex; align-items: center; gap: 6px; color: #52525B; text-decoration: none; margin-top: 4px; font-size: 11px; font-family: 'JetBrains Mono', monospace; align-self: flex-start;">
            <Github size={14} /> Source on GitHub
          </a>
        </div>
      {:else}
        <!-- Stats panel -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
          <div data-testid="stat-total" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Total cases</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">{lifetime.totalCases}</div>
          </div>
          <div data-testid="stat-best-streak" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Best streak</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">{lifetime.bestStreak}</div>
          </div>
          <div data-testid="stat-time" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Time trained</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">{(lifetime.totalTimeMs / 3600000).toFixed(1)}h</div>
          </div>
          <div data-testid="stat-best-day" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Best day</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">
              {Object.entries(lifetime.perDay || {}).reduce((m, [d, c]) => (c > m.c ? { d, c } : m), { d: "-", c: 0 }).c}
            </div>
            <div class="font-mono" style="font-size: 11px; color: #52525B;">
              {Object.entries(lifetime.perDay || {}).reduce((m, [d, c]) => (c > m.c ? { d, c } : m), { d: "-", c: 0 }).d}
            </div>
          </div>
          <div data-testid="stat-session" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Session solved</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">{session.solved}</div>
          </div>
          <div data-testid="stat-session-avg" style="border: 1px solid var(--line); border-radius: 10px; padding: 16px; background: var(--bg);">
            <div class="overline font-head" style="font-size: 10px; color: #52525B;">Session avg</div>
            <div class="font-head" style="font-size: 40px; font-weight: 900; line-height: 1.1;">{(avgMs / 1000).toFixed(1)}s</div>
          </div>
        </div>
      {/if}
    </aside>
  {/if}

  <!-- MAC address prompt modal -->
  {#if macPrompt}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div transition:fade={{ duration: 150 }} style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 60;"></div>
    <div
      data-testid="mac-modal"
      transition:scale={{ start: 0.96, duration: 150 }}
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 440px; max-width: 94vw; max-height: 92dvh; overflow-y: auto; box-sizing: border-box; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: {isMobile ? '18px' : '26px'}; z-index: 61;"
    >
      <h2 class="font-head" style="font-size: 26px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">Enter Cube MAC Address</h2>
      <p class="font-mono" style="color: #A1A1AA; font-size: 12.5px; line-height: 1.7; margin-top: 10px;">
        Your browser couldn't read the MAC of <b style="color: #fff;">{macPrompt.deviceName || "your cube"}</b> automatically.
        GAN / MoYu / QiYi cubes need it for decryption. Find it in your cube's official app
        (GAN: Cube Station → cube settings), then enter it below.
      </p>
      <div class="font-mono" style="margin-top: 10px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface-2); font-size: 12px; line-height: 1.7; color: #A1A1AA;">
        <b style="color: #fff;">Tip (Chrome/Edge):</b> open a new tab, go to
        <code data-testid="mac-tip-url" style="user-select: all; color: var(--active); font-weight: 700;">chrome://bluetooth-internals</code>,
        open the <b style="color: #fff;">Devices</b> tab, click <b style="color: #fff;">Scan</b>, find your cube and read its <b style="color: #fff;">Address</b>.
      </div>
      <input
        data-testid="mac-input"
        placeholder="AA:BB:CC:DD:EE:FF"
        on:keydown={(e) => { if (e.key === "Enter" && /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(e.target.value.trim())) submitMac(e.target.value.trim().toUpperCase()); }}
        style="{selectStyle} width: 100%; margin-top: 16px; letter-spacing: 0.08em; box-sizing: border-box;"
      />
      <div style="display: flex; gap: 10px; margin-top: 22px; justify-content: flex-end; flex-wrap: wrap;">
        <button data-testid="mac-cancel-btn" on:click={() => submitMac(null)} style={ghostBtn}>Cancel</button>
        <button data-testid="mac-submit-btn" on:click={() => {
          const inp = document.querySelector('[data-testid="mac-input"]');
          if (inp && /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(inp.value.trim())) submitMac(inp.value.trim().toUpperCase());
        }} style="{moveBtn} min-width: 120px; padding: 9px 18px; background: var(--active); border-color: var(--active);">
          Connect
        </button>
      </div>
    </div>
  {/if}

  <!-- Confirm reset dialog -->
  {#if confirmReset}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div transition:fade={{ duration: 150 }} on:click={() => { confirmReset = false; }} style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 80;"></div>
    <div
      data-testid="confirm-dialog"
      transition:scale={{ start: 0.96, duration: 150 }}
      style="position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: 440px; max-width: 94vw; max-height: 92dvh; overflow-y: auto; box-sizing: border-box; background: var(--surface); border: 1px solid var(--error); border-radius: 14px; padding: {isMobile ? '20px' : '26px'}; z-index: 81;"
    >
      <div style="display: flex; align-items: center; gap: 12px;">
        <AlertTriangle size={22} style="color: var(--error); flex-shrink: 0;" />
        <h2 class="font-head" style="font-size: 22px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">Delete all statistics?</h2>
      </div>
      <p class="font-mono" style="color: #A1A1AA; font-size: 13px; line-height: 1.7; margin-top: 14px;">
        This permanently removes all locally-stored statistics from this browser (total cases, best streak, time and daily history). This cannot be undone.
      </p>
      <div style="display: flex; gap: 10px; margin-top: 24px; justify-content: flex-end; flex-wrap: wrap;">
        <button data-testid="confirm-cancel-btn" on:click={() => { confirmReset = false; }} style={ghostBtn}>Cancel</button>
        <button data-testid="confirm-accept-btn" on:click={resetStats} style="{moveBtn} min-width: 140px; padding: 9px 18px; background: var(--error); border-color: var(--error); color: #fff;">
          Delete everything
        </button>
      </div>
    </div>
  {/if}

  <!-- Hint modal -->
  {#if hintOpen && pair}
    <HintModal
      {pair}
      {pairText}
      buffer={mode === "corners" ? (settings.cornerBuffer || "C") : (mode === "edges" ? (settings.edgeBuffer || "c") : "")}
      maps={getMaps(settings.scheme, settings.orientation)}
      style={NEW_CATEGORIES.includes(mode) ? (settings.catStyle || "nightmare") : (pair.type === "corner" ? settings.cornerStyle : settings.edgeStyle)}
      setStyle={(v) => {
        if (NEW_CATEGORIES.includes(mode)) settings = { ...settings, catStyle: v };
        else if (pair.type === "corner") settings = { ...settings, cornerStyle: v };
        else settings = { ...settings, edgeStyle: v };
      }}
      onClose={() => { hintOpen = false; }}
    />
  {/if}

  <!-- Subset modal -->
  {#if subsetOpen}
    <SubsetModal
      {settings}
      setSettings={(updater) => { settings = typeof updater === "function" ? updater(settings) : updater; }}
      initialView={MODE_TO_SUBSET_VIEW[mode] || "corner"}
      onClose={() => { subsetOpen = false; }}
    />
  {/if}
</div>
