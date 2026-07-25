import React, { useMemo } from "react";
import { orientationPerm } from "../lib/cube.mjs";

const COLORS = {
  U: "#FFFFFF", R: "#C41E3A", F: "#009E60",
  D: "#FFD500", L: "#FF5800", B: "#0051BA",
};

// face -> block offset in a 12x9 grid
const BLOCK = { U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] };
const FACE_INDEX = ["U", "R", "F", "D", "L", "B"];

function cellFor(i) {
  const face = FACE_INDEX[Math.floor(i / 9)];
  const local = i % 9;
  const [br, bc] = BLOCK[face];
  return { row: br + Math.floor(local / 3), col: bc + (local % 3) };
}

export default function CubeNet({ state, highlights = {}, orientation }) {
  // g[worldSlot] = hardware facelet shown at that slot; gInv maps hardware idx -> world slot.
  const g = useMemo(() => orientationPerm(orientation), [orientation?.top, orientation?.front]);
  const gInv = useMemo(() => { const inv = new Array(54); g.forEach((h, i) => { inv[h] = i; }); return inv; }, [g]);

  const bufferSlot = highlights.bufferIdx != null ? gInv[highlights.bufferIdx] : null;
  const t1Slot = highlights.t1Idx != null ? gInv[highlights.t1Idx] : null;
  const t2Slot = highlights.t2Idx != null ? gInv[highlights.t2Idx] : null;
  // Optional multi-sticker highlight set (used by flips/twists/parity/ltct cases).
  const extraSlots = Array.isArray(highlights.set) ? highlights.set.map((h) => gInv[h]).filter((x) => x != null) : [];
  const extraSet = new Set(extraSlots);
  const active = new Set([bufferSlot, t1Slot, t2Slot, ...extraSlots].filter((x) => x != null));
  const hasHighlight = active.size > 0;

  const cells = [];
  for (let i = 0; i < 54; i++) {
    const { row, col } = cellFor(i);
    const color = COLORS[state[g[i]]] || "#333";
    const isBuffer = i === bufferSlot;
    const isTarget = i === t1Slot || i === t2Slot || extraSet.has(i);
    const dim = hasHighlight && !active.has(i);
    cells.push(
      <div
        key={i}
        data-testid={`sticker-${i}`}
        style={{
          gridRow: row + 1,
          gridColumn: col + 1,
          background: color,
          opacity: dim ? 0.28 : 1,
          boxShadow: isBuffer
            ? "0 0 0 2px #007AFF, 0 0 8px #007AFF"
            : isTarget
            ? "0 0 0 2px #39FF14, 0 0 8px #39FF14"
            : "inset 0 0 0 1px rgba(0,0,0,0.55)",
          borderRadius: 2,
          transition: "opacity 120ms ease",
        }}
      />
    );
  }

  return (
    <div
      data-testid="cube-sticker-map"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(12, 1fr)",
        gridTemplateRows: "repeat(9, 1fr)",
        gap: 2,
        width: 264,
        height: 198,
      }}
    >
      {cells}
    </div>
  );
}
