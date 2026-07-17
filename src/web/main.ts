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

function imageMimeType(image: GalleryImage): string {
  return image.type === "jpeg" ? "image/jpeg" : `image/${image.type}`;
}

function clipboardSupports(mimeType: string): boolean {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return false;
  return typeof ClipboardItem.supports !== "function" || ClipboardItem.supports(mimeType);
}

async function writeImageBlob(blob: Blob, mimeType: string): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("Image clipboard is unavailable");
  }
  await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })]);
}

async function convertToPng(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Could not prepare the image");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((png) => {
        if (png) resolve(png);
        else reject(new Error("Could not convert the image"));
      }, "image/png");
    });
  } finally {
    bitmap.close();
  }
}

async function copyImage(image: GalleryImage, absoluteUrl: string): Promise<void> {
  const response = await fetch(absoluteUrl, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Could not load the image (${response.status})`);

  const blob = await response.blob();
  const mimeType = blob.type || imageMimeType(image);
  if (clipboardSupports(mimeType)) {
    try {
      await writeImageBlob(blob, mimeType);
      return;
    } catch {
      // Static formats get a broadly supported PNG attempt below.
    }
  }

  if (image.type === "gif") throw new Error("Animated GIF clipboard is unsupported");
  const png = mimeType === "image/png" ? blob : await convertToPng(blob);
  await writeImageBlob(png, "image/png");
}

function createActionIcon(paths: readonly string[]): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("viewBox", "0 0 24 24");
  for (const pathData of paths) {
    const path = document.createElementNS(namespace, "path");
    path.setAttribute("d", pathData);
    icon.append(path);
  }
  return icon;
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

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  const imageCopyButton = document.createElement("button");
  imageCopyButton.type = "button";
  imageCopyButton.className = "tile-action-button";
  imageCopyButton.title = "Copy image";
  imageCopyButton.setAttribute("aria-label", `Copy ${image.name} as an image`);
  imageCopyButton.append(createActionIcon([
    "M8 8h11v11H8z",
    "M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1",
  ]));

  const linkCopyButton = document.createElement("button");
  linkCopyButton.type = "button";
  linkCopyButton.className = "tile-action-button";
  linkCopyButton.title = "Copy link";
  linkCopyButton.setAttribute("aria-label", `Copy direct link to ${image.name}`);
  linkCopyButton.append(createActionIcon([
    "M10.5 13.5l3-3",
    "M7.5 16.5 6 18a4 4 0 0 1-5.7-5.7l3-3A4 4 0 0 1 9 9",
    "M16.5 7.5 18 6a4 4 0 0 1 5.7 5.7l-3 3A4 4 0 0 1 15 15",
  ]));

  actions.append(imageCopyButton, linkCopyButton);

  openButton.append(element);
  tile.append(openButton, actions);
  openButton.addEventListener("click", () => openLightbox(galleryImages.indexOf(image), openButton));
  imageCopyButton.addEventListener("click", async () => {
    const absoluteUrl = new URL(image.url, document.baseURI).href;
    imageCopyButton.disabled = true;
    imageCopyButton.setAttribute("aria-busy", "true");
    try {
      await copyImage(image, absoluteUrl);
      showToast("Image copied");
    } catch {
      try {
        await copyText(absoluteUrl);
        showToast("Link copied instead");
      } catch {
        showToast("Could not copy image or link");
      }
    } finally {
      imageCopyButton.disabled = false;
      imageCopyButton.removeAttribute("aria-busy");
    }
  });
  linkCopyButton.addEventListener("click", async () => {
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
