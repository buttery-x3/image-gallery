<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { GalleryImage, GalleryIndexItem, ImageDetailsResponse } from "../shared/types";
  import { absoluteMediaUrl, applicationUrl, configureApplicationBase, galleryPageUrlFor, loadGalleryIndex, loadImageDetails, loadImages } from "./app/api/gallery-api";
  import Icon from "./app/components/Icon.svelte";
  import Lightbox from "./app/components/Lightbox.svelte";
  import Slideshow from "./app/components/Slideshow.svelte";
  import VirtualGallery from "./app/components/VirtualGallery.svelte";
  import {
    defaultAppearancePreferences, tileActions, tileFits, tileRatios, tileWidths, tileZooms,
    type GalleryAppearancePreferencesV1,
  } from "./app/preferences";
  import { copyImage, copyText } from "./app/services/clipboard";
  import { appearanceStorageKey, loadAppearance, resetAppearance, saveAppearance } from "./app/storage";
  import { overlayColors, type OverlayColors } from "./app/overlay-colors";

  type Language = "en" | "ja";
  type Theme = "editorial" | "glass" | "studio" | "classic" | "daylight" | "neon" | "accessible";
  type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

  const root = document.documentElement;
  const siteName = document.title;
  const searchMetadata = root.dataset.gallerySearchMetadata === "true";
  const showTypeToggle = root.dataset.galleryTypeToggle === "true";
  const showLanguageToggle = root.dataset.galleryLanguageToggle === "true";
  const showNames = root.dataset.galleryShowNames === "true";
  const reportingEnabled = root.dataset.galleryEnableReporting === "true";
  const watermark = root.dataset.galleryShowWatermark === "true" ? root.dataset.galleryWatermarkText : undefined;
  const watermarkPosition = (root.dataset.galleryWatermarkPosition ?? "bottom-right") as Corner;
  const typeLabels = new Map<string, string>(Object.entries(JSON.parse(root.dataset.galleryTypeLabels ?? "{}") as Record<string, string>));
  configureApplicationBase([...typeLabels.values()].map((label) => label.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")));
  const favoritesKey = "image-gallery:favorites:v1";
  const reportedKey = "image-gallery:reported-images:v1";
  const languageKey = "image-gallery:name-language:v1";
  const themeKey = "image-gallery:theme:v1";
  const consentKey = "image-gallery:content-consent:v1";
  const overlayKey = "image-gallery:overlay-preferences:v1";
  const themes: Theme[] = ["editorial", "glass", "studio", "classic", "daylight", "neon", "accessible"];
  const themeLabels: Record<Theme, string> = { editorial: "Editorial", glass: "Glass", studio: "Studio", classic: "Classic", daylight: "Daylight", neon: "Neon Grid", accessible: "Accessible" };
  const corners: Corner[] = ["top-left", "bottom-left", "bottom-right", "top-right"];

  const copy = {
    en: { search: "Search images", favorites: "Only favorites", filters: "Advanced", shuffle: "Shuffle", slideshow: "Slideshow", appearance: "Appearance", loading: "Loading images…", empty: "No images match your search and filters.", information: "Image information" },
    ja: { search: "画像を検索", favorites: "お気に入りのみ", filters: "詳細設定", shuffle: "シャッフル", slideshow: "スライドショー", appearance: "表示設定", loading: "画像を読み込んでいます…", empty: "検索条件に一致する画像はありません。", information: "画像情報" },
  } as const;

  let images = $state<GalleryImage[]>([]);
  let indexByPath = $state(new Map<string, GalleryIndexItem>());
  let loading = $state(true);
  let error = $state("");
  let search = $state("");
  let favoritesOnly = $state(false);
  let favorites = $state(new Set<string>());
  let reported = $state(new Set<string>());
  let activeType = $state("all");
  let activeFilters = $state<Record<string, string>>({});
  let draftFilters = $state<Record<string, string>>({});
  let language = $state<Language>("en");
  let theme = $state<Theme>("editorial");
  let appearance = $state<GalleryAppearancePreferencesV1>({ ...defaultAppearancePreferences });
  let activePath = $state<string>();
  let slideshowImages = $state<GalleryImage[]>();
  let slideshowPushedRoute = false;
  let details = $state<ImageDetailsResponse>();
  let detailsImage = $state<GalleryImage>();
  let detailsLoading = $state(false);
  let nameVisible = $state(true);
  let namePosition = $state<Corner>("bottom-right");
  let toast = $state("");
  let toastTimer: number | undefined;
  let appearanceDialog = $state<HTMLDialogElement>();
  let filterDialog = $state<HTMLDialogElement>();
  let detailsDialog = $state<HTMLDialogElement>();
  let consentDialog = $state<HTMLDialogElement>();
  let galleryComponent = $state<VirtualGallery>();

  const presentTypes = $derived([...typeLabels].filter(([schema]) => images.some((image) => image.metadataSchema === schema)));
  const facets = $derived.by(() => {
    const result = new Map<string, Map<string, number>>();
    for (const image of images) {
      const values = indexByPath.get(image.path)?.tags ?? (image.batch ? { batch: image.batch } : {});
      for (const [key, value] of Object.entries(values)) {
        const counts = result.get(key) ?? new Map<string, number>();
        counts.set(value, (counts.get(value) ?? 0) + 1);
        result.set(key, counts);
      }
    }
    return [...result].map(([key, counts]) => ({ key, values: [...counts].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })) }));
  });
  const filteredImages = $derived.by(() => {
    const terms = search.normalize("NFKC").toLocaleLowerCase().split(/\s+/).filter(Boolean);
    return images.filter((image) => {
      if (reported.has(image.path)) return false;
      if (activeType !== "all" && image.metadataSchema !== activeType) return false;
      if (favoritesOnly && !favorites.has(image.path)) return false;
      const index = indexByPath.get(image.path);
      const searchable = index?.searchText ?? `${image.displayName}\n${image.name}\n${image.path}`.normalize("NFKC").toLocaleLowerCase();
      if (terms.some((term) => !searchable.includes(term))) return false;
      for (const [key, value] of Object.entries(activeFilters)) {
        if (value && index?.tags[key] !== value) return false;
      }
      return true;
    });
  });
  const activeIndex = $derived(activePath ? filteredImages.findIndex((image) => image.path === activePath) : -1);
  const activeImage = $derived(activeIndex >= 0 ? filteredImages[activeIndex] : undefined);
  const imageCountText = $derived(language === "ja"
    ? (filteredImages.length === images.length ? `${images.length}枚` : `${images.length}枚中${filteredImages.length}枚`)
    : (filteredImages.length === images.length
      ? (images.length === 1 ? "1 image" : `${images.length} images`)
      : `${filteredImages.length} of ${images.length} images`));

  function readStringSet(key: string): Set<string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
      return new Set(Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []);
    } catch { return new Set(); }
  }

  function shuffle<T>(values: readonly T[]): T[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target]!, result[index]!];
    }
    return result;
  }

  function typeSlug(label: string): string {
    return label.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function routeTail(): string | undefined {
    return window.location.pathname.split("/").filter(Boolean).at(-1)?.toLocaleLowerCase();
  }

  function selectInitialType(): void {
    const tail = routeTail();
    activeType = [...typeLabels].find(([, label]) => typeSlug(label) === tail)?.[0] ?? "all";
  }

  function syncTypeRoute(): void {
    const url = new URL(window.location.href);
    const known = new Set([...typeLabels.values()].map(typeSlug));
    const segments = url.pathname.split("/").filter(Boolean);
    if (known.has(segments.at(-1) ?? "") || segments.at(-1) === "slideshow") segments.pop();
    if (activeType !== "all") segments.push(typeSlug(typeLabels.get(activeType) ?? activeType));
    url.pathname = `/${segments.join("/")}${segments.length ? "/" : ""}`;
    history.replaceState(null, "", url);
  }

  function displayName(image: GalleryImage): string {
    if (!showNames) return image.displayName;
    const shortName = image.shortName ?? indexByPath.get(image.path)?.shortName;
    return (language === "ja" ? shortName?.ja ?? shortName?.en : shortName?.en ?? shortName?.ja) ?? image.displayName;
  }

  function colorsFor(image: GalleryImage): OverlayColors {
    return overlayColors(image, indexByPath.get(image.path)?.tags);
  }

  function galleryPageHref(): string {
    return galleryPageUrlFor(window.location.href).href;
  }

  function notify(message: string): void {
    window.clearTimeout(toastTimer);
    toast = message;
    toastTimer = window.setTimeout(() => { toast = ""; }, 1_800);
  }

  function toggleFavorite(image: GalleryImage): void {
    const next = new Set(favorites);
    next.has(image.path) ? next.delete(image.path) : next.add(image.path);
    favorites = next;
    localStorage.setItem(favoritesKey, JSON.stringify([...favorites]));
    notify(next.has(image.path) ? "Added to favorites" : "Removed from favorites");
    if (favoritesOnly && !next.has(image.path) && activePath === image.path) activePath = undefined;
  }

  function updateAppearance<K extends keyof GalleryAppearancePreferencesV1>(key: K, value: GalleryAppearancePreferencesV1[K]): void {
    appearance = { ...appearance, [key]: value };
    saveAppearance(appearance);
  }

  function setTheme(value: Theme): void {
    theme = value;
    root.dataset.theme = value;
    localStorage.setItem(themeKey, value);
  }

  function setLanguage(value: Language): void {
    language = value;
    root.lang = value;
    localStorage.setItem(languageKey, value);
  }

  async function performCopyLink(image: GalleryImage): Promise<void> {
    try { await copyText(absoluteMediaUrl(image)); notify("Link copied"); }
    catch { notify("Could not copy link"); }
  }

  async function performCopyImage(image: GalleryImage): Promise<void> {
    const url = absoluteMediaUrl(image);
    try { await copyImage(image, url); notify("Image copied"); }
    catch {
      try { await copyText(url); notify("Image unavailable; link copied instead"); }
      catch { notify("Could not copy image"); }
    }
  }

  async function showDetails(image: GalleryImage): Promise<void> {
    detailsImage = image;
    details = undefined;
    detailsLoading = true;
    await tick();
    detailsDialog?.showModal();
    try { details = await loadImageDetails(image.path); }
    catch (reason) { details = { metadataInvalid: true }; console.warn(reason); }
    finally { detailsLoading = false; }
  }

  async function reportImage(image: GalleryImage): Promise<void> {
    if (!confirm(`Report ${displayName(image)} as explicit content?`)) return;
    try {
      const response = await fetch(applicationUrl("api/reports"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imagePath: image.path }),
      });
      if (!response.ok) throw new Error(`Report failed (${response.status})`);
      reported = new Set([...reported, image.path]);
      localStorage.setItem(reportedKey, JSON.stringify([...reported]));
      if (activePath === image.path) activePath = undefined;
      notify("Report recorded");
    } catch { notify("The report could not be recorded"); }
  }

  function openLightbox(index: number): void { activePath = filteredImages[index]?.path; }
  function navigateLightbox(offset: -1 | 1): void {
    if (activeIndex < 0) return;
    const next = activeIndex + offset;
    if (next >= 0 && next < filteredImages.length) activePath = filteredImages[next]!.path;
  }
  async function returnToTile(): Promise<void> {
    const path = activePath;
    activePath = undefined;
    await tick();
    const index = filteredImages.findIndex((image) => image.path === path);
    if (index >= 0) galleryComponent?.scrollToIndex(index);
  }

  function openSlideshow(): void {
    if (filteredImages.length < 2) return;
    slideshowImages = shuffle(filteredImages);
    const url = new URL(window.location.href);
    if (routeTail() !== "slideshow") url.pathname = `${url.pathname.replace(/\/?$/, "/")}slideshow/`;
    history.pushState(null, "", url);
    slideshowPushedRoute = true;
  }
  function replaceSlideshowRoute(): void {
    const url = new URL(window.location.href);
    const segments = url.pathname.split("/").filter(Boolean);
    if (segments.at(-1)?.toLocaleLowerCase() === "slideshow") segments.pop();
    url.pathname = `/${segments.join("/")}${segments.length ? "/" : ""}`;
    history.replaceState(null, "", url);
  }
  function closeSlideshow(): void {
    slideshowImages = undefined;
    if (routeTail() !== "slideshow") return;
    if (slideshowPushedRoute) {
      slideshowPushedRoute = false;
      history.back();
    } else replaceSlideshowRoute();
  }
  async function returnFromSlideshow(image: GalleryImage): Promise<void> {
    slideshowImages = undefined;
    if (routeTail() === "slideshow") {
      if (slideshowPushedRoute) {
        slideshowPushedRoute = false;
        await new Promise<void>((resolve) => {
          window.addEventListener("popstate", () => resolve(), { once: true });
          history.back();
        });
      } else replaceSlideshowRoute();
    }
    await tick();
    const index = filteredImages.findIndex((candidate) => candidate.path === image.path);
    if (index >= 0) galleryComponent?.scrollToIndex(index);
  }

  function applyFilters(): void {
    activeFilters = Object.fromEntries(Object.entries(draftFilters).filter(([, value]) => value));
    filterDialog?.close();
  }

  onMount(() => {
    appearance = loadAppearance();
    favorites = readStringSet(favoritesKey);
    reported = readStringSet(reportedKey);
    language = localStorage.getItem(languageKey) === "ja" ? "ja" : "en";
    const storedTheme = localStorage.getItem(themeKey) as Theme | null;
    theme = storedTheme && themes.includes(storedTheme) ? storedTheme : "editorial";
    root.dataset.theme = theme;
    root.lang = language;
    try {
      const overlay = JSON.parse(localStorage.getItem(overlayKey) ?? "{}") as { nameVisible?: unknown; namePosition?: unknown };
      nameVisible = overlay.nameVisible !== false;
      if (corners.includes(overlay.namePosition as Corner)) namePosition = overlay.namePosition as Corner;
    } catch { /* Defaults remain active. */ }
    if (localStorage.getItem(consentKey) !== "agreed") consentDialog?.showModal();
    else document.body.classList.remove("consent-pending");
    const handleStorage = (event: StorageEvent): void => {
      if (event.key === appearanceStorageKey) appearance = loadAppearance();
      if (event.key === favoritesKey) favorites = readStringSet(favoritesKey);
    };
    window.addEventListener("storage", handleStorage);
    const supportButton = document.querySelector<HTMLElement>("#support-button");
    const supportCard = document.querySelector<HTMLElement>("#support-card");
    const headerMeta = document.querySelector<HTMLElement>(".header-meta");
    const compactHeader = window.matchMedia("(max-width: 620px)");
    const placeSupportButton = (): void => {
      if (!supportButton || !headerMeta) return;
      if (compactHeader.matches && supportCard) supportCard.append(supportButton);
      else headerMeta.append(supportButton);
    };
    placeSupportButton();
    compactHeader.addEventListener("change", placeSupportButton);
    if (supportCard) supportCard.hidden = false;
    const handlePopState = (): void => {
      if (routeTail() !== "slideshow") {
        slideshowPushedRoute = false;
        slideshowImages = undefined;
      }
      else if (!slideshowImages && filteredImages.length >= 2) slideshowImages = shuffle(filteredImages);
    };
    window.addEventListener("popstate", handlePopState);
    void loadImages().then((loaded) => {
      images = shuffle(loaded);
      selectInitialType();
      loading = false;
      return searchMetadata || showNames ? loadGalleryIndex() : new Map<string, GalleryIndexItem>();
    }).then((loadedIndex) => {
      indexByPath = loadedIndex;
      for (const image of images) {
        const indexed = loadedIndex.get(image.path);
        if (indexed?.shortName) image.shortName = indexed.shortName;
      }
      if (routeTail() === "slideshow" && filteredImages.length >= 2) slideshowImages = shuffle(filteredImages);
    }).catch((reason) => {
      error = reason instanceof Error ? reason.message : "The gallery could not be loaded.";
      loading = false;
    });
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("popstate", handlePopState);
      compactHeader.removeEventListener("change", placeSupportButton);
    };
  });

  $effect(() => {
    localStorage.setItem(overlayKey, JSON.stringify({ nameVisible, namePosition }));
  });
