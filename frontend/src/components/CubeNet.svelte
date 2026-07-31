<script>
  import { orientationPerm } from "../lib/cube.mjs";

  export let state = "";
  export let highlights = {};
  export let orientation = null;

  const COLORS = {
    U: "#FFFFFF", R: "#C41E3A", F: "#009E60",
    D: "#FFD500", L: "#FF5800", B: "#0051BA",
  };

  const BLOCK = { U: [0, 3], L: [3, 0], F: [3, 3], R: [3, 6], B: [3, 9], D: [6, 3] };
  const FACE_INDEX = ["U", "R", "F", "D", "L", "B"];

  function cellFor(i) {
    const face = FACE_INDEX[Math.floor(i / 9)];
    const local = i % 9;
    const [br, bc] = BLOCK[face];
    return { row: br + Math.floor(local / 3), col: bc + (local % 3) };
  }

  $: g = orientationPerm(orientation);
  $: gInv = (() => {
    const inv = new Array(54);
    if (g) g.forEach((h, i) => { inv[h] = i; });
    return inv;
  })();

  $: bufferSlot = highlights && highlights.bufferIdx != null ? gInv[highlights.bufferIdx] : null;
  $: t1Slot = highlights && highlights.t1Idx != null ? gInv[highlights.t1Idx] : null;
  $: t2Slot = highlights && highlights.t2Idx != null ? gInv[highlights.t2Idx] : null;
  $: extraSlots = highlights && Array.isArray(highlights.set) ? highlights.set.map((h) => gInv[h]).filter((x) => x != null) : [];
  $: extraSet = new Set(extraSlots);
  $: active = new Set([bufferSlot, t1Slot, t2Slot, ...extraSlots].filter((x) => x != null));
  $: hasHighlight = active.size > 0;

  $: cells = Array.from({ length: 54 }, (_, i) => {
    const { row, col } = cellFor(i);
    const color = (state && g && COLORS[state[g[i]]]) || "#333";
    const isBuffer = i === bufferSlot;
    const isTarget = i === t1Slot || i === t2Slot || extraSet.has(i);
    const dim = hasHighlight && !active.has(i);
    const boxShadow = isBuffer
      ? "0 0 0 2px #007AFF, 0 0 8px #007AFF"
      : isTarget
      ? "0 0 0 2px #39FF14, 0 0 8px #39FF14"
      : "inset 0 0 0 1px rgba(0,0,0,0.55)";
    return {
      i,
      row,
      col,
      color,
      dim,
      boxShadow,
    };
  });
</script>

<div
  data-testid="cube-sticker-map"
  style="display: grid; grid-template-columns: repeat(12, 1fr); grid-template-rows: repeat(9, 1fr); gap: 2px; width: 264px; height: 198px;"
>
  {#each cells as cell (cell.i)}
    <div
      data-testid="sticker-{cell.i}"
      style="grid-row: {cell.row + 1}; grid-column: {cell.col + 1}; background: {cell.color}; opacity: {cell.dim ? 0.28 : 1}; box-shadow: {cell.boxShadow}; border-radius: 2px; transition: opacity 120ms ease;"
    ></div>
  {/each}
</div>
