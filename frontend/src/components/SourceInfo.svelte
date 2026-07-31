<script>
  import { onDestroy, tick } from "svelte";
  import { Info } from "lucide-svelte";

  export let sources = [];
  export let testid = "";

  let open = false;
  let pos = null;
  let btnRef = null;
  let popRef = null;

  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  function place() {
    if (!btnRef) return;
    const r = btnRef.getBoundingClientRect();
    const W = 240, H = 220, GAP = 6;
    let left = r.right - W;
    if (left < 8) left = 8;
    if (left + W > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - W);
    let top = r.bottom + GAP;
    if (top + H > window.innerHeight - 8) top = Math.max(8, r.top - GAP - H);
    pos = { left, top };
  }

  async function toggle(e) {
    e.stopPropagation();
    open = !open;
    if (open) {
      place();
      await tick();
      place();
    }
  }

  function handleDocClick(e) {
    if (!open) return;
    if (btnRef && btnRef.contains(e.target)) return;
    if (popRef && popRef.contains(e.target)) return;
    open = false;
  }

  function handleKeydown(e) {
    if (open && e.key === "Escape") {
      e.stopPropagation();
      open = false;
    }
  }

  function handleScroll() {
    if (open) place();
  }

  $: if (open) {
    if (typeof window !== "undefined") {
      window.addEventListener("mousedown", handleDocClick);
      window.addEventListener("keydown", handleKeydown, true);
      window.addEventListener("resize", place);
      window.addEventListener("scroll", handleScroll, true);
    }
  } else {
    if (typeof window !== "undefined") {
      window.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", handleScroll, true);
    }
  }

  onDestroy(() => {
    if (typeof window !== "undefined") {
      window.removeEventListener("mousedown", handleDocClick);
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", handleScroll, true);
    }
  });
</script>

<button
  bind:this={btnRef}
  data-testid={testid}
  on:click={toggle}
  title={`${sources.length} source${sources.length > 1 ? "s" : ""}`}
  style="display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; background: transparent; border: none; color: #A1A1AA; cursor: pointer; padding: 2px; font-size: 11px;"
>
  <Info size={14} />
  <span class="font-mono">{sources.length}</span>
</button>

{#if open && pos}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div
    use:portal
    bind:this={popRef}
    data-testid={`${testid}-popover`}
    class="theme-scroll"
    on:click={(e) => e.stopPropagation()}
    style="position: fixed; left: {pos.left}px; top: {pos.top}px; z-index: 200; width: 240px; max-height: 220px; overflow-y: auto; background: var(--surface-2); border: 1px solid var(--line); border-radius: 10px; padding: 10px; box-shadow: 0 12px 32px rgba(0,0,0,0.55);"
  >
    <div class="overline font-head" style="font-size: 9px; color: var(--active); margin-bottom: 6px;">Sources</div>
    <div style="display: flex; flex-direction: column; gap: 4px;">
      {#each sources as s, i}
        {#if s.url}
          <a
            href={s.url}
            target="_blank"
            rel="noreferrer"
            class="font-mono"
            on:click={(e) => e.stopPropagation()}
            style="font-size: 11px; color: #93C5FD; text-decoration: none; word-break: break-word;"
          >
            {s.name}
          </a>
        {:else}
          <span class="font-mono" style="font-size: 11px; color: #A1A1AA; word-break: break-word;">
            {s.name}
          </span>
        {/if}
      {/each}
    </div>
  </div>
{/if}
