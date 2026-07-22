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
    watermarkHref: string;
    watermarkPosition: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    colorsFor: (image: GalleryImage) => OverlayColors;
    onclose: () => void;
    onreturn: (image: GalleryImage) => void;
  }
  let { images, displayName, showNames, watermark, watermarkHref, watermarkPosition, colorsFor, onclose, onreturn }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let index = $state(0);
  let image = $derived(images[index]!);
  let previousImage = $state<GalleryImage>();
  let fadeTimer: number | undefined;
  let advanceTimer: number | undefined;
  let mounted = false;
  const preloads = new Map<string, Promise<void>>();
  let namePosition = $state<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
  const oppositePositions = { "top-left": "bottom-right", "top-right": "bottom-left", "bottom-left": "top-right", "bottom-right": "top-left" } as const;
  let colors = $derived(colorsFor(image));
  let effectiveWatermarkPosition = $derived(showNames ? oppositePositions[namePosition] : watermarkPosition);

  function advance(): void {
    previousImage = image;
    index = (index + 1) % images.length;
    namePosition = positions[Math.floor(Math.random() * positions.length)]!;
    window.clearTimeout(fadeTimer);
    fadeTimer = window.setTimeout(() => { previousImage = undefined; }, 1_000);
  }

  function preloadAt(candidateIndex: number): Promise<void> {
    const candidate = images[candidateIndex % images.length]!;
    const existing = preloads.get(candidate.path);
    if (existing) return existing;

    const preload = new Image();
    const ready = new Promise<void>((resolve) => {
      const finish = async (): Promise<void> => {
        try { await preload.decode(); } catch { /* Loading still completed; the visible image can retry decoding. */ }
        resolve();
      };
      preload.onload = () => { void finish(); };
      preload.onerror = () => resolve();
      preload.src = absoluteMediaUrl(candidate);
    });
    preloads.set(candidate.path, ready);
    return ready;
  }

  function scheduleAdvance(): void {
    window.clearTimeout(advanceTimer);
    advanceTimer = window.setTimeout(async () => {
      await preloadAt(index + 1);
      if (!mounted) return;
      advance();
      void preloadAt(index + 1);
      scheduleAdvance();
    }, 5_000);
  }

  onMount(() => {
    mounted = true;
    dialog?.showModal();
    document.body.classList.add("slideshow-open");
    void preloadAt(index + 1);
    scheduleAdvance();
    return () => {
      mounted = false;
      window.clearTimeout(advanceTimer);
      window.clearTimeout(fadeTimer);
      document.body.classList.remove("slideshow-open");
    };
  });
</script>

<dialog bind:this={dialog} class="modern-slideshow" aria-label="Slideshow" oncancel={(event) => { event.preventDefault(); onclose(); }} onclick={(event) => { if (event.target === dialog) onclose(); }}>
  <figure data-name-position={namePosition} data-watermark-position={effectiveWatermarkPosition} style={`--slideshow-name-fill:${colors.fill};--slideshow-name-outline:${colors.outline};`}>
    {#if previousImage}<img class="slideshow-image outgoing" src={absoluteMediaUrl(previousImage)} alt="" aria-hidden="true" />{/if}
    {#key image.path}<img class="slideshow-image incoming" src={absoluteMediaUrl(image)} alt={displayName(image)} />{/key}
    {#if showNames && (image.shortName?.en || image.shortName?.ja)}
      <button class="slideshow-name-overlay" type="button" onclick={() => onreturn(image)}>
        {#if image.shortName?.en}<span class="slideshow-short-name-en">{image.shortName.en}</span>{/if}
        {#if image.shortName?.ja}<span class="slideshow-short-name-ja" lang="ja">{image.shortName.ja}</span>{/if}
      </button>
    {/if}
    {#if watermark}<a class="slideshow-watermark" href={watermarkHref} aria-label="Back to gallery">{watermark}</a>{/if}
  </figure>
</dialog>
