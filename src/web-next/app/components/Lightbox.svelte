<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import { absoluteMediaUrl } from "../api/gallery-api";

  interface Props {
    image: GalleryImage;
    displayName: string;
    favorite: boolean;
    showNames: boolean;
    namePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    nameVisible: boolean;
    watermark?: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    hasPrevious: boolean;
    hasNext: boolean;
    onclose: () => void;
    onnavigate: (offset: -1 | 1) => void;
    onfavorite: () => void;
    oninfo: () => void;
    onreport?: () => void;
    ontogglename: () => void;
    onposition: () => void;
    onreturn: () => void;
  }
  let { image, displayName, favorite, showNames, namePosition, nameVisible, watermark, watermarkPosition, hasPrevious, hasNext, onclose, onnavigate, onfavorite, oninfo, onreport, ontogglename, onposition, onreturn }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let touchStart: { x: number; y: number; at: number } | undefined;

  onMount(() => {
    dialog?.showModal();
    document.body.classList.add("lightbox-open");
    return () => document.body.classList.remove("lightbox-open");
  });

  function keydown(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") { event.preventDefault(); onnavigate(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); onnavigate(1); }
  }

  function touchend(event: TouchEvent): void {
    const start = touchStart;
    touchStart = undefined;
    const touch = event.changedTouches[0];
    if (!start || !touch || Date.now() - start.at > 700) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.3) onnavigate(dx < 0 ? 1 : -1);
  }
</script>

<dialog
  bind:this={dialog}
  class="modern-lightbox"
  aria-label="Image preview"
  onkeydown={keydown}
  oncancel={(event) => { event.preventDefault(); onclose(); }}
  onclick={(event) => { if (event.target === dialog) onclose(); }}
  ontouchstart={(event) => { const touch = event.touches[0]; if (touch) touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() }; }}
  ontouchend={touchend}
>
  <button class="lightbox-close" type="button" aria-label="Close preview" onclick={onclose}>×</button>
  <div class="lightbox-grid">
    <button class="lightbox-nav previous" type="button" aria-label="Previous image" disabled={!hasPrevious} onclick={() => onnavigate(-1)}>‹</button>
    <section class="lightbox-content">
      <button class="lightbox-title" type="button" onclick={onreturn}>{displayName}</button>
      <div class="lightbox-media" data-name-position={namePosition} data-watermark-position={watermarkPosition}>
        <img src={absoluteMediaUrl(image)} alt={displayName} />
        {#if showNames && nameVisible && (image.shortName?.en || image.shortName?.ja)}
          <button class="lightbox-name-overlay" type="button" onclick={onreturn}>
            {#if image.shortName?.en}<span>{image.shortName.en}</span>{/if}
            {#if image.shortName?.ja}<small lang="ja">{image.shortName.ja}</small>{/if}
          </button>
        {/if}
        {#if watermark}<button class="lightbox-watermark" type="button" onclick={onreturn}>{watermark}</button>{/if}
      </div>
      <nav class="lightbox-actions" aria-label="Image actions">
        <button type="button" onclick={oninfo}>ⓘ <span>Information</span></button>
        <button class:is-favorite={favorite} type="button" aria-pressed={favorite} onclick={onfavorite}>★ <span>{favorite ? "Remove favorite" : "Add favorite"}</span></button>
        {#if showNames}<button type="button" aria-pressed={nameVisible} onclick={ontogglename}>Aa <span>{nameVisible ? "Hide name" : "Show name"}</span></button>{/if}
        {#if showNames}<button type="button" onclick={onposition}>⌖ <span>Move name</span></button>{/if}
        {#if onreport}<button type="button" onclick={onreport}>! <span>Report</span></button>{/if}
      </nav>
    </section>
    <button class="lightbox-nav next" type="button" aria-label="Next image" disabled={!hasNext} onclick={() => onnavigate(1)}>›</button>
  </div>
</dialog>
