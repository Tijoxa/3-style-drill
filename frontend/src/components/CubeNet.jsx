import React from "react";

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

export default function CubeNet({ state, highlights = {} }) {
  // highlights: { bufferIdx, t1Idx, t2Idx }
  const active = new Set(
    [highlights.bufferIdx, highlights.t1Idx, highlights.t2Idx].filter((x) => x != null)
  );
  const hasHighlight = active.size > 0;

  const cells = [];
  for (let i = 0; i < 54; i++) {
    const { row, col } = cellFor(i);
    const color = COLORS[state[i]] || "#333";
    const isBuffer = i === highlights.bufferIdx;
    const isTarget = i === highlights.t1Idx || i === highlights.t2Idx;
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
