<script>
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { Grid3X3, X, ChevronDown } from "lucide-svelte";
  import { SCHEMES, orientMaps, letterPieceId } from "../lib/cube.mjs";

  export let settings = {};
  export let setSettings = () => {};
  export let initialView = "corner";
  export let onClose = () => {};

  const FLIP_COUNTS_AVAILABLE = [2];
  const TWIST_COUNTS_AVAILABLE = [2, 3, 4, 5, 6, 7, 8];

  const SUBSET_COLORS = {
    enabled: "#22C55E",
    disabled: "#3F3F46",
    impossible: "#111114",
    bufferEnabled: "#22C55E",
    bufferDisabled: "#3F3F46",
  };
  const STRIPES = "repeating-linear-gradient(45deg, rgba(255,255,255,0.28) 0 2px, transparent 2px 5px)";

  let isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  let view = initialView; // corner | edge | flips | twists
  let moreMenuOpen = false;

  $: scheme = settings.scheme || "speffz";
  $: maps = orientMaps(SCHEMES[scheme] || SCHEMES.speffz, settings.orientation);
  $: type = view === "edge" ? "edge" : "corner";
  $: isPieceView = view === "flips" || view === "twists";
  $: buffer = type === "corner" ? (settings.cornerBuffer || "C") : (settings.edgeBuffer || "c");
  $: letters = Object.keys(type === "corner" ? maps.corner : maps.edge).sort();
  $: bufPiece = letterPieceId(buffer, type, maps);
  $: prefix = `${scheme}:${type}:`;

  function pieceOf(l) {
    return letterPieceId(l, type, maps);
  }

  // Work state: Map of disabled "t1:t2" keys for current scheme+type
  let work = {};

  $: {
    const w = {};
    const dc = settings.disabledCases || {};
    Object.keys(dc).forEach((k) => {
      if (k.startsWith(prefix)) w[k.slice(prefix.length)] = true;
    });
    work = w;
  }

  function commit(newWork) {
    setSettings((s) => {
      const dc = { ...(s.disabledCases || {}) };
      Object.keys(dc).forEach((k) => {
        if (k.startsWith(prefix)) delete dc[k];
      });
      Object.keys(newWork).forEach((kk) => {
        dc[prefix + kk] = true;
      });
      return { ...s, disabledCases: dc };
    });
  }

  $: idxOf = (() => {
    const m = {};
    letters.forEach((l, i) => { m[l] = i; });
    return m;
  })();

  // Drag selection state
  let drag = null; // { mode, r0, c0, r1, c1 }

  function isImpossible(t1, t2) {
    return t1 === t2 || pieceOf(t1) === pieceOf(t2);
  }

  function isBufferExcluded(t1, t2) {
    return pieceOf(t1) === bufPiece || pieceOf(t2) === bufPiece;
  }

  function isHidden(t1, t2) {
    return idxOf[t1] <= idxOf[t2];
  }

  function inDragRect(t1, t2, currentDrag) {
    if (!currentDrag) return false;
    const r = idxOf[t1], c = idxOf[t2];
    if (r == null || c == null) return false;
    const rlo = Math.min(currentDrag.r0, currentDrag.r1);
    const rhi = Math.max(currentDrag.r0, currentDrag.r1);
    const clo = Math.min(currentDrag.c0, currentDrag.c1);
    const chi = Math.max(currentDrag.c0, currentDrag.c1);

    const matchForward = r >= rlo && r <= rhi && c >= clo && c <= chi;
    const matchReverse = c >= rlo && c <= rhi && r >= clo && r <= chi;

    return matchForward || matchReverse;
  }

  function effDisabled(t1, t2, currentWork, currentDrag) {
    if (currentDrag && inDragRect(t1, t2, currentDrag) && !isImpossible(t1, t2)) {
      return currentDrag.mode === "disable";
    }
    return !!currentWork[`${t1}:${t2}`];
  }

  function stateOf(t1, t2, currentWork, currentDrag) {
    if (isImpossible(t1, t2)) return "impossible";
    const disabled = effDisabled(t1, t2, currentWork, currentDrag);
    if (isBufferExcluded(t1, t2)) return disabled ? "bufferDisabled" : "bufferEnabled";
    return disabled ? "disabled" : "enabled";
  }

  function startDrag(t1, t2) {
    if (isImpossible(t1, t2)) return;
    const mode = work[`${t1}:${t2}`] ? "enable" : "disable";
    drag = { mode, r0: idxOf[t1], c0: idxOf[t2], r1: idxOf[t1], c1: idxOf[t2] };
  }

  function extendDrag(t1, t2) {
    if (!drag) return;
    const r = idxOf[t1], c = idxOf[t2];
    if (r == null || c == null) return;
    if (drag.r1 !== r || drag.c1 !== c) {
      drag = { ...drag, r1: r, c1: c };
    }
  }

  function finishDrag() {
    if (!drag) return;
    const d = drag;
    const n = { ...work };
    const rlo = Math.min(d.r0, d.r1), rhi = Math.max(d.r0, d.r1);
    const clo = Math.min(d.c0, d.c1), chi = Math.max(d.c0, d.c1);

    for (let r = rlo; r <= rhi; r++) {
      for (let c = clo; c <= chi; c++) {
        const t1 = letters[r], t2 = letters[c];
        if (!t1 || !t2 || isImpossible(t1, t2)) continue;
        const k1 = `${t1}:${t2}`, k2 = `${t2}:${t1}`;
        if (d.mode === "disable") {
          n[k1] = true;
          n[k2] = true;
        } else {
          delete n[k1];
          delete n[k2];
        }
      }
    }
    work = n;
    commit(n);
    drag = null;
  }

  function toggleCell(t1, t2) {
    if (isImpossible(t1, t2)) return;
    const n = { ...work };
    const k1 = `${t1}:${t2}`;
    const k2 = `${t2}:${t1}`;
    if (n[k1]) {
      delete n[k1];
      delete n[k2];
    } else {
      n[k1] = true;
      n[k2] = true;
    }
    work = n;
    commit(n);
  }

  function commitBulk(mode, filter) {
    const n = { ...work };
    for (const t1 of letters) {
      for (const t2 of letters) {
        if (isHidden(t1, t2) || isImpossible(t1, t2)) continue;
        if (filter && !filter(t1, t2)) continue;
        const k1 = `${t1}:${t2}`;
        const k2 = `${t2}:${t1}`;
        if (mode === "disable") {
          n[k1] = true;
          n[k2] = true;
        } else {
          delete n[k1];
          delete n[k2];
        }
      }
    }
    work = n;
    commit(n);
  }

  function allDisabledForLetter(L, currentWork) {
    return letters.every((x) => {
      if (x === L || isImpossible(L, x) || isBufferExcluded(L, x)) return true;
      const key = idxOf[L] > idxOf[x] ? `${L}:${x}` : `${x}:${L}`;
      return !!currentWork[key];
    });
  }

  function toggleCount(field, n) {
    setSettings((s) => {
      const cur = s[field] || [];
      let next = cur.includes(n) ? cur.filter((x) => x !== n) : [...cur, n];
      if (!next.length) next = [n];
      return { ...s, [field]: next.sort((a, b) => a - b) };
    });
  }

  $: activeCount = (() => {
    let act = 0;
    for (const t1 of letters) {
      for (const t2 of letters) {
        if (isHidden(t1, t2) || isImpossible(t1, t2) || isBufferExcluded(t1, t2)) continue;
        if (!effDisabled(t1, t2, work, drag)) act += 1;
      }
    }
    return act;
  })();

  $: totalCount = (() => {
    let tot = 0;
    for (const t1 of letters) {
      for (const t2 of letters) {
        if (isHidden(t1, t2) || isImpossible(t1, t2) || isBufferExcluded(t1, t2)) continue;
        tot += 1;
      }
    }
    return tot;
  })();

  function handlePointerMove(e) {
    if (!drag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cellEl = el && el.closest ? el.closest("[data-subcell]") : null;
    if (cellEl && cellEl.dataset.t1 && cellEl.dataset.t2) {
      extendDrag(cellEl.dataset.t1, cellEl.dataset.t2);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("pointerup", finishDrag);
    window.addEventListener("pointercancel", finishDrag);
    window.addEventListener("pointermove", handlePointerMove);
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", finishDrag);
      window.removeEventListener("pointermove", handlePointerMove);
    }
  });

  $: gap = isMobile ? 1 : 2;
  $: pad = isMobile ? 12 : 22;
  $: containerPad = isMobile ? 10 : 28;
  $: cell = Math.max(10, Math.min(isMobile ? 999 : 22, 18));
  $: label = cell;

  const legend = [
    ["enabled", "Enabled"],
    ["disabled", "Disabled"],
    ["impossible", "Impossible"],
    ["bufferEnabled", "Enabled (buffer-excluded)"],
    ["bufferDisabled", "Disabled (buffer-excluded)"],
  ];

  const iconBtn = "display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: #fff; cursor: pointer;";
  const ghostBtn = "display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: #A1A1AA; cursor: pointer; font-size: 13px; font-family: 'JetBrains Mono', monospace;";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div transition:fade={{ duration: 150 }} on:click={onClose} style="position: fixed; inset: 0; background: rgba(0,0,0,0.85); z-index: 70;"></div>
