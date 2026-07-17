import "./styles.css";
import type { ErrorResponse, GalleryImage, GalleryResponse } from "../shared/types.js";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const gallery = requiredElement<HTMLElement>("#gallery");
const status = requiredElement<HTMLElement>("#status");
const imageCount = requiredElement<HTMLElement>("#image-count");
const shuffleButton = requiredElement<HTMLButtonElement>("#shuffle");
const searchInput = requiredElement<HTMLInputElement>("#search");
const searchableOnly = requiredElement<HTMLInputElement>("#searchable-only");
const advancedButton = requiredElement<HTMLButtonElement>("#advanced-filters");
const advancedFilterCount = requiredElement<HTMLElement>("#advanced-filter-count");
const filterDialog = requiredElement<HTMLDialogElement>("#filter-dialog");
const filterForm = requiredElement<HTMLFormElement>("#filter-form");
const filterGrid = requiredElement<HTMLElement>("#filter-grid");
const filterClose = requiredElement<HTMLButtonElement>("#filter-close");
const filterReset = requiredElement<HTMLButtonElement>("#filter-reset");
const lightbox = requiredElement<HTMLDialogElement>("#lightbox");
const lightboxStage = requiredElement<HTMLElement>(".lightbox-stage");
const lightboxImage = requiredElement<HTMLImageElement>("#lightbox-image");
const lightboxClose = requiredElement<HTMLButtonElement>("#lightbox-close");
const lightboxPrevious = requiredElement<HTMLButtonElement>("#lightbox-previous");
const lightboxNext = requiredElement<HTMLButtonElement>("#lightbox-next");
const toast = requiredElement<HTMLElement>("#toast");

let toastTimer: number | undefined;
let activeOpener: HTMLButtonElement | undefined;
let activeImageIndex = -1;
let activeImageLoads = 0;
let allImages: GalleryImage[] = [];
let galleryImages: GalleryImage[] = [];
let searchTimer: number | undefined;
let shufflePending = false;
const activeFilters = new Map<string, string>();
const imageSearchIndexes = new WeakMap<GalleryImage, string>();
const tilesByImage = new Map<GalleryImage, HTMLElement>();

const maximumConcurrentImageLoads = 4;
const lazyLoadMargin = 150;
const pendingTiles: HTMLElement[] = [];
let queueRefreshFrame: number | undefined;

function cancelQueueRefresh(): void {
  if (queueRefreshFrame === undefined) return;
  window.cancelAnimationFrame(queueRefreshFrame);
  queueRefreshFrame = undefined;
}

function scheduleQueueRefresh(): void {
  if (queueRefreshFrame !== undefined) return;
  queueRefreshFrame = window.requestAnimationFrame(refreshImageQueue);
}

function shuffledImages(images: readonly GalleryImage[]): GalleryImage[] {
  const shuffled = [...images];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    const currentImage = shuffled[index]!;
    shuffled[index] = shuffled[randomIndex]!;
    shuffled[randomIndex] = currentImage;
  }

  if (shuffled.length > 1 && shuffled.every((image, index) => image === images[index])) {
    shuffled.push(shuffled.shift()!);
  }
  return shuffled;
}

function shuffleGallery(): void {
  if (shufflePending || allImages.length < 2) return;
  shufflePending = true;
  shuffleButton.disabled = true;
  shuffleButton.setAttribute("aria-busy", "true");

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      allImages = shuffledImages(allImages);
      reorderTiles();
      applyFilters();
      window.requestAnimationFrame(() => {
        shufflePending = false;
        shuffleButton.removeAttribute("aria-busy");
        updateShuffleButtonState();
      });
    });
  });
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 1_800);
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

const filterCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function normalized(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase();
}

function tagValue(image: GalleryImage, key: string): string | undefined {
  return key === "batch" ? image.batch : image.metadata?.tags[key];
}

function searchIndex(image: GalleryImage): string {
  const existing = imageSearchIndexes.get(image);
  if (existing) return existing;

  const metadata = image.metadata;
  const values = [
    image.name,
    image.path,
    image.batch ?? "",
    metadata?.schema ?? "",
    metadata?.resolvedPrompt ?? "",
    ...Object.values(metadata?.tags ?? {}),
    ...Object.values(metadata?.searchTokens ?? {}).flat(),
  ];
  const index = normalized(values.join("\n"));
  imageSearchIndexes.set(image, index);
  return index;
}

