<script>
  import { onMount, onDestroy } from "svelte";

  export let caseStartRef = null;
  export let caseStoppedRef = null;
  export let pairKey = "";
  export let isPaused = false;

  let now = Date.now();
  let interval = null;

  $: {
    if (pairKey || isPaused !== undefined) {
      restartInterval();
    }
  }

  function restartInterval() {
    if (typeof window === "undefined") return;
    if (interval) clearInterval(interval);
    if (!isPaused) {
      interval = setInterval(() => {
        now = Date.now();
      }, 100);
    }
  }

  onMount(() => {
    restartInterval();
  });

  onDestroy(() => {
    if (interval) clearInterval(interval);
  });

  $: ms = (() => {
    if (caseStoppedRef != null) return caseStoppedRef;
    if (caseStartRef != null && !isPaused) return Math.max(0, now - caseStartRef);
    return 0;
  })();

  $: running = caseStartRef != null && caseStoppedRef == null && !isPaused;
  $: stateStr = isPaused ? "paused" : caseStoppedRef != null ? "stopped" : running ? "running" : "waiting";
  $: textColor = isPaused ? "#F59E0B" : running ? "#D4D4D8" : "#52525B";
</script>

<div
  data-testid="recognition-timer"
  data-timer-state={stateStr}
  class="font-mono"
  style="color: {textColor}; font-size: 14px; transition: color 150ms ease; display: flex; align-items: center; gap: 6px;"
>
  {(ms / 1000).toFixed(1)}s
  {#if isPaused}
    <span style="font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #F59E0B; font-weight: 700;">(PAUSED)</span>
  {/if}
</div>
