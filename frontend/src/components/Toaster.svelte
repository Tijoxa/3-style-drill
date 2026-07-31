<script>
  import { toasts } from '../lib/toast.js';
  import { fly } from 'svelte/transition';
</script>

<div
  style="position: fixed; top: 16px; left: 50%; transform: translateX(-50%); zIndex: 9999; display: flex; flex-direction: column; gap: 8px; align-items: center; pointer-events: none; max-width: 90vw;"
>
  {#each $toasts as t (t.id)}
    <div
      transition:fly={{ y: -20, duration: 200 }}
      style="pointer-events: auto; padding: 10px 16px; border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,0.5); border: 1px solid var(--line);
      background: {t.type === 'success' ? '#142918' : t.type === 'error' ? '#2c1517' : 'var(--surface-2)'};
      color: {t.type === 'success' ? '#39FF14' : t.type === 'error' ? '#FF3B30' : '#fff'};"
    >
      {t.message}
    </div>
  {/each}
</div>
