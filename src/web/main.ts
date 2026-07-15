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
let galleryImages: GalleryImage[] = [];
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
  galleryImages = shuffledImages(galleryImages);
  for (const [index, image] of galleryImages.entries()) {
    const tile = tilesByImage.get(image);
    if (tile) tile.style.order = String(index);
  }

  cancelQueueRefresh();
  queueRefreshFrame = window.requestAnimationFrame(refreshImageQueue);
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
    image.src = source;
  }
}

function queueImage(tile: HTMLElement): boolean {
  if (tile.dataset.loadState) return false;
  tile.dataset.loadState = "queued";
  pendingTiles.push(tile);
  return true;
}

function enqueueImage(tile: HTMLElement): void {
  if (!queueImage(tile)) return;
  drainImageQueue();
}

function loadPriority(tile: HTMLElement): number {
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
    if (tile.dataset.loadState !== "queued") {
      pendingTiles.splice(index, 1);
      continue;
    }
    if (loadPriority(tile) === 0) continue;

    pendingTiles.splice(index, 1);
    delete tile.dataset.loadState;
    lazyImageObserver.observe(tile);
  }

  for (const image of galleryImages) {
    const tile = tilesByImage.get(image);
    if (!tile || loadPriority(tile) !== 0) continue;
    if (queueImage(tile)) lazyImageObserver.unobserve(tile);
  }

  pendingTiles.sort((left, right) => {
    const leftBounds = left.getBoundingClientRect();
    const rightBounds = right.getBoundingClientRect();
    return leftBounds.top - rightBounds.top || leftBounds.left - rightBounds.left;
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
    lazyImageObserver.unobserve(tile);
    enqueueImage(tile);
  }
}, { rootMargin: `${lazyLoadMargin}px 0px` });

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
    finishImageLoad(tile);
    window.requestAnimationFrame(() => resizeTile(tile));
  };

  element.addEventListener("load", markReady, { once: true });
  element.addEventListener("error", () => {
    finishImageLoad(tile);
    tile.remove();
    tileObserver.unobserve(openButton);
    lazyImageObserver.unobserve(tile);
  }, { once: true });

  tileObserver.observe(openButton);
  lazyImageObserver.observe(tile);
  return tile;
}

function renderImages(images: GalleryImage[]): void {
  cancelQueueRefresh();
  galleryImages = images;
  tilesByImage.clear();
  tileObserver.disconnect();
  lazyImageObserver.disconnect();
  pendingTiles.length = 0;
  gallery.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const image of images) {
    const tile = createTile(image);
    tilesByImage.set(image, tile);
    fragment.append(tile);
  }
  gallery.append(fragment);

  imageCount.textContent = images.length === 1 ? "1 image" : `${images.length} images`;
  shuffleButton.disabled = images.length < 2;
  status.hidden = images.length > 0;
  status.textContent = images.length === 0 ? "No images yet. Add some files and refresh." : "";
}

async function loadGallery(): Promise<void> {
  status.hidden = false;
  status.textContent = "Loading gallery…";
  try {
    const response = await fetch(new URL("api/images", document.baseURI), { cache: "no-store" });
    const payload = (await response.json()) as GalleryResponse | ErrorResponse;
    if (!response.ok || !("images" in payload)) {
      throw new Error("error" in payload ? payload.error : "The gallery could not be loaded.");
    }
    renderImages(shuffledImages(payload.images));
  } catch (error) {
    gallery.replaceChildren();
    shuffleButton.disabled = true;
    imageCount.textContent = "";
    status.hidden = false;
    status.textContent = error instanceof Error ? error.message : "The gallery could not be loaded.";
  }
}

shuffleButton.addEventListener("click", shuffleGallery);

void loadGallery();