<div style="position: fixed; inset: 0; z-index: 71; display: flex; align-items: center; justify-content: center; padding: {containerPad}px; pointer-events: none; box-sizing: border-box;">
  <div
    data-testid="subset-modal"
    transition:scale={{ start: 0.97, duration: 150 }}
    style="width: min(96vw, 640px); max-width: 100%; max-height: 100%; pointer-events: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: {pad}px; overflow-y: auto;"
  >
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
      <div style="display: flex; align-items: center; gap: 10px;">
        <Grid3X3 size={20} style="color: var(--active);" />
        <h2 class="font-head" style="font-size: 22px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">Case subset</h2>
      </div>
      <button data-testid="subset-close-btn" on:click={onClose} style={iconBtn}><X size={18} /></button>
    </div>

    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px;">
      <!-- SubsetViewSwitch -->
      <div data-testid="subset-view-switch" style="display: flex; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); position: relative;">
        {#each [["corner", "Corners"], ["edge", "Edges"]] as [v, l], idx}
          <button
            data-testid="subset-view-{v}"
            on:click={() => { view = v; moreMenuOpen = false; }}
            class="overline font-head"
            style="padding: 8px 16px; font-size: 12px; letter-spacing: 0.12em; cursor: pointer; border: none; background: {view === v ? 'var(--surface-2)' : 'transparent'}; color: {view === v ? '#fff' : '#7a7a7a'}; border-radius: {view === v && idx === 0 ? '9px 0 0 9px' : '0px'}; box-shadow: {view === v ? 'inset 0 0 0 1px var(--active)' : 'none'};"
          >{l}</button>
        {/each}

        <div style="position: relative; display: flex;">
          <button
            data-testid="subset-view-more-btn"
            on:click={() => { moreMenuOpen = !moreMenuOpen; }}
            class="overline font-head"
            style="padding: 8px 14px; display: flex; align-items: center; gap: 6px; font-size: 12px; letter-spacing: 0.12em; cursor: pointer; white-space: nowrap; border: none; background: {(view === 'flips' || view === 'twists') ? 'var(--surface-2)' : 'transparent'}; color: {(view === 'flips' || view === 'twists') ? '#fff' : '#7a7a7a'}; border-radius: 0 9px 9px 0; box-shadow: {(view === 'flips' || view === 'twists') ? 'inset 0 0 0 1px var(--active)' : 'none'};"
          >
            {view === 'flips' ? 'EDGE FLIPS' : view === 'twists' ? 'CORNER TWISTS' : 'MORE'} <ChevronDown size={13} />
          </button>
          {#if moreMenuOpen}
            <div data-testid="subset-view-more-menu" style="position: absolute; top: calc(100% + 6px); left: 0; z-index: 20; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 6px; min-width: 170px; box-shadow: 0 8px 24px rgba(0,0,0,0.45);">
              {#each [["flips", "Edge flips"], ["twists", "Corner twists"]] as [v, l]}
                <button
                  data-testid="subset-view-{v}"
                  on:click={() => { view = v; moreMenuOpen = false; }}
                  class="font-mono"
                  style="display: block; width: 100%; text-align: left; padding: 9px 10px; font-size: 13px; cursor: pointer; border: none; border-radius: 8px; background: {view === v ? 'var(--surface)' : 'transparent'}; color: {view === v ? '#fff' : '#A1A1AA'};"
                >
                  {l}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>

      {#if !isPieceView}
        <span class="font-mono" data-testid="subset-active-count" style="font-size: 12px; color: #A1A1AA;">
          buffer <b style="color: #fff;">{buffer.toUpperCase()}</b> · <b style="color: var(--success);">{activeCount}</b>/{totalCount} pairs active
        </span>
      {/if}
    </div>

    {#if view === "flips"}
      <div data-testid="count-selectors" style="margin-top: 18px;">
        <div>
          <span class="overline font-head" style="font-size: 11px; color: #A1A1AA; display: block; margin-bottom: 6px;">Edge flips (count)</span>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            {#each FLIP_COUNTS_AVAILABLE as n}
              {@const on = (settings.flipCounts || [2]).includes(n)}
              <button
                data-testid="flip-count-{n}"
                data-active={on}
                on:click={() => toggleCount("flipCounts", n)}
                class="font-mono"
                style="width: 34px; height: 34px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700; border: {on ? '1px solid var(--active)' : '1px solid var(--line)'}; background: {on ? 'var(--success)' : 'var(--surface-2)'}; color: {on ? '#04120a' : '#7a7a7a'};"
              >
                {n}
              </button>
            {/each}
          </div>
        </div>
        <p class="font-mono" style="font-size: 11.5px; color: #52525B; margin-top: 14px; line-height: 1.6;">
          How many edges are flipped per drilled case. (No per-case selection for flips yet.)
        </p>
      </div>
    {/if}

    {#if view === "twists"}
      <div data-testid="count-selectors" style="margin-top: 18px;">
        <div>
          <span class="overline font-head" style="font-size: 11px; color: #A1A1AA; display: block; margin-bottom: 6px;">Corner twists (count)</span>
          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            {#each TWIST_COUNTS_AVAILABLE as n}
              {@const on = (settings.twistCounts || [2]).includes(n)}
              <button
                data-testid="twist-count-{n}"
                data-active={on}
                on:click={() => toggleCount("twistCounts", n)}
                class="font-mono"
                style="width: 34px; height: 34px; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 700; border: {on ? '1px solid var(--active)' : '1px solid var(--line)'}; background: {on ? 'var(--success)' : 'var(--surface-2)'}; color: {on ? '#04120a' : '#7a7a7a'};"
              >
                {n}
              </button>
            {/each}
          </div>
        </div>
        <p class="font-mono" style="font-size: 11.5px; color: #52525B; margin-top: 14px; line-height: 1.6;">
          How many corners are twisted per drilled case. (No per-case selection for twists yet.)
        </p>
      </div>
    {/if}

    {#if !isPieceView}
      <!-- Grid -->
      <div style="overflow-x: hidden; touch-action: {isMobile ? 'pan-y' : 'none'}; padding-bottom: 4px; margin-top: 14px;">
        <div style="display: inline-block; user-select: none;">
          <!-- column header -->
          <div style="display: flex; gap: {gap}px; margin-bottom: {gap}px; margin-left: {label + gap}px;">
            {#each letters as t2}
              <button
                data-testid="subset-col-{t2}"
                on:click={() => commitBulk(allDisabledForLetter(t2, work) ? "enable" : "disable", (a, b) => a === t2 || b === t2)}
                class="font-mono"
                style="width: {cell}px; height: {label}px; font-size: 10px; color: #A1A1AA; background: transparent; border: none; cursor: pointer; padding: 0;"
              >
                {t2.toUpperCase()}
              </button>
            {/each}
          </div>

          {#each letters as t1}
            <div style="display: flex; gap: {gap}px; margin-bottom: {gap}px; align-items: center;">
              <button
                data-testid="subset-row-{t1}"
                on:click={() => commitBulk(allDisabledForLetter(t1, work) ? "enable" : "disable", (a, b) => a === t1 || b === t1)}
                class="font-mono"
                style="width: {label}px; height: {cell}px; margin-right: {gap}px; font-size: 10px; color: #A1A1AA; background: transparent; border: none; cursor: pointer; padding: 0; text-align: right;"
              >
                {t1.toUpperCase()}
              </button>

              {#each letters as t2}
                {#if isHidden(t1, t2)}
                  <div style="width: {cell}px; height: {cell}px; flex: 0 0 auto;"></div>
                {:else}
                  {@const st = stateOf(t1, t2, work, drag)}
                  {@const isBuf = st === "bufferEnabled" || st === "bufferDisabled"}
                  {@const imp = st === "impossible"}
                  <!-- svelte-ignore a11y-click-events-have-key-events -->
                  <!-- svelte-ignore a11y-no-static-element-interactions -->
                  <div
                    data-testid="subset-cell-{t1}-{t2}"
                    data-state={st}
                    data-subcell="1"
                    data-t1={t1}
                    data-t2={t2}
                    on:pointerdown={(e) => { if (!imp) { e.preventDefault(); startDrag(t1, t2); } }}
                    on:pointerenter={() => { if (!imp) extendDrag(t1, t2); }}
                    on:click={() => toggleCell(t1, t2)}
                    title="{t1.toUpperCase()}{t2.toUpperCase()}"
                    style="width: {cell}px; height: {cell}px; border-radius: 3px; flex: 0 0 auto; background: {SUBSET_COLORS[st]}; background-image: {isBuf ? STRIPES : 'none'}; opacity: {isBuf ? 0.42 : 1}; border: {imp ? '1px solid #2a2a2e' : '1px solid rgba(0,0,0,0.35)'}; cursor: {imp ? 'not-allowed' : 'pointer'};"
                  ></div>
                {/if}
              {/each}
            </div>
          {/each}
        </div>
      </div>

      <!-- Controls + instructions + legend -->
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px;">
        <button data-testid="subset-enable-all" on:click={() => commitBulk("enable")} style="{ghostBtn} font-size: 12px; flex: 1 1 120px; justify-content: center;">Enable all</button>
        <button data-testid="subset-disable-all" on:click={() => commitBulk("disable")} style="{ghostBtn} font-size: 12px; flex: 1 1 120px; justify-content: center;">Disable all</button>
      </div>

      <p class="font-mono" style="font-size: 11.5px; color: #52525B; margin-top: 12px; line-height: 1.6;">
        One cell = one pair {"{A,B}"} (both commutators AB and BA). Only the bottom-left triangle is shown since a pair is learnt as a single unit; enabling/disabling a cell applies to both directions. Click or drag to paint. Click a row/column label to toggle every pair containing that letter.
      </p>

      <!-- Legend -->
      <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px;">
        {#each legend as [k, l]}
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="width: 14px; height: 14px; border-radius: 3px; background: {SUBSET_COLORS[k]}; opacity: {k.startsWith('buffer') ? 0.4 : 1}; background-image: {k.startsWith('buffer') ? STRIPES : 'none'}; border: {k === 'impossible' ? '1px solid #2a2a2e' : 'none'}; display: inline-block; flex: 0 0 auto;"></span>
            <span class="font-mono" style="font-size: 11px; color: #A1A1AA;">{l}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
