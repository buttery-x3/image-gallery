<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import { absoluteMediaUrl, tileMediaUrl } from "../api/gallery-api";
  import type { OverlayColors } from "../overlay-colors";
  import Icon from "./Icon.svelte";

  interface Props {
    image: GalleryImage;
    previousImage?: GalleryImage;
    nextImage?: GalleryImage;
    displayName: string;
    favorite: boolean;
    showNames: boolean;
    namePosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    nameVisible: boolean;
    watermark?: string;
    watermarkHref: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    colors: OverlayColors;
    onclose: () => void;
    onnavigate: (offset: -1 | 1) => void;
    onfavorite: () => void;
    oninfo: () => void;
    onreport?: () => void;
    ontogglename: () => void;
    onposition: () => void;
    onreturn: () => void;
  }
  let { image, previousImage, nextImage, displayName, favorite, showNames, namePosition, nameVisible, watermark, watermarkHref, watermarkPosition, colors, onclose, onnavigate, onfavorite, oninfo, onreport, ontogglename, onposition, onreturn }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let imageElement = $state<HTMLImageElement>();
  let englishNameSize = $state(40);
  let loadedOriginalPath = $state<string>();
  let touchStart: { x: number; y: number; at: number } | undefined;
  const originalPreloads = new Map<string, Promise<void>>();
  const oppositePositions = { "top-left": "bottom-right", "top-right": "bottom-left", "bottom-left": "top-right", "bottom-right": "top-left" } as const;
  let effectiveWatermarkPosition = $derived(showNames ? oppositePositions[namePosition] : watermarkPosition);
  let imageAspectRatio = $derived(image.width && image.height && image.width > 0 && image.height > 0 ? image.width / image.height : 1);

  function preloadOriginal(candidate: GalleryImage | undefined): Promise<void> | undefined {
    if (!candidate) return undefined;
    const existing = originalPreloads.get(candidate.path);
    if (existing) return existing;
    const preload = new Image();
    const ready = new Promise<void>((resolve) => {
      const finish = async (): Promise<void> => {
        try { await preload.decode(); } catch { /* The visible image can retry decoding if necessary. */ }
        resolve();
      };
      preload.onload = () => { void finish(); };
      preload.onerror = () => resolve();
      preload.src = absoluteMediaUrl(candidate);
    });
    originalPreloads.set(candidate.path, ready);
    return ready;
  }

  $effect(() => {
    image.path;
    void preloadOriginal(previousImage);
    void preloadOriginal(nextImage);
  });

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

  function handleBackdropClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest(".lightbox-media, .lightbox-nav, .lightbox-actions button")) return;
    event.preventDefault();
    onreturn();
  }

</script>

<dialog
  bind:this={dialog}
  class="modern-lightbox"
  aria-label="Image preview"
  onkeydown={keydown}
  oncancel={(event) => { event.preventDefault(); onclose(); }}
  onclick={handleBackdropClick}
  ontouchstart={(event) => { const touch = event.touches[0]; if (touch) touchStart = { x: touch.clientX, y: touch.clientY, at: Date.now() }; }}
  ontouchend={touchend}
>
  <div class="lightbox-grid">
    <section class="lightbox-content">
      <button class="lightbox-nav previous" type="button" aria-label="Previous image" disabled={!previousImage} onclick={() => onnavigate(-1)}><Icon name="chevron-left" /></button>
      <div class="lightbox-media" data-name-position={namePosition} data-watermark-position={effectiveWatermarkPosition} style={`--lightbox-name-fill:${colors.fill};--lightbox-name-outline:${colors.outline};--lightbox-name-en-size:${englishNameSize}px;--lightbox-name-ja-size:${englishNameSize / 2}px;`}>
        <div class="lightbox-image-stack" class:has-preview={Boolean(image.previewUrl)} style={`--lightbox-image-aspect:${imageAspectRatio};`}>
          {#if image.previewUrl}<img class="lightbox-preview" src={tileMediaUrl(image)} alt="" aria-hidden="true" width={image.width} height={image.height} />{/if}
          <img bind:this={imageElement} class="lightbox-original" class:is-loaded={loadedOriginalPath === image.path} src={absoluteMediaUrl(image)} alt={displayName} width={image.width} height={image.height} onload={() => { loadedOriginalPath = image.path; }} />
        </div>
        {#if showNames && nameVisible && image.metadataDisplay}
          <div class="lightbox-name-overlay">
            <button class="overlay-name-return" type="button" onclick={onreturn}>
              <span class="lightbox-short-name-en">{image.metadataDisplay.name}</span>
            </button>
            {#if image.metadataDisplay.subtitle}
              {#if image.metadataDisplay.subtitleUrl}
                <a class="lightbox-short-name-ja overlay-subtitle-link" href={image.metadataDisplay.subtitleUrl} target="_blank" rel="noopener noreferrer">{image.metadataDisplay.subtitle}</a>
              {:else}
                <button class="lightbox-short-name-ja overlay-name-return" type="button" onclick={onreturn}>{image.metadataDisplay.subtitle}</button>
              {/if}
            {/if}
          </div>
        {:else if showNames && nameVisible && (image.shortName?.en || image.shortName?.ja)}
          <button class="lightbox-name-overlay" type="button" onclick={onreturn}>
            {#if image.shortName?.en}<span class="lightbox-short-name-en">{image.shortName.en}</span>{/if}
            {#if image.shortName?.ja}<span class="lightbox-short-name-ja" lang="ja">{image.shortName.ja}</span>{/if}
          </button>
        {/if}
        {#if watermark}<a class="lightbox-watermark" href={watermarkHref} aria-label="Back to gallery">{watermark}</a>{/if}
      </div>
      <button class="lightbox-nav next" type="button" aria-label="Next image" disabled={!nextImage} onclick={() => onnavigate(1)}><Icon name="chevron-right" /></button>
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
