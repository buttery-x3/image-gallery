<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import { absoluteMediaUrl } from "../api/gallery-api";
  import type { OverlayColors } from "../overlay-colors";
  import Icon from "./Icon.svelte";

  interface Props {
    image: GalleryImage;
    displayName: string;
    favorite: boolean;
    showNames: boolean;
    namePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    nameVisible: boolean;
    watermark?: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    colors: OverlayColors;
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
  let { image, displayName, favorite, showNames, namePosition, nameVisible, watermark, watermarkPosition, colors, hasPrevious, hasNext, onclose, onnavigate, onfavorite, oninfo, onreport, ontogglename, onposition, onreturn }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let imageElement = $state<HTMLImageElement>();
  let englishNameSize = $state(40);
  let touchStart: { x: number; y: number; at: number } | undefined;
  const oppositePositions = { "top-left": "bottom-right", "top-right": "bottom-left", "bottom-left": "top-right", "bottom-right": "top-left" } as const;
  let effectiveWatermarkPosition = $derived(showNames ? oppositePositions[namePosition] : watermarkPosition);

  onMount(() => {
    dialog?.showModal();
    document.body.classList.add("lightbox-open");
    const syncNameScale = (): void => {
      const imageWidth = imageElement?.getBoundingClientRect().width ?? 0;
      if (imageWidth > 0) englishNameSize = Math.min(72, Math.max(22, imageWidth * .09));
    };
    const observer = new ResizeObserver(syncNameScale);
    if (imageElement) observer.observe(imageElement);
    syncNameScale();
    return () => {
      observer.disconnect();
      document.body.classList.remove("lightbox-open");
    };
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
  <button class="lightbox-close" type="button" aria-label="Close preview" onclick={onclose}><Icon name="close" /></button>
  <div class="lightbox-grid">
    <section class="lightbox-content">
      <div class="lightbox-media" data-name-position={namePosition} data-watermark-position={effectiveWatermarkPosition} style={`--lightbox-name-fill:${colors.fill};--lightbox-name-outline:${colors.outline};--lightbox-name-en-size:${englishNameSize}px;--lightbox-name-ja-size:${englishNameSize / 2}px;`}>
        <img bind:this={imageElement} src={absoluteMediaUrl(image)} alt={displayName} />
        <button class="lightbox-nav previous" type="button" aria-label="Previous image" disabled={!hasPrevious} onclick={() => onnavigate(-1)}><Icon name="chevron-left" /></button>
        <button class="lightbox-nav next" type="button" aria-label="Next image" disabled={!hasNext} onclick={() => onnavigate(1)}><Icon name="chevron-right" /></button>
        {#if showNames && nameVisible && (image.shortName?.en || image.shortName?.ja)}
          <button class="lightbox-name-overlay" type="button" onclick={onreturn}>
            {#if image.shortName?.en}<span class="lightbox-short-name-en">{image.shortName.en}</span>{/if}
            {#if image.shortName?.ja}<span class="lightbox-short-name-ja" lang="ja">{image.shortName.ja}</span>{/if}
          </button>
        {/if}
        {#if watermark}<button class="lightbox-watermark" type="button" onclick={onreturn}>{watermark}</button>{/if}
      </div>
      <nav class="lightbox-actions" aria-label="Image actions">
        <button type="button" onclick={oninfo}><Icon name="info" /> <span>Information</span></button>
        <button class:is-favorite={favorite} type="button" aria-pressed={favorite} onclick={onfavorite}><Icon name="favorite" /> <span>{favorite ? "Remove favorite" : "Add favorite"}</span></button>
        {#if onreport}<button class="lightbox-action-report" type="button" onclick={onreport}><Icon name="report" /> <span>Report image</span></button>{/if}
        {#if showNames}<button type="button" aria-pressed={nameVisible} onclick={ontogglename}>Aa <span>{nameVisible ? "Hide name" : "Show name"}</span></button>{/if}
        {#if showNames}<button type="button" onclick={onposition}>⌖ <span>Move name</span></button>{/if}
      </nav>
    </section>
  </div>
</dialog>
