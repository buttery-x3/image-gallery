<script lang="ts">
  type IconName = "copy-image" | "copy-link" | "favorite" | "info" | "menu" | "shuffle" | "slideshow";
  let { name }: { name: IconName } = $props();
</script>

<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  {#if name === "favorite"}
    <path d="m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35-5.7-3-5.7 3 1.09-6.35-4.62-4.5 6.38-.93L12 2.75Z" />
  {:else if name === "info"}
    <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.25h.01" />
  {:else if name === "copy-image"}
    <rect x="4" y="4" width="13" height="13" rx="2" /><path d="m5 14 3.5-3.5 2.5 2.5 2-2 4 4M9 20h9a2 2 0 0 0 2-2V9" /><circle cx="13.5" cy="8.5" r="1" />
  {:else if name === "copy-link"}
    <path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.42 1.42M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 1 0 5.66 5.66l1.42-1.42" />
  {:else if name === "menu"}
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  {:else if name === "shuffle"}
    <path d="M16 3h5v5M21 3l-6.5 6.5a4 4 0 0 1-5.7 0L3 3.7M16 21h5v-5M21 21l-6.5-6.5a4 4 0 0 0-5.7 0L3 20.3" />
  {:else if name === "slideshow"}
    <path d="m9 5 10 7-10 7V5Z" />
  {/if}
</svg>
