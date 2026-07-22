<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { GalleryImage } from "../../../shared/types";
  import type { MasonryRect } from "../layout/masonry-layout";
  import type { GalleryAppearancePreferencesV1 } from "../preferences";
  import { tileMediaUrl } from "../api/gallery-api";
  import type { MediaLoadScheduler } from "../services/media-loader";
  import Icon from "./Icon.svelte";

  interface Props {
    image: GalleryImage;
    rect: MasonryRect;
    appearance: GalleryAppearancePreferencesV1;
    scheduler: MediaLoadScheduler;
    favorite: boolean;
    displayName: string;
    showName: boolean;
    onopen: () => void;
    onfavorite: () => void;
    oncopyimage: () => void;
    oncopylink: () => void;
    oninfo: () => void;
    onreport?: () => void;
  }

  let { image, rect, appearance, scheduler, favorite, displayName, showName, onopen, onfavorite, oncopyimage, oncopylink, oninfo, onreport }: Props = $props();
  let src = $state<string>();
  let settle: ((completed: boolean) => void) | undefined;

  onMount(() => {
    if (scheduler.hasStarted(image.path)) {
      src = tileMediaUrl(image);
      return;
    }
    scheduler.enqueue(image.path, rect.y, () => new Promise<boolean>((resolve) => {
      settle = resolve;
      src = tileMediaUrl(image);
    }));
  });

  onDestroy(() => {
    scheduler.cancel(image.path);
    settle?.(false);
  });

  function loaded(completed = true): void {
    settle?.(completed);
    settle = undefined;
    if (!completed) src = undefined;
  }
</script>

<article
  class="gallery-item"
  data-ratio={appearance.tileRatio}
  data-fit={appearance.tileFit}
  data-zoom={appearance.tileZoom}
  data-actions={appearance.tileActions}
  style={`transform: translate3d(${rect.x}px, ${rect.y}px, 0); width: ${rect.width}px; height: ${rect.height}px;`}
>
  <button class="image-open" type="button" aria-label={`Open ${displayName}`} onclick={onopen}>
    {#if src}
      <img class="gallery-image" {src} alt={displayName} draggable="false" onload={() => loaded(true)} onerror={() => loaded(false)} />
    {:else}
      <span class="image-skeleton" aria-hidden="true"></span>
    {/if}
    {#if showName}<span class="tile-name">{displayName}</span>{/if}
  </button>
  {#if onreport}<button class="tile-report-button" type="button" aria-label="Report image" title="Report image" onclick={onreport}>!</button>{/if}
  <div class="tile-actions" aria-label={`Actions for ${displayName}`}>
    <button class:is-favorite={favorite} type="button" aria-pressed={favorite} aria-label={favorite ? "Remove favorite" : "Add favorite"} title={favorite ? "Remove favorite" : "Add favorite"} onclick={onfavorite}><Icon name="favorite" /></button>
    <button type="button" aria-label="Image information" title="Image information" onclick={oninfo}><Icon name="info" /></button>
    <button class="secondary-action" type="button" aria-label="Copy image" title="Copy image" onclick={oncopyimage}><Icon name="copy-image" /></button>
    <button class="secondary-action" type="button" aria-label="Copy link" title="Copy link" onclick={oncopylink}><Icon name="copy-link" /></button>
    <details class="tile-action-menu">
      <summary aria-label="More image actions" title="More image actions"><Icon name="menu" /></summary>
      <div>
        <button type="button" aria-label="Image information" onclick={() => { oninfo(); }}><Icon name="info" /></button>
        <button type="button" aria-label="Copy image" onclick={() => { oncopyimage(); }}><Icon name="copy-image" /></button>
        <button type="button" aria-label="Copy link" onclick={() => { oncopylink(); }}><Icon name="copy-link" /></button>
      </div>
    </details>
  </div>
</article>
