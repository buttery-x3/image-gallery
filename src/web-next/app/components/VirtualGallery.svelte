<script lang="ts">
  import { onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import type { GalleryAppearancePreferencesV1 } from "../preferences";
  import { calculateMasonryLayout, visibleMasonryIndexes, type MasonryLayout } from "../layout/masonry-layout";
  import { MediaLoadScheduler } from "../services/media-loader";
  import GalleryTile from "./GalleryTile.svelte";

  interface Props {
    images: GalleryImage[];
    backgroundImages: GalleryImage[];
    appearance: GalleryAppearancePreferencesV1;
    favorites: Set<string>;
    displayName: (image: GalleryImage) => string;
    showNames: boolean;
    onopen: (index: number) => void;
    onfavorite: (image: GalleryImage) => void;
    oncopyimage: (image: GalleryImage) => void;
    oncopylink: (image: GalleryImage) => void;
    oninfo: (image: GalleryImage) => void;
    onreport?: (image: GalleryImage) => void;
  }

  let { images, backgroundImages, appearance, favorites, displayName, showNames, onopen, onfavorite, oncopyimage, oncopylink, oninfo, onreport }: Props = $props();
  let host = $state<HTMLElement>();
  let hostWidth = $state(1);
  let viewportTop = $state(0);
  let viewportHeight = $state(typeof window === "undefined" ? 800 : window.innerHeight);
  const scheduler = new MediaLoadScheduler(4);

  let layout = $derived<MasonryLayout>(calculateMasonryLayout(
    images.map((image) => ({ key: image.path, width: image.width, height: image.height })),
    hostWidth,
    appearance.tileWidth,
    appearance.tileRatio,
  ));
  let visibleIndexes = $derived(visibleMasonryIndexes(layout, viewportTop, viewportHeight));

  function measureViewport(): void {
    if (!host) return;
    const documentTop = host.getBoundingClientRect().top + window.scrollY;
    viewportTop = Math.max(0, window.scrollY - documentTop);
    viewportHeight = window.innerHeight;
  }

  onMount(() => {
    let frame: number | undefined;
    const scheduleMeasure = (): void => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => { frame = undefined; measureViewport(); });
    };
    const resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) hostWidth = entry.contentRect.width;
      scheduleMeasure();
    });
    resizeObserver.observe(host!);
    window.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    measureViewport();
    for (const [index, image] of backgroundImages.entries()) {
      scheduler.enqueue(image.path, 1_000_000 + index, () => new Promise<boolean>((resolve) => {
        const preload = new Image();
        preload.onload = () => resolve(true);
        preload.onerror = () => resolve(false);
        preload.src = new URL(image.previewUrl ?? image.url, document.baseURI).href;
      }));
    }
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
    };
  });

  export function scrollToIndex(index: number): void {
    if (!host) return;
    const rect = layout.rects[index];
    if (!rect) return;
    const documentTop = host.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: documentTop + rect.y, behavior: "smooth" });
  }
</script>

<section
  bind:this={host}
  class="virtual-gallery"
  aria-label="Gallery"
  data-width={appearance.tileWidth}
  data-ratio={appearance.tileRatio}
  data-fit={appearance.tileFit}
  data-zoom={appearance.tileZoom}
  data-actions={appearance.tileActions}
  style={`height: ${layout.height}px;`}
>
  {#each visibleIndexes as imageIndex (images[imageIndex]!.path)}
    {@const image = images[imageIndex]!}
    <GalleryTile
      {image}
      rect={layout.rects[imageIndex]!}
      {appearance}
      {scheduler}
      favorite={favorites.has(image.path)}
      displayName={displayName(image)}
      showName={showNames}
      onopen={() => onopen(imageIndex)}
      onfavorite={() => onfavorite(image)}
      oncopyimage={() => oncopyimage(image)}
      oncopylink={() => oncopylink(image)}
      oninfo={() => oninfo(image)}
      onreport={onreport ? () => onreport(image) : undefined}
    />
  {/each}
</section>
