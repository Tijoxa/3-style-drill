import "./App.css";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Toaster, toast } from "sonner";
import {
  Bluetooth, BluetoothConnected, Settings as SettingsIcon, BarChart3,
  X, RotateCcw, Zap, SkipForward, Keyboard, BatteryMedium,
} from "lucide-react";
import {
  SOLVED, applyMove, apply3Cycle, letterPieceId,
  CORNER_LETTERS, EDGE_LETTERS, CORNER_LETTER_LIST, EDGE_LETTER_LIST,
} from "./lib/cube.mjs";
import { connect as btConnect, disconnect as btDisconnect, isBluetoothSupported } from "./lib/smartcube";
import CubeNet from "./components/CubeNet";

const STATS_KEY = "bld3style_stats_v1";
const SETTINGS_KEY = "bld3style_settings_v1";
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const facelet = (l, type) => (type === "corner" ? CORNER_LETTERS : EDGE_LETTERS)[l];
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

const defaultSettings = { cornerBuffer: "C", edgeBuffer: "c", sound: true, showManual: true };

export default function App() {
  const [mode, setMode] = useState("corners");
  const [settings, setSettings] = useState(() => ({ ...defaultSettings, ...loadJSON(SETTINGS_KEY, {}) }));
  const [pair, setPair] = useState(null);
  const [highlights, setHighlights] = useState({});
  const [netState, setNetState] = useState(SOLVED);
  const [flash, setFlash] = useState(null);
  const [btStatus, setBtStatus] = useState("disconnected");
  const [cubeName, setCubeName] = useState("");
  const [battery, setBattery] = useState(null);
  const [drawer, setDrawer] = useState(null); // 'settings' | 'stats' | null
  const [lifetime, setLifetime] = useState(() => loadJSON(STATS_KEY, { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} }));

  const [session, setSession] = useState({ solved: 0, streak: 0, bestStreak: 0, times: [] });
  const sessionStartRef = useRef(Date.now());

  const cubeStateRef = useRef(SOLVED);
  const targetRef = useRef(null);
  const caseStartRef = useRef(Date.now());
  const modeRef = useRef(mode);
  const settingsRef = useRef(settings);
  const busyRef = useRef(false);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { settingsRef.current = settings; localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }, [settings]);

  const buildCase = useCallback(() => {
    const m = modeRef.current;
    const s = settingsRef.current;
    const type = m === "corners" ? "corner" : "edge";
    const list = type === "corner" ? CORNER_LETTER_LIST : EDGE_LETTER_LIST;
    const buffer = type === "corner" ? s.cornerBuffer : s.edgeBuffer;
    const bufPiece = letterPieceId(buffer, type);
    const cands = list.filter((l) => letterPieceId(l, type) !== bufPiece);
    const cur = cubeStateRef.current;
    for (let tries = 0; tries < 80; tries++) {
      const t1 = rand(cands);
      const t2opts = cands.filter((l) => l !== t1 && letterPieceId(l, type) !== letterPieceId(t1, type));
      const t2 = rand(t2opts);
      const target = apply3Cycle(cur, [buffer, t1, t2], type);
      if (target !== cur) {
        targetRef.current = target;
        caseStartRef.current = Date.now();
        setPair({ t1, t2, type });
        setHighlights({ bufferIdx: facelet(buffer, type), t1Idx: facelet(t1, type), t2Idx: facelet(t2, type) });
        return;
      }
    }
  }, []);

  const onSuccess = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    const elapsed = Date.now() - caseStartRef.current;
    if (settingsRef.current.sound) beep(880, true);
    setFlash("ok");
    setSession((prev) => {
      const streak = prev.streak + 1;
      return {
        solved: prev.solved + 1,
        streak,
        bestStreak: Math.max(prev.bestStreak, streak),
        times: [...prev.times, elapsed].slice(-500),
      };
    });
    setLifetime((prev) => {
      const d = today();
      const perDay = { ...prev.perDay, [d]: (prev.perDay[d] || 0) + 1 };
      const next = {
        totalCases: prev.totalCases + 1,
        totalTimeMs: prev.totalTimeMs + elapsed,
        bestStreak: Math.max(prev.bestStreak, (session.streak + 1)),
        perDay,
      };
      localStorage.setItem(STATS_KEY, JSON.stringify(next));
      return next;
    });
    setTimeout(() => setFlash(null), 180);
    setTimeout(() => { buildCase(); busyRef.current = false; }, 60);
  }, [buildCase, session.streak]);

  const onStateChanged = useCallback((newState) => {
    cubeStateRef.current = newState;
    setNetState(newState);
    if (targetRef.current && newState === targetRef.current) onSuccess();
  }, [onSuccess]);

  const doMove = useCallback((move) => {
    onStateChanged(applyMove(cubeStateRef.current, move));
  }, [onStateChanged]);

  const resetCube = useCallback(() => {
    cubeStateRef.current = SOLVED;
    setNetState(SOLVED);
    buildCase();
    toast.success("Cube set to solved state");
  }, [buildCase]);

  const skipCase = useCallback(() => {
    if (settingsRef.current.sound) beep(200, false);
    setFlash("err");
    setSession((p) => ({ ...p, streak: 0 }));
    setTimeout(() => setFlash(null), 280);
    buildCase();
  }, [buildCase]);

  // init first case + on mode change
  useEffect(() => { buildCase(); /* eslint-disable-next-line */ }, [mode]);

  // test/debug hook: lets automated tests simulate a perfect execution
  useEffect(() => {
    window.__trainer = {
      getState: () => cubeStateRef.current,
      getTarget: () => targetRef.current,
      solveCurrent: () => { if (targetRef.current) onStateChanged(targetRef.current); },
    };
  }, [onStateChanged]);

  // keyboard controls
  useEffect(() => {
    const handler = (e) => {
      if (drawer) return;
      const k = e.key;
      if (k === " ") { e.preventDefault(); skipCase(); return; }
      const map = { u: "U", r: "R", f: "F", d: "D", l: "L", b: "B" };
      const face = map[k.toLowerCase()];
      if (face) { e.preventDefault(); doMove(e.shiftKey ? face + "'" : face); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doMove, skipCase, drawer]);

  const handleConnect = useCallback(async () => {
    if (btStatus === "connected") { await btDisconnect(); setBtStatus("disconnected"); setCubeName(""); setBattery(null); return; }
    if (!isBluetoothSupported()) { toast.error("Web Bluetooth not supported. Use Chrome/Edge on desktop or Android."); return; }
    setBtStatus("connecting");
    try {
      const info = await btConnect({
        onMove: (m) => onStateChanged(applyMove(cubeStateRef.current, m)),
        onFacelets: (f) => { if (f && f.length === 54) onStateChanged(f); },
        onBattery: (b) => setBattery(b),
        onDisconnect: () => { setBtStatus("disconnected"); setCubeName(""); setBattery(null); toast("Cube disconnected"); },
      });
      setCubeName(info.name);
      setBtStatus("connected");
      toast.success(`Connected: ${info.name}`);
    } catch (e) {
      setBtStatus("disconnected");
      toast.error("Connection cancelled or failed");
    }
  }, [btStatus, onStateChanged]);

  const resetStats = () => {
    const empty = { totalCases: 0, totalTimeMs: 0, bestStreak: 0, perDay: {} };
    localStorage.setItem(STATS_KEY, JSON.stringify(empty));
    setLifetime(empty);
    setSession({ solved: 0, streak: 0, bestStreak: 0, times: [] });
    sessionStartRef.current = Date.now();
    toast.success("Stats reset");
  };

  const avgMs = session.times.length ? session.times.reduce((a, b) => a + b, 0) / session.times.length : 0;
  const lastMs = session.times.length ? session.times[session.times.length - 1] : 0;
  const elapsedMin = (Date.now() - sessionStartRef.current) / 60000;
  const cpm = elapsedMin > 0.05 ? session.solved / elapsedMin : 0;

  const pairText = pair ? `${pair.t1}${pair.t2}` : "--";
  const flashColor = flash === "ok" ? "var(--success)" : flash === "err" ? "var(--error)" : "#fff";

  return (
    <div className="noise" style={{ height: "100vh", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
      <Toaster theme="dark" position="top-center" richColors />

      {/* Top bar */}
      <header style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
            <span className="font-mono" data-testid="battery-level" style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--text-secondary,#A1A1AA)", fontSize: 13, color: "#A1A1AA" }}>
              <BatteryMedium size={15} /> {battery}%
            </span>
          )}
        </div>

        {/* mode switcher */}
        <div data-testid="mode-switcher" style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden", background: "var(--surface)" }}>
          {["corners", "edges"].map((m) => (
            <button
              key={m}
              data-testid={`mode-${m}`}
              onClick={() => setMode(m)}
              className="overline font-head"
              style={{
                padding: "8px 18px", fontSize: 13, letterSpacing: "0.15em", cursor: "pointer",
                background: mode === m ? "var(--surface-2)" : "transparent",
                color: mode === m ? "#fff" : "#7a7a7a",
                border: "none", boxShadow: mode === m ? "inset 0 0 0 1px var(--active)" : "none",
              }}
            >{m}</button>
          ))}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button data-testid="open-stats-btn" onClick={() => setDrawer("stats")} style={iconBtn}><BarChart3 size={18} /></button>
          <button data-testid="open-settings-btn" onClick={() => setDrawer("settings")} style={iconBtn}><SettingsIcon size={18} /></button>
        </div>
      </header>

      {/* Center */}
      <main style={{ position: "relative", zIndex: 1, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 24, padding: 20 }}>
        <div className="overline" style={{ color: "#52525B", fontSize: 12 }}>
          {mode === "corners" ? "CORNER 3-STYLE" : "EDGE 3-STYLE"} · BUFFER {mode === "corners" ? settings.cornerBuffer : settings.edgeBuffer}
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

        <RecognitionTimer caseStartRef={caseStartRef} pairKey={pairText} />

        <CubeNet state={netState} highlights={highlights} />

        <div style={{ display: "flex", gap: 10 }}>
          <button data-testid="skip-btn" onClick={skipCase} style={ghostBtn}><SkipForward size={15} /> Skip (Space)</button>
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
      <div data-testid="live-session-hud" style={{ position: "relative", zIndex: 2, display: "grid", gridTemplateColumns: "repeat(5, 1fr)", borderTop: "1px solid var(--line)", background: "var(--bg)" }}>
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
              {drawer === "settings" ? <SettingsPanel settings={settings} setSettings={setSettings} resetStats={resetStats} /> : <StatsPanel lifetime={lifetime} session={session} avgMs={avgMs} />}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function RecognitionTimer({ caseStartRef, pairKey }) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    setMs(0);
    const id = setInterval(() => setMs(Date.now() - caseStartRef.current), 100);
    return () => clearInterval(id);
  }, [pairKey, caseStartRef]);
  return <div data-testid="recognition-timer" className="font-mono" style={{ color: "#52525B", fontSize: 14 }}>{(ms / 1000).toFixed(1)}s</div>;
}

