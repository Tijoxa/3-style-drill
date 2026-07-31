<script>
  import { onMount, onDestroy } from "svelte";
  import { fade, scale } from "svelte/transition";
  import { Lightbulb, X, ExternalLink, Loader2 } from "lucide-svelte";
  import { fetchHints, fetchCaseHints, STYLE_OPTIONS, CATEGORY_STYLE_OPTIONS } from "../lib/blddb.js";
  import SourceInfo from "./SourceInfo.svelte";

  export let pair = null;
  export let pairText = "";
  export let buffer = "";
  export let maps = null;
  export let style = "nightmare";
  export let setStyle = () => {};
  export let onClose = () => {};

  const NEW_CATEGORIES = ["flips", "twists", "parity", "ltct"];
  const CATEGORY_META = {
    flips:  { label: "Edge Flips",    short: "EDGE FLIPS",    url: "https://v2.blddb.net/flips" },
    twists: { label: "Corner Twists", short: "CORNER TWISTS", url: "https://v2.blddb.net/twists" },
    parity: { label: "Parity",        short: "PARITY",        url: "https://v2.blddb.net/parity" },
    ltct:   { label: "LTCT & T2C",    short: "LTCT / T2C",    url: "https://v2.blddb.net/ltct" },
  };

  let isMobile = typeof window !== "undefined" ? window.innerWidth < 640 : false;
  let loading = true;
  let error = null;
  let data = null;
  let showAll = false;
  let openPopoverIndex = null;

  $: isCategory = pair ? NEW_CATEGORIES.includes(pair.type) : false;
  $: options = isCategory ? CATEGORY_STYLE_OPTIONS : (STYLE_OPTIONS[pair?.type] || STYLE_OPTIONS.corner);
  $: effStyle = options.some((o) => o[0] === style) ? style : "nightmare";

  $: if (effStyle !== style) {
    setStyle(effStyle);
  }

  $: blddbUrl = isCategory
    ? CATEGORY_META[pair.type]?.url
    : (pair?.type === "corner" ? "https://v2.blddb.net/corner" : "https://v2.blddb.net/edge");

  $: {
    if (pair) {
      loadHints(pair, buffer, style, maps);
    }
  }

  async function loadHints(currentPair, currentBuffer, currentStyle, currentMaps) {
    loading = true;
    error = null;
    data = null;
    showAll = false;
    openPopoverIndex = null;
    try {
      const res = isCategory
        ? await fetchCaseHints({ category: currentPair.type, key: currentPair.code, style: currentStyle })
        : await fetchHints({ type: currentPair.type, buffer: currentBuffer, t1: currentPair.t1, t2: currentPair.t2, style: currentStyle, maps: currentMaps });
      data = res;
    } catch (e) {
      error = e.message || String(e);
    } finally {
      loading = false;
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      onClose();
    }
  }

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
  });

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("keydown", handleKeyDown);
    }
  });

  $: list = data && data.list ? data.list : [];
  $: recAlg = data && data.recommended;
  $: recComm = data && data.recCommutator;
  $: recSources = (data && data.recSources) || [];
  $: rest = list.filter((a) => a.alg !== recAlg);

  const selectStyle = "padding: 10px 12px; border-radius: 8px; border: 1px solid var(--line); background: var(--surface-2); color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 14px;";
  const iconBtn = "display: grid; place-items: center; width: 38px; height: 38px; border-radius: 10px; border: 1px solid var(--line); background: var(--surface); color: #fff; cursor: pointer;";
  const ghostBtn = "display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--line); background: transparent; color: #A1A1AA; cursor: pointer; font-size: 13px; font-family: 'JetBrains Mono', monospace;";
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<div transition:fade={{ duration: 150 }} on:click={onClose} style="position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 60;"></div>
<div style="position: fixed; inset: 0; z-index: 61; display: flex; align-items: center; justify-content: center; padding: {isMobile ? '12px' : '24px'}; pointer-events: none; box-sizing: border-box;">
  <div
    data-testid="hint-modal"
    transition:scale={{ start: 0.96, duration: 150 }}
    class="theme-scroll"
    style="width: {isMobile ? 'min(94vw, 520px)' : '520px'}; max-width: 100%; max-height: 100%; pointer-events: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: {isMobile ? '18px' : '24px'}; overflow-y: auto;"
  >
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <div style="display: flex; align-items: center; gap: 12px;">
        <Lightbulb size={20} style="color: var(--active);" />
        <h2 class="font-head" style="font-size: 24px; margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">
          Hint · <span data-testid="hint-pair" class="font-mono">{pairText}</span>
        </h2>
      </div>
      <button data-testid="hint-close-btn" on:click={onClose} style={iconBtn}><X size={18} /></button>
    </div>

    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 16px; flex-wrap: wrap;">
      <span class="overline font-head" style="font-size: 11px; color: #A1A1AA;">Algorithm style</span>
      <select data-testid="hint-style-select" value={style} on:change={(e) => setStyle(e.target.value)} style="{selectStyle} min-width: 160px;">
        {#each options as [v, label]}
          <option value={v}>{label}</option>
        {/each}
      </select>
    </div>

    <div style="margin-top: 18px; min-height: 80px;">
      {#if loading}
        <div data-testid="hint-loading" class="font-mono" style="display: flex; align-items: center; gap: 10px; color: #A1A1AA; font-size: 13px; padding: 20px 0;">
          <Loader2 size={16} class="spin" /> Loading algorithms from v2.blddb.net…
        </div>
      {/if}

      {#if !loading && error}
        <div data-testid="hint-error" class="font-mono" style="color: var(--error); font-size: 13px; line-height: 1.6;">
          Couldn't reach v2.blddb.net ({error}). Check your connection and try again.
        </div>
      {/if}

      {#if !loading && !error && data && data.notFound}
        <div data-testid="hint-notfound" class="font-mono" style="color: #A1A1AA; font-size: 13px; line-height: 1.6;">
          No algorithm found in v2.blddb.net for this case{data.key ? ` (${data.key})` : ""}. It may be a same-piece or unsupported case.
        </div>
      {/if}

      {#if !loading && !error && data && !data.notFound}
        {#if recAlg}
          <div data-testid="hint-recommended" style="border: 1px solid var(--active); border-radius: 12px; padding: 16px; background: var(--surface-2);">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px;">
              <div class="overline font-head" style="font-size: 10px; color: var(--active);">Recommended · {(options.find((o) => o[0] === effStyle) || [])[1]}</div>
              {#if recSources.length > 0}
                <SourceInfo sources={recSources} testid="hint-rec-sources" />
              {/if}
            </div>

            {#if recComm}
              <div class="font-mono" data-testid="hint-rec-comm" style="font-size: 20px; font-weight: 800; letter-spacing: 0.02em; word-break: break-word;">{recComm}</div>
              <div class="font-mono" data-testid="hint-rec-alg" style="font-size: 13px; color: #A1A1AA; margin-top: 8px;">{recAlg}</div>
            {:else}
              <div class="font-mono" data-testid="hint-rec-alg" style="font-size: 20px; font-weight: 800; letter-spacing: 0.02em; word-break: break-word;">{recAlg}</div>
            {/if}
          </div>
        {/if}

        {#if rest.length > 0}
          <div style="margin-top: 14px;">
            <button data-testid="hint-toggle-all" on:click={() => { showAll = !showAll; }} style="{ghostBtn} font-size: 12px;">
              {showAll ? "Hide" : "Show"} all {list.length} algorithms
            </button>
            {#if showAll}
              <div data-testid="hint-all-list" style="margin-top: 12px; display: flex; flex-direction: column; gap: 8px;">
                {#each rest as a, i}
                  <div style="border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; background: var(--bg);">
                    <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;">
                      <div class="font-mono" style="font-size: 14px; font-weight: 700; word-break: break-word;">{a.commutator || a.alg}</div>
                      {#if a.sources && a.sources.length > 0}
                        <SourceInfo sources={a.sources} testid={`hint-src-${i}`} />
                      {/if}
                    </div>

                    {#if a.commutator}
                      <div class="font-mono" style="font-size: 12px; color: #A1A1AA; margin-top: 4px;">{a.alg}</div>
                    {/if}
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <a
      data-testid="hint-blddb-link"
      href={blddbUrl}
      target="_blank"
      rel="noreferrer"
      class="font-mono"
      style="display: inline-flex; align-items: center; gap: 6px; margin-top: 18px; font-size: 12px; color: #A1A1AA; text-decoration: none;"
    >
      <ExternalLink size={13} /> Data from v2.blddb.net (opens in new window)
    </a>
  </div>
</div>
