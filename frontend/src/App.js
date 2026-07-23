import "./App.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Bluetooth, BluetoothConnected, Settings as SettingsIcon, BarChart3,
  X, RotateCcw, SkipForward, Keyboard, BatteryMedium, Lightbulb, ExternalLink, Loader2, Grid3X3, Github,
} from "lucide-react";
import {
  SOLVED, applyMove, applyAlg, scramble, apply3Cycle, letterPieceId, relativeState, SCHEMES,
} from "./lib/cube.mjs";
import { connect as btConnect, disconnect as btDisconnect, isBluetoothSupported } from "./lib/smartcube";
import { fetchHints, STYLE_OPTIONS } from "./lib/blddb";
import CubeNet from "./components/CubeNet";

const STATS_KEY = "bld3style_stats_v1";
const SETTINGS_KEY = "bld3style_settings_v1";
const facelet = (l, type, maps) => (type === "corner" ? maps.corner : maps.edge)[l];
const today = () => new Date().toISOString().slice(0, 10);

function loadJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v || fallback; } catch { return fallback; }
}
function useIsMobile(bp = 640) {
  const [m, setM] = useState(typeof window !== "undefined" && window.innerWidth < bp);
  useEffect(() => {
    const on = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [bp]);
  return m;
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

const defaultSettings = { scheme: "speffz", cornerBuffer: "C", edgeBuffer: "c", sound: true, showManual: false, macAddress: "", cornerStyle: "nightmare", edgeStyle: "nightmare", disabledCases: {} };
const caseKey = (scheme, type, t1, t2) => `${scheme}:${type}:${t1}:${t2}`;

export default function App() {
  const [mode, setMode] = useState("corners");
  const isMobile = useIsMobile();
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...loadJSON(SETTINGS_KEY, {}) }));
  const [pair, setPair] = useState(null);
  const [highlights, setHighlights] = useState({});
  const [netState, setNetState] = useState(SOLVED);
  const [flash, setFlash] = useState(null);
  const [btStatus, setBtStatus] = useState("disconnected");
  const [cubeName, setCubeName] = useState("");
  const [battery, setBattery] = useState(null);
  const [drawer, setDrawer] = useState(null); // 'settings' | 'stats' | null
  const [macPrompt, setMacPrompt] = useState(null); // { deviceName, resolve } | null
  const [hintOpen, setHintOpen] = useState(false);
  const [subsetOpen, setSubsetOpen] = useState(false);
  const [lifetime, setLifetime] = useState(() => loadJSON(STATS_KEY, { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} }));

  const [session, setSession] = useState({ solved: 0, streak: 0, bestStreak: 0, times: [] });
  const sessionStartRef = useRef(Date.now());

  const cubeStateRef = useRef(SOLVED);
  const streakRef = useRef(0);
  const successRef = useRef(0);
  const targetRef = useRef(null);
  const caseStartRef = useRef(null);
  const caseStartedRef = useRef(false);
  const caseStoppedRef = useRef(null);
  const noMoveTimeoutRef = useRef(null);
  const modeRef = useRef(mode);
  const settingsRef = useRef(settings);
  const busyRef = useRef(false);
  const refFaceletsRef = useRef(null);   // cube facelets when last declared "solved"
  const rawFaceletsRef = useRef(SOLVED); // last raw facelets from the cube
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  const buildCase = useCallback((startImmediately = false) => {
    if (noMoveTimeoutRef.current) { clearTimeout(noMoveTimeoutRef.current); noMoveTimeoutRef.current = null; }
    const m = modeRef.current;
    const s = settingsRef.current;
    const maps = SCHEMES[s.scheme] || SCHEMES.speffz;
    const type = m === "corners" ? "corner" : "edge";
    const list = Object.keys(type === "corner" ? maps.corner : maps.edge);
    const buffer = type === "corner" ? s.cornerBuffer : s.edgeBuffer;
    const bufPiece = letterPieceId(buffer, type, maps);
    const cands = list.filter((l) => letterPieceId(l, type, maps) !== bufPiece);
    const disabled = s.disabledCases || {};
    // All valid, currently-enabled ordered target pairs.
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
      targetRef.current = null;
      caseStartRef.current = null;
      caseStartedRef.current = false;
      caseStoppedRef.current = null;
      setPair(null);
      setHighlights({});
      return;
    }
    const cur = cubeStateRef.current;
    for (let tries = 0; tries < 200; tries++) {
      const [t1, t2] = validPairs[Math.floor(Math.random() * validPairs.length)];
      const target = apply3Cycle(cur, [buffer, t1, t2], type, maps);
      if (target !== cur) {
        targetRef.current = target;
        caseStoppedRef.current = null;
        if (startImmediately) {
          // After finishing a pair: timer runs right away (don't wait for first move).
          caseStartedRef.current = true;
          caseStartRef.current = Date.now();
        } else {
          // First load / mode switch / skip: wait for the first move.
          caseStartedRef.current = false;
          caseStartRef.current = null;
        }
        // Stop (freeze) the chrono if no move is made for 30s.
        noMoveTimeoutRef.current = setTimeout(() => {
          caseStoppedRef.current = (caseStartedRef.current && caseStartRef.current) ? Date.now() - caseStartRef.current : 0;
          noMoveTimeoutRef.current = null;
        }, 30000);
        setPair({ t1, t2, type });
        setHighlights({ bufferIdx: facelet(buffer, type, maps), t1Idx: facelet(t1, type, maps), t2Idx: facelet(t2, type, maps) });
        return;
      }
    }
  }, []);

  const onSuccess = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const elapsed = caseStoppedRef.current != null ? caseStoppedRef.current : (caseStartRef.current ? Date.now() - caseStartRef.current : 0);
    if (settingsRef.current.sound) beep(880, true);
    setFlash("ok");
    const newStreak = streakRef.current + 1;
    streakRef.current = newStreak;
    successRef.current += 1;
    setSession((prev) => ({
      solved: prev.solved + 1,
      streak: newStreak,
      bestStreak: Math.max(prev.bestStreak, newStreak),
      times: [...prev.times, elapsed].slice(-500),
    }));
    setLifetime((prev) => {
      const d = today();
      const perDay = { ...prev.perDay, [d]: (prev.perDay[d] || 0) + 1 };
      const next = {
        totalCases: prev.totalCases + 1,
        totalTimeMs: prev.totalTimeMs + elapsed,
        bestStreak: Math.max(prev.bestStreak, newStreak),
        perDay,
      };
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
      return next;
    });
    setTimeout(() => setFlash(null), 180);
    setTimeout(() => { buildCase(true); busyRef.current = false; }, 60);
  }, [buildCase]);

  const onStateChanged = useCallback((newState) => {
    const prev = cubeStateRef.current;
    cubeStateRef.current = newState;
    setNetState(newState);
    // A real move: cancel the inactivity timeout; start the timer if it was waiting.
    if (newState !== prev && !busyRef.current) {
      if (noMoveTimeoutRef.current) { clearTimeout(noMoveTimeoutRef.current); noMoveTimeoutRef.current = null; }
      if (!caseStartedRef.current && caseStoppedRef.current == null) {
        caseStartedRef.current = true;
        caseStartRef.current = Date.now();
      }
    }
    if (targetRef.current && newState === targetRef.current) onSuccess();
  }, [onSuccess]);

  const handleFacelets = useCallback((f) => {
    if (!f || f.length !== 54) return;
    rawFaceletsRef.current = f;
    if (!refFaceletsRef.current) refFaceletsRef.current = f;
    onStateChanged(relativeState(refFaceletsRef.current, f));
  }, [onStateChanged]);

  const doMove = useCallback((move) => {
    onStateChanged(applyMove(cubeStateRef.current, move));
  }, [onStateChanged]);

  const resetCube = useCallback(() => {
    // Re-declare the current physical cube as the solved reference (floating reference).
    // Detection & display are computed relative to this, so nothing "unsolves" afterward.
    refFaceletsRef.current = rawFaceletsRef.current;
    cubeStateRef.current = SOLVED;
    setNetState(SOLVED);
    buildCase();
    toast.success("Cube set as solved");
  }, [buildCase]);

  const skipCase = useCallback(() => {
    if (settingsRef.current.sound) beep(200, false);
    setFlash("err");
    streakRef.current = 0;
    setSession((p) => ({ ...p, streak: 0 }));
    setTimeout(() => setFlash(null), 280);
    buildCase();
  }, [buildCase]);

  // init first case + rebuild on mode / scheme / buffer change
  useEffect(() => { buildCase(); /* eslint-disable-next-line */ }, [mode, settings.scheme, settings.cornerBuffer, settings.edgeBuffer, settings.disabledCases]);

  // test/debug hook: lets automated tests simulate execution / cube facelets without Bluetooth
  useEffect(() => {
    window.__trainer = {
      getState: () => cubeStateRef.current,
      getTarget: () => targetRef.current,
      getSuccess: () => successRef.current,
      solveCurrent: () => { if (targetRef.current) onStateChanged(targetRef.current); },
      openMacPrompt: () => new Promise((resolve) => setMacPrompt({ deviceName: "GAN-TEST", resolve })),
      feedFacelets: (f) => handleFacelets(f),
      markSolved: () => resetCube(),
    };
    window.__cube = { SOLVED, applyMove, applyAlg, scramble };
  }, [onStateChanged, handleFacelets, resetCube]);

  // keyboard controls
  useEffect(() => {
    const handler = (e) => {
      if (drawer || hintOpen || subsetOpen) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); skipCase(); return; }
      if (k.toLowerCase() === "h") { e.preventDefault(); setHintOpen(true); return; }
      const map = { u: "U", r: "R", f: "F", d: "D", l: "L", b: "B" };
      const face = map[k.toLowerCase()];
      if (face) { e.preventDefault(); doMove(e.shiftKey ? face + "'" : face); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doMove, skipCase, drawer, hintOpen, subsetOpen]);

  const handleConnect = useCallback(async () => {
    if (btStatus === "connected") { await btDisconnect(); setBtStatus("disconnected"); setCubeName(""); setBattery(null); return; }
    if (!isBluetoothSupported()) { toast.error("Web Bluetooth not supported. Use Chrome or Edge on desktop or Android (not iOS)."); return; }
    setBtStatus("connecting");
    setCubeName("Connecting…");
    refFaceletsRef.current = null; // first facelets snapshot becomes the solved reference
    try {
      const info = await btConnect({
        onMove: (m) => onStateChanged(applyMove(cubeStateRef.current, m)),
        onFacelets: handleFacelets,
        onBattery: (b) => setBattery(b),
        onStatus: (s) => setCubeName(s),
        onDisconnect: () => { setBtStatus("disconnected"); setCubeName(""); setBattery(null); toast("Cube disconnected"); },
        requestMac: (deviceName) => new Promise((resolve) => setMacPrompt({ deviceName, resolve })),
      }, { presetMac: settingsRef.current.macAddress });
      setCubeName(info.name);
      setBtStatus("connected");
      cubeStateRef.current = SOLVED;
      setNetState(SOLVED);
      buildCase();
      toast.success(`Connected: ${info.name}`);
    } catch (e) {
      setBtStatus("disconnected");
      setCubeName("");
      const msg = (e && e.message) ? e.message : String(e);
      if (/cancel|User cancelled|chooser/i.test(msg)) toast("Connection cancelled");
      else if (/mac address/i.test(msg)) toast.error("Could not determine the cube's MAC. Enter it manually in Settings or when prompted.");
      else toast.error(`Connection failed: ${msg}`);
      console.error("Cube connection error:", e);
    }
  }, [btStatus, onStateChanged, handleFacelets, buildCase]);

  const submitMac = useCallback((mac) => {
    if (macPrompt?.resolve) macPrompt.resolve(mac || null);
    setMacPrompt(null);
  }, [macPrompt]);

  const resetStats = () => {
    const empty = { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} };
    localStorage.setItem(STATS_KEY, JSON.stringify(empty));
    setLifetime(empty);
    streakRef.current = 0;
    setSession({ solved: 0, streak: 0, bestStreak: 0, times: [] });
    sessionStartRef.current = Date.now();
    toast.success("Stats reset");
  };

  const avgMs = session.times.length ? session.times.reduce((a, b) => a + b, 0) / session.times.length : 0;
  const lastMs = session.times.length ? session.times[session.times.length - 1] : 0;
  const elapsedMin = (Date.now() - sessionStartRef.current) / 60000;
  const cpm = elapsedMin > 0.05 ? session.solved / elapsedMin : 0;

  const pairText = pair ? `${pair.t1}${pair.t2}`.toUpperCase() : "--";
  const flashColor = flash === "ok" ? "var(--success)" : flash === "err" ? "var(--error)" : "#fff";

  return (
    <div className="noise" style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", position: "relative", overflowX: "hidden" }}>
      <Toaster theme="dark" position="top-center" richColors />

      {/* Top bar */}
      <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", rowGap: 10, padding: isMobile ? "10px 12px" : "16px 20px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, order: isMobile ? 1 : 0 }}>
          <button
            data-testid="bluetooth-connect-btn"
            onClick={handleConnect}
            className="font-mono"
            style={pillStyle(btStatus === "connected" ? "var(--success)" : btStatus === "connecting" ? "#FFD500" : "var(--error)")}
          >
            <span style={{ width: 8, height: 8, borderRadius: 99, background: btStatus === "connected" ? "var(--success)" : btStatus === "connecting" ? "#FFD500" : "var(--error)", boxShadow: `0 0 8px ${btStatus === "connected" ? "var(--success)" : "var(--error)"}` }} />
            {btStatus === "connected" ? <BluetoothConnected size={15} /> : <Bluetooth size={15} />}
            <span data-testid="bluetooth-status-text">{btStatus === "connected" ? (cubeName || "Connected") : btStatus === "connecting" ? "Connecting…" : "Connect Cube"}</span>
          </button>
          {battery != null && (
            <span className="font-mono" data-testid="battery-level" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "#A1A1AA" }}>
              <BatteryMedium size={15} /> {battery}%
            </span>
          )}
        </div>

        {/* mode switcher */}
        <div data-testid="mode-switcher" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)", ...(isMobile ? { order: 3, flexBasis: "100%", justifyContent: "center" } : {}) }}>
          {["corners", "edges"].map((m) => (
            <button
              key={m}
              data-testid={`mode-${m}`}
              onClick={() => setMode(m)}
              className="overline font-head"
              style={{
                padding: isMobile ? "10px 0" : "8px 18px", flex: isMobile ? 1 : "none", fontSize: 13, letterSpacing: "0.15em", cursor: "pointer",
                background: mode === m ? "var(--surface-2)" : "transparent",
                color: mode === m ? "#fff" : "#7a7a7a",
                border: "none", boxShadow: mode === m ? "inset 0 0 0 1px var(--active)" : "none",
              }}
            >{m}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8, order: isMobile ? 2 : 0 }}>
          <button data-testid="open-stats-btn" onClick={() => setDrawer("stats")} style={iconBtn}><BarChart3 size={18} /></button>
          <button data-testid="open-settings-btn" onClick={() => setDrawer("settings")} style={iconBtn}><SettingsIcon size={18} /></button>
        </div>
      </header>

      {/* Center */}
      <main style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 20 }}>
        <div className="overline" style={{ color: "#52525B", fontSize: 12 }}>
          {mode === "corners" ? "CORNER 3-STYLE" : "EDGE 3-STYLE"} · BUFFER {(mode === "corners" ? settings.cornerBuffer : settings.edgeBuffer).toUpperCase()} · {(SCHEMES[settings.scheme] || SCHEMES.speffz).name}
        </div>

        <AnimatePresence mode="popLayout">
          <motion.div
            key={pairText + flash}
            data-testid="letter-pair-display"
            className={`font-mono ${flash === "ok" ? "popok" : flash === "err" ? "shake" : ""}`}
            initial={{ opacity: 0.2, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.08 }}
            style={{ fontSize: "clamp(5rem, 15vw, 18rem)", lineHeight: 1, fontWeight: 800, letterSpacing: "-0.04em", color: flashColor }}
          >
            {pairText}
          </motion.div>
        </AnimatePresence>

        <RecognitionTimer caseStartRef={caseStartRef} caseStoppedRef={caseStoppedRef} pairKey={pairText} />

        <CubeNet state={netState} highlights={highlights} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
          <button data-testid="skip-btn" onClick={skipCase} style={ghostBtn}><SkipForward size={15} /> Skip (Space)</button>
          <button data-testid="hint-btn" onClick={() => setHintOpen(true)} style={{ ...ghostBtn, borderColor: "var(--active)", color: "#fff" }}><Lightbulb size={15} /> Hint (H)</button>
          <button data-testid="reset-cube-btn" onClick={resetCube} style={ghostBtn}><RotateCcw size={15} /> Cube Solved</button>
        </div>
      </main>

      {/* Manual controls */}
      {settings.showManual && (
        <div data-testid="manual-controls" style={{ position: "relative", zIndex: 2, borderTop: "1px solid var(--line)", padding: "10px 20px", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap", background: "var(--surface)" }}>
          <span className="overline" style={{ color: "#52525B", fontSize: 11, marginRight: 8 }}><Keyboard size={13} style={{ display: "inline", marginRight: 4 }} /> Manual</span>
          {["U", "R", "F", "D", "L", "B"].map((f) => (
            <React.Fragment key={f}>
              <button data-testid={`move-${f}`} onClick={() => doMove(f)} style={moveBtn}>{f}</button>
              <button data-testid={`move-${f}-prime`} onClick={() => doMove(f + "'")} style={moveBtn}>{f}'</button>
            </React.Fragment>
          ))}
        </div>
      )}

      {/* HUD */}
      <div data-testid="live-session-hud" style={{ position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: isMobile ? "repeat(2, 1fr)" : "repeat(5, 1fr)", borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
        <Stat label="Solved" value={session.solved} testid="hud-solved" />
        <Stat label="Streak" value={session.streak} accent="var(--success)" testid="hud-streak" />
        <Stat label="Best Streak" value={session.bestStreak} testid="hud-best-streak" />
        <Stat label="Last / Avg" value={`${(lastMs / 1000).toFixed(1)}s / ${(avgMs / 1000).toFixed(1)}s`} testid="hud-time" small />
        <Stat label="Cases / min" value={cpm.toFixed(1)} testid="hud-cpm" last />
      </div>

      {/* Drawers */}
      <AnimatePresence>
        {drawer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setDrawer(null)}
              style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 40 }} />
            <motion.aside
              data-testid={drawer === "settings" ? "settings-drawer" : "stats-view-container"}
              initial={{ x: 380 }} animate={{ x: 0 }} exit={{ x: 380 }} transition={{ type: "tween", duration: 0.2 }}
              style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 360, maxWidth: "90vw", background: "var(--surface)", borderLeft: "1px solid var(--line)", zIndex: 50, padding: 24, overflowY: "auto" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
                <h2 className="font-head" style={{ fontSize: 28, margin: 0, textTransform: "uppercase", letterSpacing: "0.02em" }}>{drawer === "settings" ? "Settings" : "Statistics"}</h2>
                <button data-testid="close-drawer-btn" onClick={() => setDrawer(null)} style={iconBtn}><X size={18} /></button>
              </div>
              {drawer === "settings" ? <SettingsPanel settings={settings} setSettings={setSettings} resetStats={resetStats} onOpenSubset={() => setSubsetOpen(true)} /> : <StatsPanel lifetime={lifetime} session={session} avgMs={avgMs} />}
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* MAC address prompt modal */}
      <AnimatePresence>
        {macPrompt && (
          <MacModal deviceName={macPrompt.deviceName} onSubmit={submitMac} onSaveDefault={(mac) => setSettings((s) => ({ ...s, macAddress: mac }))} />
        )}
      </AnimatePresence>

      {/* Hint modal (blddb.net algorithms) */}
      <AnimatePresence>
        {hintOpen && pair && (
          <HintModal
            pair={pair}
            pairText={pairText}
            buffer={mode === "corners" ? settings.cornerBuffer : settings.edgeBuffer}
            maps={SCHEMES[settings.scheme] || SCHEMES.speffz}
            style={pair.type === "corner" ? settings.cornerStyle : settings.edgeStyle}
            setStyle={(v) => setSettings((s) => (pair.type === "corner" ? { ...s, cornerStyle: v } : { ...s, edgeStyle: v }))}
            onClose={() => setHintOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Case subset selector grid */}
      <AnimatePresence>
        {subsetOpen && (
          <SubsetModal settings={settings} setSettings={setSettings} onClose={() => setSubsetOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

function MacModal({ deviceName, onSubmit, onSaveDefault }) {
  const isMobile = useIsMobile();
  const [mac, setMac] = useState("");
  const [remember, setRemember] = useState(true);
  const valid = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/.test(mac.trim());
  const submit = () => {
    const clean = mac.trim().toUpperCase();
    if (remember) onSaveDefault(clean);
    onSubmit(clean);
  };
  const modalStyle = isMobile
    ? { position: "fixed", top: 12, left: 12, right: 12, width: "auto", maxHeight: "88dvh", overflowY: "auto", boxSizing: "border-box" }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 440, maxWidth: "94vw", maxHeight: "92dvh", overflowY: "auto", boxSizing: "border-box" };
  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 60 }} />
      <motion.div
        data-testid="mac-modal"
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        style={{ ...modalStyle, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: isMobile ? 18 : 26, zIndex: 61 }}
      >
        <h2 className="font-head" style={{ fontSize: 26, margin: 0, textTransform: "uppercase", letterSpacing: "0.02em" }}>Enter Cube MAC Address</h2>
        <p className="font-mono" style={{ color: "#A1A1AA", fontSize: 12.5, lineHeight: 1.7, marginTop: 10 }}>
          Your browser couldn't read the MAC of <b style={{ color: "#fff" }}>{deviceName || "your cube"}</b> automatically.
          GAN / MoYu / QiYi cubes need it for decryption. Find it in your cube's official app
          (GAN: Cube Station → cube settings), then enter it below.
        </p>
        <div className="font-mono" style={{ marginTop: 10, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface-2)", fontSize: 12, lineHeight: 1.7, color: "#A1A1AA" }}>
          <b style={{ color: "#fff" }}>Tip (Chrome/Edge):</b> open a new tab, go to{" "}
          <code data-testid="mac-tip-url" style={{ userSelect: "all", color: "var(--active)", fontWeight: 700 }}>chrome://bluetooth-internals</code>,
          open the <b style={{ color: "#fff" }}>Devices</b> tab, click <b style={{ color: "#fff" }}>Scan</b>, find your cube and read its <b style={{ color: "#fff" }}>Address</b>.
        </div>
        <input
          data-testid="mac-input"
          autoFocus
          value={mac}
          onChange={(e) => setMac(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && valid) submit(); }}
          placeholder="AA:BB:CC:DD:EE:FF"
          style={{ ...selectStyle, width: "100%", marginTop: 16, letterSpacing: "0.08em", boxSizing: "border-box" }}
        />
        {mac && !valid && <div className="font-mono" style={{ color: "var(--error)", fontSize: 11, marginTop: 6 }}>Format: AA:BB:CC:DD:EE:FF</div>}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, cursor: "pointer" }}>
          <input data-testid="mac-remember" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span className="font-mono" style={{ fontSize: 12, color: "#A1A1AA" }}>Remember this MAC address</span>
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 22, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button data-testid="mac-cancel-btn" onClick={() => onSubmit(null)} style={ghostBtn}>Cancel</button>
          <button data-testid="mac-submit-btn" onClick={submit} disabled={!valid}
            style={{ ...moveBtn, minWidth: 120, padding: "9px 18px", opacity: valid ? 1 : 0.4, background: "var(--active)", borderColor: "var(--active)" }}>
            Connect
          </button>
        </div>
      </motion.div>
    </>,
    document.body
  );
}