function Stat({ label, value, accent, testid, small, last }) {
  return (
    <div data-testid={testid} style={{ padding: "14px 18px", borderRight: last ? "none" : "1px solid var(--line)" }}>
      <div className="overline font-head" style={{ fontSize: 11, color: "#52525B" }}>{label}</div>
      <div className="font-mono" style={{ fontSize: small ? 18 : 26, fontWeight: 800, color: accent || "#fff", marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CornerBufferOptions() {
  // one representative letter per corner piece (U/D sticker)
  return ["A", "B", "C", "D", "U", "V", "W", "X"];
}
function EdgeBufferOptions() {
  return ["a", "b", "c", "d", "u", "v", "w", "x"];
}

function SettingsPanel({ settings, setSettings, resetStats }) {
  const set = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <Field label="Corner buffer">
        <select data-testid="corner-buffer-select" value={settings.cornerBuffer} onChange={(e) => set("cornerBuffer", e.target.value)} style={selectStyle}>
          {CornerBufferOptions().map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Field label="Edge buffer">
        <select data-testid="edge-buffer-select" value={settings.edgeBuffer} onChange={(e) => set("edgeBuffer", e.target.value)} style={selectStyle}>
          {EdgeBufferOptions().map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </Field>
      <Toggle label="Sound feedback" testid="sound-toggle" value={settings.sound} onChange={(v) => set("sound", v)} />
      <Toggle label="Show manual move buttons" testid="manual-toggle" value={settings.showManual} onChange={(v) => set("showManual", v)} />
      <button data-testid="reset-stats-btn" onClick={resetStats} style={{ ...ghostBtn, borderColor: "var(--error)", color: "var(--error)", justifyContent: "center", marginTop: 8 }}>Reset all statistics</button>
      <p className="font-mono" style={{ color: "#52525B", fontSize: 12, lineHeight: 1.6 }}>
        Execute the commutator for the shown pair on your cube. When the cube reaches the resulting state, the next pair appears automatically. No cube? Use the manual move buttons or keyboard (U R F D L B, hold Shift for prime).
      </p>
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
