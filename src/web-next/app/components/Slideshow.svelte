<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import { absoluteMediaUrl } from "../api/gallery-api";

  interface Props {
    images: GalleryImage[];
    displayName: (image: GalleryImage) => string;
    showNames: boolean;
    watermark?: string;
    onclose: () => void;
  }
  let { images, displayName, showNames, watermark, onclose }: Props = $props();
  let dialog = $state<HTMLDialogElement>();
  let index = $state(0);
  let image = $derived(images[index]!);
  let namePosition = $state<"top-left" | "top-right" | "bottom-left" | "bottom-right">("bottom-right");
  const positions = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

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

<dialog bind:this={dialog} class="modern-slideshow" aria-label="Slideshow" oncancel={(event) => { event.preventDefault(); onclose(); }} onclick={(event) => { if (event.target === dialog) onclose(); }}>
  <button type="button" class="slideshow-close" aria-label="Close slideshow" onclick={onclose}>×</button>
  <figure data-name-position={namePosition}>
    {#key image.path}<img src={absoluteMediaUrl(image)} alt={displayName(image)} />{/key}
    {#if showNames}<figcaption>{displayName(image)}</figcaption>{/if}
    {#if watermark}<span class="slideshow-watermark">{watermark}</span>{/if}
  </figure>
</dialog>
