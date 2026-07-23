<script lang="ts">
  type IconName = "chevron-left" | "chevron-right" | "close" | "copy-image" | "copy-link" | "favorite" | "filter-list" | "github" | "info" | "menu" | "palette" | "report" | "shuffle" | "slideshow";
  let { name }: { name: IconName } = $props();
</script>

<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  {#if name === "favorite"}
    <path d="m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35-5.7-3-5.7 3 1.09-6.35-4.62-4.5 6.38-.93L12 2.75Z" />
  {:else if name === "chevron-left"}
    <path d="m15 18-6-6 6-6" />
  {:else if name === "chevron-right"}
    <path d="m9 6 6 6-6 6" />
  {:else if name === "close"}
    <path d="M6 6l12 12M18 6 6 18" />
  {:else if name === "report"}
    <path d="M12 8v5M12 17h.01" /><path d="M10.3 3.9 2.5 17.4A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.6L13.7 3.9a2 2 0 0 0-3.4 0Z" />
  {:else if name === "info"}
    <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.25h.01" />
  {:else if name === "copy-image"}
    <rect x="4" y="4" width="13" height="13" rx="2" /><path d="m5 14 3.5-3.5 2.5 2.5 2-2 4 4M9 20h9a2 2 0 0 0 2-2V9" /><circle cx="13.5" cy="8.5" r="1" />
  {:else if name === "copy-link"}
    <path d="M10 14a4 4 0 0 0 5.66 0l2.83-2.83a4 4 0 0 0-5.66-5.66l-1.42 1.42M14 10a4 4 0 0 0-5.66 0l-2.83 2.83a4 4 0 1 0 5.66 5.66l1.42-1.42" />
  {:else if name === "menu"}
    <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
  {:else if name === "filter-list"}
    <path d="M4 6h16M4 12h11M4 18h7" /><circle cx="18" cy="12" r="1.5" /><circle cx="14" cy="18" r="1.5" />
  {:else if name === "github"}
    <path d="M15.5 21v-3.6c0-1 .1-1.5-.5-2 2.9-.3 6-1.4 6-6.5 0-1.4-.5-2.6-1.3-3.5.1-.3.6-1.7-.1-3.4 0 0-1.1-.3-3.6 1.3a12.4 12.4 0 0 0-6.5 0C7 1.7 5.9 2 5.9 2c-.7 1.7-.2 3.1-.1 3.4A5 5 0 0 0 4.5 9c0 5 3 6.1 5.9 6.5-.4.3-.7.8-.8 1.5-.7.3-2.6.9-3.7-1.1-.7-1.2-1.8-1.3-1.8-1.3-1.1 0-.1.7-.1.7.8.4 1.3 1.8 1.3 1.8.7 2 2.5 1.4 3.1 1.1V21" />
  {:else if name === "palette"}
    <path d="M12 3a9 9 0 1 0 0 18h1.2a2 2 0 0 0 1.5-3.3 1.6 1.6 0 0 1 1.2-2.7H18a3 3 0 0 0 3-3 9 9 0 0 0-9-9Z" /><circle cx="7.5" cy="10" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="6.8" r="1" fill="currentColor" stroke="none" /><circle cx="14.2" cy="6.6" r="1" fill="currentColor" stroke="none" /><circle cx="17" cy="9.5" r="1" fill="currentColor" stroke="none" />
  {:else if name === "shuffle"}
    <path d="M16 3h5v5M21 3l-6.5 6.5a4 4 0 0 1-5.7 0L3 3.7M16 21h5v-5M21 21l-6.5-6.5a4 4 0 0 0-5.7 0L3 20.3" />
  {:else if name === "slideshow"}
    <path d="m9 5 10 7-10 7V5Z" />
  {/if}
</svg>