</script>

<svelte:head><title>{siteName}</title></svelte:head>

<header class="site-header" class:header-sticky={appearance.stickyHeader}>
  <div class="header-title">
    <h1>{siteName}</h1>
    <button class="shuffle-button" type="button" disabled={images.length < 2} onclick={() => { images = shuffle(images); }}><Icon name="shuffle" /><span>{copy[language].shuffle}</span></button>
    <button class="shuffle-button" type="button" disabled={filteredImages.length < 2} onclick={openSlideshow}><Icon name="slideshow" /><span>{copy[language].slideshow}</span></button>
    {#if showTypeToggle && presentTypes.length >= 2}
      <fieldset class="type-filter" aria-label="Gallery type">
        <label><input type="radio" name="type" value="all" bind:group={activeType} onchange={syncTypeRoute} /><span>All <small>{images.length}</small></span></label>
        {#each presentTypes as [schema, label]}
          <label><input type="radio" name="type" value={schema} bind:group={activeType} onchange={syncTypeRoute} /><span>{label} <small>{images.filter((image) => image.metadataSchema === schema).length}</small></span></label>
        {/each}
      </fieldset>
    {/if}
  </div>
  <div class="header-controls">
    <label class="search-field"><span class="visually-hidden">{copy[language].search}</span><input type="search" bind:value={search} placeholder={copy[language].search} autocomplete="off" /></label>
    <button class="header-icon-button favorites-button" class:is-active={favoritesOnly} type="button" aria-label={copy[language].favorites} title={copy[language].favorites} aria-pressed={favoritesOnly} onclick={() => { favoritesOnly = !favoritesOnly; }}><Icon name="favorite" /></button>
    {#if showLanguageToggle}
      <fieldset class="name-language" aria-label="Display name language">
        <label><input type="radio" name="name-language" value="en" bind:group={language} onchange={() => setLanguage("en")} /><span>EN</span></label>
        <label><input type="radio" name="name-language" value="ja" bind:group={language} onchange={() => setLanguage("ja")} /><span>JP</span></label>
      </fieldset>
    {/if}
    {#if searchMetadata}<button class="header-icon-button advanced-button" class:is-active={Object.keys(activeFilters).length > 0} type="button" aria-label={copy[language].filters} title={copy[language].filters} onclick={() => { draftFilters = { ...activeFilters }; filterDialog?.showModal(); }}><Icon name="filter-list" />{#if Object.keys(activeFilters).length}<span class="control-badge">{Object.keys(activeFilters).length}</span>{/if}</button>{/if}
  </div>
  <div class="header-meta">
    <p class="image-count" aria-live="polite">{loading ? copy[language].loading : imageCountText}</p>
    <button class="header-icon-button" type="button" aria-label={copy[language].appearance} title={copy[language].appearance} onclick={() => appearanceDialog?.showModal()}><Icon name="palette" /></button>
  </div>
</header>

<main>
  {#if error}<section class="empty-state" role="alert"><h2>Could not load gallery</h2><p>{error}</p></section>
  {:else if loading}<section class="empty-state"><div class="spinner"></div><p>{copy[language].loading}</p></section>
  {:else if filteredImages.length === 0}<section class="empty-state"><p>{copy[language].empty}</p></section>
  {:else}
    <VirtualGallery bind:this={galleryComponent} images={filteredImages} backgroundImages={images} {appearance} {favorites} {displayName} {showNames} onopen={openLightbox} onfavorite={toggleFavorite} oncopyimage={(image) => void performCopyImage(image)} oncopylink={(image) => void performCopyLink(image)} oninfo={(image) => void showDetails(image)} onreport={reportingEnabled ? (image) => void reportImage(image) : undefined} />
  {/if}
</main>

{#if activeImage}
  <Lightbox image={activeImage} displayName={displayName(activeImage)} favorite={favorites.has(activeImage.path)} {showNames} {namePosition} {nameVisible} {watermark} watermarkHref={galleryPageHref()} {watermarkPosition} colors={colorsFor(activeImage)} hasPrevious={activeIndex > 0} hasNext={activeIndex < filteredImages.length - 1} onclose={() => { activePath = undefined; }} onnavigate={navigateLightbox} onfavorite={() => toggleFavorite(activeImage)} oninfo={() => void showDetails(activeImage)} onreport={reportingEnabled ? () => void reportImage(activeImage) : undefined} ontogglename={() => { nameVisible = !nameVisible; }} onposition={() => { namePosition = corners[(corners.indexOf(namePosition) + 1) % corners.length]!; }} onreturn={() => void returnToTile()} />
{/if}

{#if slideshowImages}<Slideshow images={slideshowImages} {displayName} {showNames} {watermark} watermarkHref={galleryPageHref()} {watermarkPosition} {colorsFor} onclose={closeSlideshow} onreturn={(image) => void returnFromSlideshow(image)} />{/if}

<dialog bind:this={appearanceDialog} class="settings-dialog" aria-labelledby="appearance-title">
  <form method="dialog"><header><h2 id="appearance-title">Gallery appearance</h2><button value="close" aria-label="Close">×</button></header>
    <div class="settings-grid">
      <label>Tile width<select value={appearance.tileWidth} onchange={(e) => updateAppearance("tileWidth", e.currentTarget.value as GalleryAppearancePreferencesV1["tileWidth"])}>{#each tileWidths as value}<option {value}>{value}</option>{/each}</select></label>
      <label>Image ratio<select value={appearance.tileRatio} onchange={(e) => updateAppearance("tileRatio", e.currentTarget.value as GalleryAppearancePreferencesV1["tileRatio"])}>{#each tileRatios as value}<option {value}>{value}</option>{/each}</select></label>
      <label>Fixed-ratio fit<select value={appearance.tileFit} disabled={appearance.tileRatio === "natural"} onchange={(e) => updateAppearance("tileFit", e.currentTarget.value as GalleryAppearancePreferencesV1["tileFit"])}>{#each tileFits as value}<option {value}>{value}</option>{/each}</select></label>
      <label>Hover zoom<select value={appearance.tileZoom} onchange={(e) => updateAppearance("tileZoom", e.currentTarget.value as GalleryAppearancePreferencesV1["tileZoom"])}>{#each tileZooms as value}<option {value}>{value}</option>{/each}</select></label>
      <label>Tile actions<select value={appearance.tileActions} onchange={(e) => updateAppearance("tileActions", e.currentTarget.value as GalleryAppearancePreferencesV1["tileActions"])}>{#each tileActions as value}<option {value}>{value}</option>{/each}</select></label>
      <label>Visual style<select aria-label="Visual style" value={theme} onchange={(event) => setTheme(event.currentTarget.value as Theme)}>{#each themes as value}<option {value}>{themeLabels[value]}</option>{/each}</select></label>
      <label class="settings-toggle"><input type="checkbox" checked={appearance.stickyHeader} onchange={(event) => updateAppearance("stickyHeader", event.currentTarget.checked)} /> Keep header visible while scrolling</label>
    </div>
    <footer><button type="button" onclick={() => { appearance = resetAppearance(); setTheme("editorial"); }}>Reset appearance</button><button value="close">Done</button></footer>
  </form>
</dialog>

<dialog bind:this={filterDialog} class="settings-dialog" aria-labelledby="filters-title">
  <form onsubmit={(event) => { event.preventDefault(); applyFilters(); }}><header><h2 id="filters-title">Advanced filters</h2><button type="button" aria-label="Close" onclick={() => filterDialog?.close()}>×</button></header>
    <div class="settings-grid filter-grid">{#each facets as facet}<label>{facet.key.replaceAll("_", " ")}<select value={draftFilters[facet.key] ?? ""} onchange={(event) => { draftFilters = { ...draftFilters, [facet.key]: event.currentTarget.value }; }}><option value="">Any</option>{#each facet.values as [value, count]}<option {value}>{value} ({count})</option>{/each}</select></label>{/each}</div>
    <footer><button type="button" onclick={() => { draftFilters = {}; }}>Reset</button><button type="submit">Apply filters</button></footer>
  </form>
</dialog>

<dialog bind:this={detailsDialog} class="settings-dialog metadata-dialog" aria-labelledby="details-title" onclick={(event) => { if (event.target === detailsDialog) detailsDialog?.close(); }}>
  <form method="dialog"><header><h2 id="details-title">{copy[language].information}</h2><button value="close" aria-label="Close">×</button></header>
    <div class="metadata-content">{#if detailsLoading}<p>Loading…</p>{:else if detailsImage && details}<dl><dt>File</dt><dd>{detailsImage.name}</dd><dt>Path</dt><dd>{detailsImage.path}</dd><dt>Type</dt><dd>{detailsImage.type}</dd>{#if detailsImage.width && detailsImage.height}<dt>Dimensions</dt><dd>{detailsImage.width} × {detailsImage.height}</dd>{/if}{#if details.metadata?.schema}<dt>Schema</dt><dd>{details.metadata.schema}</dd>{/if}{#each Object.entries(details.metadata?.tags ?? {}) as [key, value]}<dt>{key.replaceAll("_", " ")}</dt><dd>{value}</dd>{/each}{#if details.metadata?.resolvedPrompt}<dt>Resolved prompt</dt><dd>{details.metadata.resolvedPrompt}</dd>{/if}</dl>{:else}<p>No metadata is available.</p>{/if}</div>
    <footer><button value="close">Close</button></footer>
  </form>
</dialog>

<dialog bind:this={consentDialog} class="consent-dialog" aria-labelledby="consent-title" aria-describedby="consent-message" oncancel={(event) => event.preventDefault()}>
  <div class="consent-card">
    <h2 id="consent-title">Content notice</h2>
    <div id="consent-message" class="consent-message">
      <p>This website is intended not to show any sexually explicit content such as nudity.</p>
      <p>Due to the AI generated content some images may bypass initial review.</p>
      <p>This site is considered not safe for work despite not being explicit.</p>
      <p>Ecchi is considered okay -- Porn is not intended.</p>
      <p>Do you agree you will report any images using the red button which you find sexually explicit?</p>
    </div>
    <button class="consent-agree" type="button" onclick={() => { localStorage.setItem(consentKey, "agreed"); consentDialog?.close(); document.body.classList.remove("consent-pending"); }}>I agree</button>
    <details class="consent-more">
      <summary>more information (disclaimer)</summary>
      <div class="consent-more-content">
        <p>The reason for this is to gain clearer understanding.</p>
        <p>Sheared clothing exposing breasts is common in fashion shows for example as fully unrestricted and viewable by all ages.</p>
        <p>The content on this site is similarly tasteful and artistic despite being AI generated as an artistic tool use.</p>
        <p>Complaints and questions are welcomed via e-mail at <a href="mailto:admin@flamehorn.com">admin@flamehorn.com</a>.</p>
        <p>This site is produced under good faith as an artistic/personal endeavor.</p>
        <p>I would also like to take this opportunity to pay my respects to the elders and traditional land owners of the Bunurong people on who's land this was thankfully developed.</p>
      </div>
    </details>
  </div>
</dialog>

{#if toast}<div class="toast" role="status">{toast}</div>{/if}