function fieldLabel(key: string): string {
  return key
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function renderFilterControls(): void {
  const facets = new Map<string, Map<string, number>>();
  for (const image of allImages) {
    const values = new Map<string, string>(Object.entries(image.metadata?.tags ?? {}));
    if (image.batch) values.set("batch", image.batch);
    for (const [key, value] of values) {
      let counts = facets.get(key);
      if (!counts) {
        counts = new Map();
        facets.set(key, counts);
      }
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }

  const keys = [...facets.keys()].sort((left, right) => {
    if (left === "batch") return -1;
    if (right === "batch") return 1;
    return filterCollator.compare(fieldLabel(left), fieldLabel(right));
  });

  const fragment = document.createDocumentFragment();
  for (const key of keys) {
    const label = document.createElement("label");
    label.className = "filter-field";

    const caption = document.createElement("span");
    caption.textContent = fieldLabel(key);

    const select = document.createElement("select");
    select.dataset.filterKey = key;
    select.setAttribute("aria-label", fieldLabel(key));

    const anyOption = document.createElement("option");
    anyOption.value = "";
    anyOption.textContent = "Any";
    select.append(anyOption);

    const counts = facets.get(key)!;
    const values = [...counts.keys()].sort(filterCollator.compare);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${value} (${counts.get(value)})`;
      select.append(option);
    }

    label.append(caption, select);
    fragment.append(label);
  }

  filterGrid.replaceChildren(fragment);
  advancedButton.disabled = keys.length === 0;
}

function syncFilterControls(): void {
  for (const select of filterGrid.querySelectorAll<HTMLSelectElement>("select[data-filter-key]")) {
    select.value = activeFilters.get(select.dataset.filterKey ?? "") ?? "";
  }
}

function updateFilterCount(): void {
  const count = activeFilters.size;
  advancedFilterCount.hidden = count === 0;
  advancedFilterCount.textContent = String(count);
  advancedButton.setAttribute("aria-label", count === 0 ? "Advanced filters" : `Advanced filters, ${count} active`);
}

function applyFilters(): void {
  const terms = normalized(searchInput.value).split(/\s+/).filter(Boolean);
  const images = allImages.filter((image) => {
    if (searchableOnly.checked && !image.metadata) return false;
    if (terms.some((term) => !searchIndex(image).includes(term))) return false;
    for (const [key, value] of activeFilters) {
      if (tagValue(image, key) !== value) return false;
    }
    return true;
  });
  updateVisibleImages(images);
  updateFilterCount();
}

advancedButton.addEventListener("click", () => {
  syncFilterControls();
  filterDialog.showModal();
});
filterClose.addEventListener("click", () => filterDialog.close());
filterReset.addEventListener("click", () => {
  for (const select of filterGrid.querySelectorAll<HTMLSelectElement>("select[data-filter-key]")) {
    select.value = "";
  }
});
filterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  activeFilters.clear();
  for (const select of filterGrid.querySelectorAll<HTMLSelectElement>("select[data-filter-key]")) {
    const key = select.dataset.filterKey;
    if (key && select.value) activeFilters.set(key, select.value);
  }
  filterDialog.close();
  applyFilters();
});
filterDialog.addEventListener("click", (event) => {
  if (event.target === filterDialog) filterDialog.close();
});
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(applyFilters, 120);
});
searchableOnly.addEventListener("change", applyFilters);

function resizeTile(tile: HTMLElement): void {
  const styles = window.getComputedStyle(gallery);
  const rowHeight = Number.parseFloat(styles.gridAutoRows);
  const rowGap = Number.parseFloat(styles.rowGap);
  const content = tile.querySelector<HTMLElement>(".image-open");
  const height = content?.getBoundingClientRect().height ?? 0;
  if (height > 0 && rowHeight > 0) {
    tile.style.gridRowEnd = `span ${Math.ceil((height + rowGap) / (rowHeight + rowGap))}`;
  }
}

const tileObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const tile = entry.target.closest<HTMLElement>(".gallery-item");
    if (tile) resizeTile(tile);
  }
});

function drainImageQueue(): void {
  while (activeImageLoads < maximumConcurrentImageLoads && pendingTiles.length > 0) {
    const tile = pendingTiles.shift();
    if (!tile?.isConnected || tile.dataset.loadState !== "queued") continue;

    const image = tile.querySelector<HTMLImageElement>(".gallery-image");
    const source = image?.dataset.src;
    if (!image || !source) continue;

    tile.dataset.loadState = "loading";
    activeImageLoads += 1;
    delete image.dataset.src;
    image.loading = "eager";
    image.src = source;
  }
}

function queueImage(tile: HTMLElement): boolean {
  if (tile.dataset.loadState) return false;
  tile.dataset.loadState = "queued";
  pendingTiles.push(tile);
  return true;
}

function prioritizeImage(tile: HTMLElement): void {
  if (!queueImage(tile) && tile.dataset.loadState !== "queued") return;
  const pendingIndex = pendingTiles.indexOf(tile);
  if (pendingIndex > 0) {
    pendingTiles.splice(pendingIndex, 1);
    pendingTiles.unshift(tile);
  }
  drainImageQueue();
}

function loadPriority(tile: HTMLElement): number {
  if (tile.hidden) return Number.MAX_SAFE_INTEGER;
  const bounds = tile.getBoundingClientRect();
  const upperBoundary = -lazyLoadMargin;
  const lowerBoundary = window.innerHeight + lazyLoadMargin;

  if (bounds.bottom < upperBoundary) return upperBoundary - bounds.bottom;
  if (bounds.top > lowerBoundary) return bounds.top - lowerBoundary;
  return 0;
}

function refreshImageQueue(): void {
  queueRefreshFrame = undefined;
  for (let index = pendingTiles.length - 1; index >= 0; index -= 1) {
    const tile = pendingTiles[index]!;
    if (!tile.isConnected || tile.dataset.loadState !== "queued") {
      pendingTiles.splice(index, 1);
    }
  }

  for (const image of allImages) {
    const tile = tilesByImage.get(image);
    if (tile) queueImage(tile);
  }

  pendingTiles.sort((left, right) => {
    const priorityDifference = loadPriority(left) - loadPriority(right);
    if (priorityDifference !== 0) return priorityDifference;
    const leftBounds = left.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    return leftBounds.top - rightBounds.top || leftBounds.left - rightBounds.left ||
      Number(left.dataset.galleryOrder) - Number(right.dataset.galleryOrder);
  });
  drainImageQueue();
}

function finishImageLoad(tile: HTMLElement): void {
  if (tile.dataset.loadState === "loading") {
    activeImageLoads = Math.max(0, activeImageLoads - 1);
  }
  tile.dataset.loadState = "complete";
  drainImageQueue();
}

const lazyImageObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const tile = entry.target as HTMLElement;
    prioritizeImage(tile);
  }
}, { rootMargin: `${lazyLoadMargin}px 0px` });

window.addEventListener("scroll", scheduleQueueRefresh, { passive: true });
window.addEventListener("resize", scheduleQueueRefresh);

function showLightboxImage(index: number): void {
  const image = galleryImages[index];
  if (!image) return;

  activeImageIndex = index;
  lightboxImage.src = new URL(image.url, document.baseURI).href;
  lightboxImage.alt = image.name;
  lightboxPrevious.disabled = index === 0;
  lightboxNext.disabled = index === galleryImages.length - 1;
}

function openLightbox(index: number, opener: HTMLButtonElement): void {
  activeOpener = opener;
  const hasMultipleImages = galleryImages.length > 1;
  lightboxPrevious.hidden = !hasMultipleImages;
  lightboxNext.hidden = !hasMultipleImages;
  showLightboxImage(index);
  lightbox.showModal();
  document.body.classList.add("lightbox-open");
}

function navigateLightbox(offset: -1 | 1): void {
  const nextIndex = activeImageIndex + offset;
  if (nextIndex < 0 || nextIndex >= galleryImages.length) return;
  showLightboxImage(nextIndex);
}

function closeLightbox(): void {
  if (lightbox.open) lightbox.close();
}

lightboxClose.addEventListener("click", closeLightbox);
lightboxPrevious.addEventListener("click", () => navigateLightbox(-1));
lightboxNext.addEventListener("click", () => navigateLightbox(1));
lightbox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    navigateLightbox(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    navigateLightbox(1);
  }
});
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
});
lightbox.addEventListener("close", () => {
  document.body.classList.remove("lightbox-open");
  lightboxImage.removeAttribute("src");
  activeImageIndex = -1;
  activeOpener?.focus({ preventScroll: true });
  activeOpener = undefined;
});

function createTile(image: GalleryImage): HTMLElement {
  const tile = document.createElement("article");
  tile.className = "gallery-item is-loading";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "image-open";
  openButton.setAttribute("aria-label", `Open ${image.name}`);
  openButton.setAttribute("aria-busy", "true");

  const element = document.createElement("img");
  element.className = "gallery-image";
  element.dataset.src = new URL(image.previewUrl ?? image.url, document.baseURI).href;
  element.alt = "";
  element.loading = "lazy";
  element.decoding = "async";
  element.fetchPriority = "low";

  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.className = "copy-button";
  copyButton.textContent = "Copy";
  copyButton.setAttribute("aria-label", `Copy direct link to ${image.name}`);

  openButton.append(element);
  tile.append(openButton, copyButton);
  openButton.addEventListener("click", () => openLightbox(galleryImages.indexOf(image), openButton));
  copyButton.addEventListener("click", async () => {
    try {
      await copyText(new URL(image.url, document.baseURI).href);
      showToast("Link copied");
    } catch {
      showToast("Could not copy link");
    }
  });

  const markReady = (): void => {
    tile.classList.remove("is-loading");
    openButton.setAttribute("aria-busy", "false");
    lazyImageObserver.unobserve(tile);
    finishImageLoad(tile);
    window.requestAnimationFrame(() => resizeTile(tile));
  };

  element.addEventListener("load", markReady, { once: true });
  element.addEventListener("error", () => {
    finishImageLoad(tile);
    tile.remove();
    tilesByImage.delete(image);
    tileObserver.unobserve(openButton);
    lazyImageObserver.unobserve(tile);
  }, { once: true });

  tileObserver.observe(openButton);
  lazyImageObserver.observe(tile);
  return tile;
}

function updateShuffleButtonState(): void {
  shuffleButton.disabled = shufflePending || allImages.length < 2;
}

function reorderTiles(): void {
  const fragment = document.createDocumentFragment();
  for (const [index, image] of allImages.entries()) {
    const tile = tilesByImage.get(image);
    if (!tile) continue;
    tile.dataset.galleryOrder = String(index);
    fragment.append(tile);
  }
  gallery.replaceChildren(fragment);
  scheduleQueueRefresh();
}

function initializeTiles(): void {
  cancelQueueRefresh();
  tilesByImage.clear();
  tileObserver.disconnect();
  lazyImageObserver.disconnect();
  pendingTiles.length = 0;
  activeImageLoads = 0;
  for (const image of allImages) {
    const tile = createTile(image);
    tilesByImage.set(image, tile);
  }
  reorderTiles();
}

function updateVisibleImages(images: GalleryImage[]): void {
  galleryImages = images;
  const visibleImages = new Set(images);
  for (const image of allImages) {
    const tile = tilesByImage.get(image);
    if (tile) tile.hidden = !visibleImages.has(image);
  }

  if (images.length === allImages.length) {
    imageCount.textContent = images.length === 1 ? "1 image" : `${images.length} images`;
  } else {
    imageCount.textContent = `${images.length} of ${allImages.length} images`;
  }
  updateShuffleButtonState();
  status.hidden = images.length > 0;
  status.textContent = images.length === 0
    ? (allImages.length === 0 ? "No images yet. Add some files and refresh." : "No images match your search and filters.")
    : "";
  scheduleQueueRefresh();
}

async function loadGallery(): Promise<void> {
  status.hidden = false;
  status.textContent = "Loading gallery\u2026";
  try {
    const response = await fetch(new URL("api/images", document.baseURI), { cache: "no-store" });
    const payload = (await response.json()) as GalleryResponse | ErrorResponse;
    if (!response.ok || !("images" in payload)) {
      throw new Error("error" in payload ? payload.error : "The gallery could not be loaded.");
    }
    allImages = shuffledImages(payload.images);
    activeFilters.clear();
    renderFilterControls();
    initializeTiles();
    applyFilters();
  } catch (error) {
    allImages = [];
    gallery.replaceChildren();
    shuffleButton.disabled = true;
    advancedButton.disabled = true;
    imageCount.textContent = "";
    status.hidden = false;
    status.textContent = error instanceof Error ? error.message : "The gallery could not be loaded.";
  }
}

shuffleButton.addEventListener("click", shuffleGallery);

void loadGallery();
