<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import { absoluteMediaUrl } from "../api/gallery-api";
  import type { OverlayColors } from "../overlay-colors";

  interface Props {
    images: GalleryImage[];
    displayName: (image: GalleryImage) => string;
    showNames: boolean;
    watermark?: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    colorsFor: (image: GalleryImage) => OverlayColors;
    onclose: () => void;
    onreport?: (image: GalleryImage) => void;
  }
  let { images, displayName, showNames, watermark, watermarkPosition, colorsFor, onclose, onreport }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let index = $state(0);
  let image = $derived(images[index]!);
  let namePosition = $state<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const oppositePositions = { "top-left": "bottom-right", "top-right": "bottom-left", "bottom-left": "top-right", "bottom-right": "top-left" } as const;
  let colors = $derived(colorsFor(image));
  let effectiveWatermarkPosition = $derived(showNames ? oppositePositions[namePosition] : watermarkPosition);

  function navigate(offset: -1 | 1): void {
    index = (index + offset + images.length) % images.length;
    namePosition = positions[Math.floor(Math.random() * positions.length)]!;
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "ArrowLeft") { event.preventDefault(); navigate(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); navigate(1); }
  }

  onMount(() => {
    dialog?.showModal();
    document.body.classList.add("slideshow-open");
    const timer = window.setInterval(() => {
      index = (index + 1) % images.length;
      namePosition = positions[Math.floor(Math.random() * positions.length)]!;
    }, 5_000);
    return () => {
      window.clearInterval(timer);
      document.body.classList.remove("slideshow-open");
    };
  });
</script>

<dialog bind:this={dialog} class="modern-slideshow" aria-label="Slideshow" onkeydown={keydown} oncancel={(event) => { event.preventDefault(); onclose(); }} onclick={(event) => { if (event.target === dialog) onclose(); }}>
  <button type="button" class="slideshow-close" aria-label="Close slideshow" onclick={onclose}>×</button>
  <figure data-name-position={namePosition} data-watermark-position={effectiveWatermarkPosition} style={`--slideshow-name-fill:${colors.fill};--slideshow-name-outline:${colors.outline};`}>
    {#key image.path}<img src={absoluteMediaUrl(image)} alt={displayName(image)} />{/key}
    <button class="slideshow-nav previous" type="button" aria-label="Previous image" onclick={() => navigate(-1)}>‹</button>
    <button class="slideshow-nav next" type="button" aria-label="Next image" onclick={() => navigate(1)}>›</button>
    {#if onreport}<button class="slideshow-report" type="button" onclick={() => onreport(image)}>Report image</button>{/if}
    {#if showNames && (image.shortName?.en || image.shortName?.ja)}
      <button class="slideshow-name-overlay" type="button" onclick={onclose}>
        {#if image.shortName?.en}<span class="slideshow-short-name-en">{image.shortName.en}</span>{/if}
        {#if image.shortName?.ja}<span class="slideshow-short-name-ja" lang="ja">{image.shortName.ja}</span>{/if}
      </button>
    {/if}
    {#if watermark}<button class="slideshow-watermark" type="button" onclick={onclose}>{watermark}</button>{/if}
  </figure>
</dialog>
