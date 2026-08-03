import React, { useMemo } from "react";
import { userFaceToCubeFaceMap } from "../lib/cube.mjs";

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
  // Trainer state and highlights are user-relative. Only colour identities need
  // translating back to the physical cube for the selected orientation.
  const faceColors = useMemo(() => userFaceToCubeFaceMap(orientation), [orientation]);

  const bufferSlot = highlights.bufferIdx;
  const t1Slot = highlights.t1Idx;
  const t2Slot = highlights.t2Idx;
  // Optional multi-sticker highlight sets (used by flips/twists/parity/ltct cases).
  const mapSlots = (arr) => (Array.isArray(arr) ? arr.filter((x) => x != null) : []);
  const extraSlots = mapSlots(highlights.set);        // legacy green set
  const greenSlots = mapSlots(highlights.greenSet);   // green (correct target letters)
  const darkGreenSlots = mapSlots(highlights.darkGreenSet); // darker green (second letter in LTCT/T2C)
  const blueSlots = mapSlots(highlights.blueSet);     // blue (buffer / bracketed twisted piece)
  const greenSet = new Set([t1Slot, t2Slot, ...extraSlots, ...greenSlots].filter((x) => x != null));
  const darkGreenSet = new Set(darkGreenSlots.filter((x) => x != null));
  const blueSet = new Set([bufferSlot, ...blueSlots].filter((x) => x != null));
  const active = new Set([...greenSet, ...darkGreenSet, ...blueSet]);
  const hasHighlight = active.size > 0;

  const cells = [];
  for (let i = 0; i < 54; i++) {
    const { row, col } = cellFor(i);
    const color = COLORS[faceColors[state[i]]] || "#333";
    const isBlue = blueSet.has(i);
    const isGreen = greenSet.has(i);
    const isDarkGreen = darkGreenSet.has(i);
    const dim = hasHighlight && !active.has(i);
    cells.push(
      <div
        key={i}
        data-testid={`sticker-${i}`}
        data-highlighted={active.has(i) ? "true" : "false"}
        style={{
          gridRow: row + 1,
          gridColumn: col + 1,
          background: color,
          opacity: dim ? 0.28 : 1,
          boxShadow: isBlue
            ? "0 0 0 2px #007AFF, 0 0 8px #007AFF"
            : isGreen
              ? "0 0 0 2px #39FF14, 0 0 8px #39FF14"
              : isDarkGreen
                ? "0 0 0 2px #15803D, 0 0 8px #15803D"
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