const SUBSET_COLORS = {
  enabled: "#22C55E",        // green
  disabled: "#3F3F46",       // dark gray
  impossible: "#111114",     // near-black (locked)
  bufferEnabled: "#22C55E",  // green + stripes overlay (dimmed)
  bufferDisabled: "#3F3F46", // dark + stripes overlay (dimmed)
};
const STRIPES = "repeating-linear-gradient(45deg, rgba(255,255,255,0.28) 0 2px, transparent 2px 5px)";

function SubsetModal({ settings, setSettings, onClose }) {
  const isMobile = useIsMobile();
  const scheme = settings.scheme;
  const maps = SCHEMES[scheme] || SCHEMES.speffz;
  const [type, setType] = useState("corner");
  const buffer = type === "corner" ? settings.cornerBuffer : settings.edgeBuffer;
  const letters = useMemo(
    () => Object.keys(type === "corner" ? maps.corner : maps.edge).sort(),
    [type, maps]
  );
  const bufPiece = letterPieceId(buffer, type, maps);
  const pieceOf = useCallback((l) => letterPieceId(l, type, maps), [type, maps]);
  const prefix = `${scheme}:${type}:`;

  // local working set of disabled "t1:t2" keys for the current scheme+type
  const seed = useCallback(() => {
    const w = {};
    Object.keys(settings.disabledCases || {}).forEach((k) => {
      if (k.startsWith(prefix)) w[k.slice(prefix.length)] = true;
    });
    return w;
    // eslint-disable-next-line
  }, [prefix]);
  const [work, setWork] = useState(seed);
  const workRef = useRef(work);
  useEffect(() => { workRef.current = work; }, [work]);
  useEffect(() => { setWork(seed()); /* eslint-disable-next-line */ }, [type, scheme]);

  const commit = useCallback((w) => {
    setSettings((s) => {
      const dc = { ...(s.disabledCases || {}) };
      Object.keys(dc).forEach((k) => { if (k.startsWith(prefix)) delete dc[k]; });
      Object.keys(w).forEach((kk) => { dc[prefix + kk] = true; });
      return { ...s, disabledCases: dc };
    });
  }, [prefix, setSettings]);

  const idxOf = useMemo(() => { const m = {}; letters.forEach((l, i) => { m[l] = i; }); return m; }, [letters]);
  const [drag, setDrag] = useState(null); // { mode, r0, c0, r1, c1 }
  const dragRef = useRef(null);
  useEffect(() => { dragRef.current = drag; }, [drag]);

  const isImpossible = useCallback((t1, t2) => t1 === t2 || pieceOf(t1) === pieceOf(t2), [pieceOf]);
  const isBufferExcluded = useCallback((t1, t2) => pieceOf(t1) === bufPiece || pieceOf(t2) === bufPiece, [pieceOf, bufPiece]);

  const inDragRect = useCallback((t1, t2) => {
    const d = dragRef.current; if (!d) return false;
    const r = idxOf[t1], c = idxOf[t2];
    return r >= Math.min(d.r0, d.r1) && r <= Math.max(d.r0, d.r1) && c >= Math.min(d.c0, d.c1) && c <= Math.max(d.c0, d.c1);
  }, [idxOf]);

  const effDisabled = useCallback((t1, t2) => {
    const d = dragRef.current;
    if (d && inDragRect(t1, t2) && !isImpossible(t1, t2)) return d.mode === "disable";
    return !!work[`${t1}:${t2}`];
  }, [inDragRect, work, isImpossible]);

  const startDrag = useCallback((t1, t2) => {
    if (isImpossible(t1, t2)) return;
    const mode = workRef.current[`${t1}:${t2}`] ? "enable" : "disable";
    setDrag({ mode, r0: idxOf[t1], c0: idxOf[t2], r1: idxOf[t1], c1: idxOf[t2] });
  }, [idxOf, isImpossible]);

  const extendDrag = useCallback((t1, t2) => {
    const r = idxOf[t1], c = idxOf[t2];
    if (r == null || c == null) return;
    setDrag((d) => (d && (d.r1 !== r || d.c1 !== c) ? { ...d, r1: r, c1: c } : d));
  }, [idxOf]);

  // Commit the rectangle to the working set on pointer release.
  useEffect(() => {
    const finish = () => {
      const d = dragRef.current; if (!d) return;
      setWork((w) => {
        const n = { ...w };
        const rlo = Math.min(d.r0, d.r1), rhi = Math.max(d.r0, d.r1);
        const clo = Math.min(d.c0, d.c1), chi = Math.max(d.c0, d.c1);
        for (let r = rlo; r <= rhi; r++) for (let c = clo; c <= chi; c++) {
          const t1 = letters[r], t2 = letters[c];
          if (isImpossible(t1, t2)) continue;
          const k = `${t1}:${t2}`;
          if (d.mode === "disable") n[k] = true; else delete n[k];
        }
        commit(n);
        return n;
      });
      setDrag(null);
    };
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => { window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); };
  }, [commit, letters, isImpossible]);

  // Touch/mouse: pointer capture blocks pointerenter on other cells, so track via elementFromPoint.
  useEffect(() => {
    const move = (e) => {
      if (!dragRef.current) return;
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const cellEl = el && el.closest ? el.closest("[data-subcell]") : null;
      if (cellEl && cellEl.dataset.t1) extendDrag(cellEl.dataset.t1, cellEl.dataset.t2);
    };
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [extendDrag]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const setBulk = (mode, filter) => {
    setWork((w) => {
      const n = { ...w };
      for (const t1 of letters) for (const t2 of letters) {
        if (isImpossible(t1, t2)) continue;
        if (filter && !filter(t1, t2)) continue;
        const k = `${t1}:${t2}`;
        if (mode === "disable") n[k] = true; else delete n[k];
      }
      return n;
    });
  };
  const commitBulk = (mode, filter) => { setBulk(mode, filter); setTimeout(() => commit(workRef.current), 0); };

  const stateOf = (t1, t2) => {
    if (isImpossible(t1, t2)) return "impossible";
    const disabled = effDisabled(t1, t2);
    if (isBufferExcluded(t1, t2)) return disabled ? "bufferDisabled" : "bufferEnabled";
    return disabled ? "disabled" : "enabled";
  };

  // count active (enabled, drillable) cases
  let active = 0, total = 0;
  for (const t1 of letters) for (const t2 of letters) {
    if (isImpossible(t1, t2) || isBufferExcluded(t1, t2)) continue;
    total += 1;
    if (!effDisabled(t1, t2)) active += 1;
  }

  const gap = isMobile ? 1 : 2;
  const pad = isMobile ? 12 : 22;
  const containerPad = isMobile ? 10 : 28;
  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const modalOuter = Math.min(vw * 0.96, 640, vw - 2 * containerPad);
  const avail = modalOuter - 2 * pad;
  const cell = Math.max(10, Math.min(isMobile ? 999 : 22, Math.floor(avail / 25 - gap)));
  const label = cell;

  const modalStyle = {
    width: "min(96vw, 640px)", maxWidth: "100%", maxHeight: "100%",
    display: "block", overflowY: "auto", overflowX: "hidden", boxSizing: "border-box",
  };

  const legend = [
    ["enabled", "Enabled"],
    ["disabled", "Disabled"],
    ["impossible", "Impossible"],
    ["bufferEnabled", "Enabled (buffer-excluded)"],
    ["bufferDisabled", "Disabled (buffer-excluded)"],
  ];

  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 70 }} />
      <div style={{ position: "fixed", inset: 0, zIndex: 71, display: "flex", alignItems: "center", justifyContent: "center", padding: containerPad, pointerEvents: "none", boxSizing: "border-box" }}>
        <motion.div
          data-testid="subset-modal"
          initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.15 }}
          style={{ ...modalStyle, pointerEvents: "auto", background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: pad }}
        >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Grid3X3 size={20} style={{ color: "var(--active)" }} />
            <h2 className="font-head" style={{ fontSize: 22, margin: 0, textTransform: "uppercase", letterSpacing: "0.02em" }}>Case subset</h2>
          </div>
          <button data-testid="subset-close-btn" onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
          <div data-testid="subset-type-switch" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
            {[["corner", "Corners"], ["edge", "Edges"]].map(([t, l]) => (
              <button key={t} data-testid={`subset-type-${t}`} onClick={() => setType(t)} className="overline font-head"
                style={{ padding: "8px 16px", fontSize: 12, letterSpacing: "0.12em", cursor: "pointer", border: "none",
                  background: type === t ? "var(--surface-2)" : "transparent", color: type === t ? "#fff" : "#7a7a7a",
                  boxShadow: type === t ? "inset 0 0 0 1px var(--active)" : "none" }}>{l}</button>
            ))}
          </div>
          <span className="font-mono" data-testid="subset-active-count" style={{ fontSize: 12, color: "#A1A1AA" }}>
            buffer <b style={{ color: "#fff" }}>{buffer.toUpperCase()}</b> · <b style={{ color: "var(--success)" }}>{active}</b>/{total} cases active
          </span>
        </div>

        {/* Grid */}
        <div style={{ overflowX: "hidden", touchAction: isMobile ? "pan-y" : "none", paddingBottom: 4, marginTop: 14 }}>
          <div style={{ display: "inline-block", userSelect: "none" }}>
            {/* column header */}
            <div style={{ display: "flex", gap, marginBottom: gap, marginLeft: label + gap }}>
              {letters.map((t2) => (
                <button key={t2} data-testid={`subset-col-${t2}`}
                  onClick={() => commitBulk(letters.every((t1) => isImpossible(t1, t2) || isBufferExcluded(t1, t2) || work[`${t1}:${t2}`]) ? "enable" : "disable", (a, b) => b === t2)}
                  className="font-mono"
                  style={{ width: cell, height: label, fontSize: 10, color: "#A1A1AA", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}>
                  {t2.toUpperCase()}
                </button>
              ))}
            </div>
            {letters.map((t1) => (
              <div key={t1} style={{ display: "flex", gap, marginBottom: gap, alignItems: "center" }}>
                <button data-testid={`subset-row-${t1}`}
                  onClick={() => commitBulk(letters.every((t2) => isImpossible(t1, t2) || isBufferExcluded(t1, t2) || work[`${t1}:${t2}`]) ? "enable" : "disable", (a) => a === t1)}
                  className="font-mono"
                  style={{ width: label, height: cell, marginRight: gap, fontSize: 10, color: "#A1A1AA", background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "right" }}>
                  {t1.toUpperCase()}
                </button>
                {letters.map((t2) => {
                  const st = stateOf(t1, t2);
                  const isBuf = st === "bufferEnabled" || st === "bufferDisabled";
                  const imp = st === "impossible";
                  return (
                    <div
                      key={t2}
                      data-testid={`subset-cell-${t1}-${t2}`}
                      data-state={st}
                      data-subcell="1"
                      data-t1={t1}
                      data-t2={t2}
                      onPointerDown={(e) => { if (!imp) { e.preventDefault(); startDrag(t1, t2); } }}
                      onPointerEnter={() => { if (!imp) extendDrag(t1, t2); }}
                      title={`${t1.toUpperCase()}${t2.toUpperCase()}`}
                      style={{
                        width: cell, height: cell, borderRadius: 3, flex: "0 0 auto",
                        background: SUBSET_COLORS[st],
                        backgroundImage: isBuf ? STRIPES : "none",
                        opacity: isBuf ? 0.42 : 1,
                        border: imp ? "1px solid #2a2a2e" : "1px solid rgba(0,0,0,0.35)",
                        cursor: imp ? "not-allowed" : "pointer",
                      }}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Controls + instructions + legend (below grid) */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
          <button data-testid="subset-enable-all" onClick={() => commitBulk("enable")} style={{ ...ghostBtn, fontSize: 12, flex: "1 1 120px", justifyContent: "center" }}>Enable all</button>
          <button data-testid="subset-disable-all" onClick={() => commitBulk("disable")} style={{ ...ghostBtn, fontSize: 12, flex: "1 1 120px", justifyContent: "center" }}>Disable all</button>
        </div>

        <p className="font-mono" style={{ fontSize: 11.5, color: "#52525B", marginTop: 12, lineHeight: 1.6 }}>
          Row = first target, column = second target (buffer → row → column). Click or drag to paint (drag a diagonal to select a rectangle). Click a row/column label to toggle a whole line.
        </p>

        {/* Legend (below grid) */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
          {legend.map(([k, l]) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 3, background: SUBSET_COLORS[k], opacity: k.startsWith("buffer") ? 0.4 : 1, backgroundImage: k.startsWith("buffer") ? STRIPES : "none", border: k === "impossible" ? "1px solid #2a2a2e" : "none", display: "inline-block", flex: "0 0 auto" }} />
              <span className="font-mono" style={{ fontSize: 11, color: "#A1A1AA" }}>{l}</span>
            </div>
          ))}
        </div>
      </motion.div>
      </div>
    </>,
    document.body
  );
}

function HintModal({ pair, pairText, buffer, maps, style, setStyle, onClose }) {
  const isMobile = useIsMobile();
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, data: null });
    setShowAll(false);
    fetchHints({ type: pair.type, buffer, t1: pair.t1, t2: pair.t2, style, maps })
      .then((data) => { if (!cancelled) setState({ loading: false, error: null, data }); })
      .catch((e) => { if (!cancelled) setState({ loading: false, error: e.message || String(e), data: null }); });
    return () => { cancelled = true; };
  }, [pair.type, pair.t1, pair.t2, buffer, style, maps]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options = STYLE_OPTIONS[pair.type] || STYLE_OPTIONS.corner;
  const blddbUrl = pair.type === "corner" ? "https://blddb.net/corner.html" : "https://blddb.net/edge.html";
  const { loading, error, data } = state;
  const list = data && data.list ? data.list : [];
  const recAlg = data && data.recommended;
  const recComm = data && data.recCommutator;
  const rest = list.filter((a) => a.alg !== recAlg);

  const modalStyle = isMobile
    ? { position: "fixed", top: 12, left: 12, right: 12, width: "auto", maxHeight: "88dvh", overflowY: "auto", boxSizing: "border-box" }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 520, maxWidth: "94vw", maxHeight: "88dvh", overflowY: "auto", boxSizing: "border-box" };

  return createPortal(
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.8)", zIndex: 60 }} />
      <motion.div
        data-testid="hint-modal"
        initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        transition={{ duration: 0.15 }}
        style={{ ...modalStyle, background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 14, padding: isMobile ? 18 : 24, zIndex: 61 }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Lightbulb size={20} style={{ color: "var(--active)" }} />
            <h2 className="font-head" style={{ fontSize: 24, margin: 0, textTransform: "uppercase", letterSpacing: "0.02em" }}>
              Hint · <span data-testid="hint-pair" className="font-mono">{pairText}</span>
            </h2>
          </div>
          <button data-testid="hint-close-btn" onClick={onClose} style={iconBtn}><X size={18} /></button>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          <span className="overline font-head" style={{ fontSize: 11, color: "#A1A1AA" }}>Algorithm style</span>
          <select data-testid="hint-style-select" value={style} onChange={(e) => setStyle(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
            {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>

        <div style={{ marginTop: 18, minHeight: 80 }}>
          {loading && (
            <div data-testid="hint-loading" className="font-mono" style={{ display: "flex", alignItems: "center", gap: 10, color: "#A1A1AA", fontSize: 13, padding: "20px 0" }}>
              <Loader2 size={16} className="spin" /> Loading algorithms from blddb.net…
            </div>
          )}
          {!loading && error && (
            <div data-testid="hint-error" className="font-mono" style={{ color: "var(--error)", fontSize: 13, lineHeight: 1.6 }}>
              Couldn't reach blddb.net ({error}). Check your connection and try again.
            </div>
          )}
          {!loading && !error && data && data.notFound && (
            <div data-testid="hint-notfound" className="font-mono" style={{ color: "#A1A1AA", fontSize: 13, lineHeight: 1.6 }}>
              No algorithm found in blddb for this case{data.key ? ` (${data.key})` : ""}. It may be a same-piece or unsupported case.
            </div>
          )}
          {!loading && !error && data && !data.notFound && (
            <>
              {recAlg && (
                <div data-testid="hint-recommended" style={{ border: "1px solid var(--active)", borderRadius: 12, padding: 16, background: "var(--surface-2)" }}>
                  <div className="overline font-head" style={{ fontSize: 10, color: "var(--active)", marginBottom: 8 }}>Recommended · {(options.find((o) => o[0] === style) || [])[1]}</div>
                  <div className="font-mono" data-testid="hint-rec-alg" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "0.02em", wordBreak: "break-word" }}>{recAlg}</div>
                  {recComm && <div className="font-mono" data-testid="hint-rec-comm" style={{ fontSize: 13, color: "#A1A1AA", marginTop: 8 }}>{recComm}</div>}
                </div>
              )}

              {rest.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <button data-testid="hint-toggle-all" onClick={() => setShowAll((v) => !v)} style={{ ...ghostBtn, fontSize: 12 }}>
                    {showAll ? "Hide" : "Show"} all {list.length} algorithms
                  </button>
                  {showAll && (
                    <div data-testid="hint-all-list" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                      {rest.map((a, i) => (
                        <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", background: "var(--bg)" }}>
                          <div className="font-mono" style={{ fontSize: 14, fontWeight: 700, wordBreak: "break-word" }}>{a.alg}</div>
                          {a.commutator && <div className="font-mono" style={{ fontSize: 12, color: "#A1A1AA", marginTop: 4 }}>{a.commutator}</div>}
                          {a.sources && a.sources.length > 0 && <div className="font-mono" style={{ fontSize: 10, color: "#52525B", marginTop: 4 }}>{a.sources.length} source{a.sources.length > 1 ? "s" : ""}</div>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <a data-testid="hint-blddb-link" href={blddbUrl} target="_blank" rel="noreferrer"
          className="font-mono"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 18, fontSize: 12, color: "#A1A1AA", textDecoration: "none" }}>
          <ExternalLink size={13} /> Data from blddb.net (live)
        </a>
      </motion.div>
    </>,
    document.body
  );
}

function RecognitionTimer({ caseStartRef, caseStoppedRef, pairKey }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((v) => v + 1), 100);
    return () => clearInterval(id);
  }, [pairKey]);
  let ms = 0, running = false;
  if (caseStoppedRef.current != null) { ms = caseStoppedRef.current; }
  else if (caseStartRef.current != null) { ms = Date.now() - caseStartRef.current; running = true; }
  // Greyed when waiting for the first move or stopped; brighter while actively running.
  return (
    <div data-testid="recognition-timer" data-timer-state={caseStoppedRef.current != null ? "stopped" : running ? "running" : "waiting"}
      className="font-mono" style={{ color: running ? "#D4D4D8" : "#52525B", fontSize: 14, transition: "color 150ms ease" }}>
      {(ms / 1000).toFixed(1)}s
    </div>
  );
}

function Stat({ label, value, accent, testid, small, last }) {
  return (
    <div data-testid={testid} style={{ padding: "14px 18px", borderRight: last ? "none" : "1px solid var(--line)", borderBottom: "1px solid var(--line)" }}>
      <div className="overline font-head" style={{ fontSize: 11, color: "#52525B" }}>{label}</div>
      <div className="font-mono" style={{ fontSize: small ? 18 : 26, fontWeight: 800, color: accent || "#fff", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function bufferOptions(scheme, type) {
  const maps = SCHEMES[scheme] || SCHEMES.speffz;
  return Object.keys(type === "corner" ? maps.corner : maps.edge).sort();
}

function SettingsPanel({ settings, setSettings, resetStats, onOpenSubset }) {
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  const changeScheme = (scheme) => {
    const s = SCHEMES[scheme] || SCHEMES.speffz;
    setSettings((prev) => ({ ...prev, scheme, cornerBuffer: s.cornerBuffer, edgeBuffer: s.edgeBuffer }));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Field label="Lettering scheme">
        <select data-testid="scheme-select" value={settings.scheme} onChange={(e) => changeScheme(e.target.value)} style={selectStyle}>
          {Object.entries(SCHEMES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
      </Field>
      <Field label="Corner buffer">
        <select data-testid="corner-buffer-select" value={settings.cornerBuffer} onChange={(e) => set("cornerBuffer", e.target.value)} style={selectStyle}>
          {bufferOptions(settings.scheme, "corner").map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Edge buffer">
        <select data-testid="edge-buffer-select" value={settings.edgeBuffer} onChange={(e) => set("edgeBuffer", e.target.value)} style={selectStyle}>
          {bufferOptions(settings.scheme, "edge").map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </Field>
      <Toggle label="Sound feedback" testid="sound-toggle" value={settings.sound} onChange={(v) => set("sound", v)} />
      <Toggle label="Show manual move buttons" testid="manual-toggle" value={settings.showManual} onChange={(v) => set("showManual", v)} />
      <div>
        <span className="overline font-head" style={{ fontSize: 11, color: "#A1A1AA", display: "block", marginBottom: 8 }}>Case subset</span>
        <button data-testid="open-subset-btn" onClick={onOpenSubset} style={{ ...moveBtn, width: "100%", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "var(--surface-2)" }}>
          <Grid3X3 size={15} /> Select case subset (corners / edges)
        </button>
        <span className="font-mono" style={{ fontSize: 11, color: "#52525B", marginTop: 6, display: "block" }}>
          Pick exactly which target pairs get drilled. All enabled by default.
        </span>
      </div>
      <Field label="Cube MAC address (GAN / MoYu / QiYi)">
        <input
          data-testid="settings-mac-input"
          value={settings.macAddress || ""}
          onChange={(e) => set("macAddress", e.target.value)}
          placeholder="AA:BB:CC:DD:EE:FF (optional)"
          style={{ ...selectStyle, width: "100%", boxSizing: "border-box", letterSpacing: "0.06em" }}
        />
        <span className="font-mono" style={{ fontSize: 11, color: "#52525B" }}>
          Saved MAC is used automatically when connecting. Leave empty to auto-detect / be prompted.
          Tip: on Chrome/Edge you can read it at <code style={{ userSelect: "all", color: "var(--active)" }}>chrome://bluetooth-internals</code> → Devices → Scan.
        </span>
      </Field>
      <button data-testid="reset-stats-btn" onClick={resetStats} style={{ ...ghostBtn, borderColor: "var(--error)", color: "var(--error)", justifyContent: "center", marginTop: 8 }}>Reset all statistics</button>
      <p className="font-mono" style={{ color: "#52525B", fontSize: 12, lineHeight: 1.6 }}>
        Execute the commutator for the shown pair on your cube. When the cube reaches the resulting state, the next pair appears automatically. No cube? Use the manual move buttons or keyboard (U R F D L B, hold Shift for prime).
      </p>
      <a data-testid="github-link" href="https://github.com/Tijoxa/3-style-drill" target="_blank" rel="noreferrer"
        title="View source on GitHub"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#52525B", textDecoration: "none", marginTop: 4, fontSize: 11, fontFamily: "'JetBrains Mono', monospace", alignSelf: "flex-start", transition: "color 120ms ease" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#A1A1AA"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#52525B"; }}>
        <Github size={14} /> Source on GitHub
      </a>
    </div>
  );
}

function StatsPanel({ lifetime, session, avgMs }) {
  const days = Object.entries(lifetime.perDay || {});
  const bestDay = days.reduce((m, [d, c]) => (c > m.c ? { d, c } : m), { d: "-", c: 0 });
  const hours = (lifetime.totalTimeMs / 3600000);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      <BigStat label="Total cases" value={lifetime.totalCases} testid="stat-total" />
      <BigStat label="Best streak" value={lifetime.bestStreak} testid="stat-best-streak" />
      <BigStat label="Time trained" value={`${hours.toFixed(1)}h`} testid="stat-time" />
      <BigStat label="Best day" value={bestDay.c} sub={bestDay.d} testid="stat-best-day" />
      <BigStat label="Session solved" value={session.solved} testid="stat-session" />
      <BigStat label="Session avg" value={`${(avgMs / 1000).toFixed(1)}s`} testid="stat-session-avg" />
    </div>
  );
}

function BigStat({ label, value, sub, testid }) {
  return (
    <div data-testid={testid} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16, background: "var(--bg)" }}>
      <div className="overline font-head" style={{ fontSize: 10, color: "#52525B" }}>{label}</div>
      <div className="font-head" style={{ fontSize: 40, fontWeight: 900, lineHeight: 1.1 }}>{value}</div>
      {sub && <div className="font-mono" style={{ fontSize: 11, color: "#52525B" }}>{sub}</div>}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="overline font-head" style={{ fontSize: 11, color: "#A1A1AA" }}>{label}</span>
      {children}
    </label>
  );
}
function Toggle({ label, value, onChange, testid }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span className="overline font-head" style={{ fontSize: 11, color: "#A1A1AA" }}>{label}</span>
      <button data-testid={testid} onClick={() => onChange(!value)} style={{ width: 46, height: 26, borderRadius: 99, border: "1px solid var(--line)", background: value ? "var(--active)" : "var(--surface-2)", position: "relative", cursor: "pointer" }}>
        <span style={{ position: "absolute", top: 2, left: value ? 22 : 2, width: 20, height: 20, borderRadius: 99, background: "#fff", transition: "left 120ms ease" }} />
      </button>
    </div>
  );
}

const pillStyle = (color) => ({
  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderRadius: 99,
  border: `1px solid ${color}`, background: "var(--surface)", color: "#fff", cursor: "pointer", fontSize: 13,
});
const iconBtn = { display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 10, border: "1px solid var(--line)", background: "var(--surface)", color: "#fff", cursor: "pointer" };
const ghostBtn = { display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, border: "1px solid var(--line)", background: "transparent", color: "#A1A1AA", cursor: "pointer", fontSize: 13, fontFamily: "'JetBrains Mono', monospace" };
const moveBtn = { minWidth: 40, padding: "7px 10px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", color: "#fff", cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: 14, fontWeight: 700 };
const selectStyle = { padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface-2)", color: "#fff", fontFamily: "'JetBrains Mono', monospace", fontSize: 14 };
