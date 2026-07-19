import "./styles.css";
import type {
  ErrorResponse,
  GalleryImage,
  GalleryResponse,
  ImageDetailsResponse,
} from "../shared/types.js";

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing required element: ${selector}`);
  return element;
}

const gallery = requiredElement<HTMLElement>("#gallery");
const galleryConfig = {
  searchMetadata: document.documentElement.dataset.gallerySearchMetadata === "true",
  showLanguageToggle: document.documentElement.dataset.galleryLanguageToggle === "true",
  showNames: document.documentElement.dataset.galleryShowNames === "true",
  enableReporting: document.documentElement.dataset.galleryEnableReporting === "true",
  showWatermark: document.documentElement.dataset.galleryShowWatermark === "true",
  watermarkText: document.documentElement.dataset.galleryWatermarkText ?? "",
  watermarkPosition: document.documentElement.dataset.galleryWatermarkPosition ?? "bottom-right",
};
const siteHeader = requiredElement<HTMLElement>(".site-header");
const headerTitle = requiredElement<HTMLElement>(".header-title");
const headerControls = requiredElement<HTMLElement>(".header-controls");
const consentDialog = requiredElement<HTMLDialogElement>("#consent-dialog");
const consentAgree = requiredElement<HTMLButtonElement>("#consent-agree");
const status = requiredElement<HTMLDialogElement>("#status");
const statusMessage = requiredElement<HTMLElement>("#status-message");
const statusClose = requiredElement<HTMLButtonElement>("#status-close");
const imageCount = requiredElement<HTMLElement>("#image-count");
const themeSelect = requiredElement<HTMLSelectElement>("#theme");
const supportHeader = requiredElement<HTMLElement>(".header-meta");
const supportButton = requiredElement<HTMLElement>("#support-button");
const supportCard = requiredElement<HTMLElement>("#support-card");
const shuffleButton = requiredElement<HTMLButtonElement>("#shuffle");
const slideshowButton = requiredElement<HTMLButtonElement>("#slideshow");
const searchInput = requiredElement<HTMLInputElement>("#search");
const favoritesOnly = requiredElement<HTMLInputElement>("#favorites-only");
const nameLanguageFieldset = requiredElement<HTMLElement>(".name-language");
const nameLanguageInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="name-language"]')];
if (nameLanguageInputs.length !== 2) throw new Error("Missing name language controls");
nameLanguageFieldset.hidden = !galleryConfig.showLanguageToggle;
const advancedButton = requiredElement<HTMLButtonElement>("#advanced-filters");
const advancedFilterCount = requiredElement<HTMLElement>("#advanced-filter-count");
advancedButton.hidden = !galleryConfig.searchMetadata;
const filterDialog = requiredElement<HTMLDialogElement>("#filter-dialog");
const filterForm = requiredElement<HTMLFormElement>("#filter-form");
const filterGrid = requiredElement<HTMLElement>("#filter-grid");
const filterClose = requiredElement<HTMLButtonElement>("#filter-close");
const filterReset = requiredElement<HTMLButtonElement>("#filter-reset");
const filterSubmit = requiredElement<HTMLButtonElement>('#filter-form button[type="submit"]');
const lightbox = requiredElement<HTMLDialogElement>("#lightbox");
const lightboxStage = requiredElement<HTMLElement>(".lightbox-stage");
const lightboxName = requiredElement<HTMLElement>("#lightbox-name");
const lightboxMedia = requiredElement<HTMLElement>("#lightbox-media");
const lightboxImage = requiredElement<HTMLImageElement>("#lightbox-image");
const lightboxNameOverlay = requiredElement<HTMLElement>("#lightbox-name-overlay");
const lightboxWatermark = requiredElement<HTMLElement>("#lightbox-watermark");
const lightboxShortNameEn = requiredElement<HTMLElement>("#lightbox-short-name-en");
const lightboxShortNameJa = requiredElement<HTMLElement>("#lightbox-short-name-ja");
const lightboxFavorite = requiredElement<HTMLButtonElement>("#lightbox-favorite");
const lightboxInfo = requiredElement<HTMLButtonElement>("#lightbox-info");
const lightboxReport = requiredElement<HTMLButtonElement>("#lightbox-report");
const lightboxToggleName = requiredElement<HTMLButtonElement>("#lightbox-toggle-name");
const lightboxTextPosition = requiredElement<HTMLButtonElement>("#lightbox-text-position");
const lightboxClose = requiredElement<HTMLButtonElement>("#lightbox-close");
const lightboxPrevious = requiredElement<HTMLButtonElement>("#lightbox-previous");
const lightboxNext = requiredElement<HTMLButtonElement>("#lightbox-next");
const slideshowDialog = requiredElement<HTMLDialogElement>("#slideshow-dialog");
const slideshowMedia = requiredElement<HTMLElement>("#slideshow-media");
const slideshowImages = [
  requiredElement<HTMLImageElement>("#slideshow-image-a"),
  requiredElement<HTMLImageElement>("#slideshow-image-b"),
] as const;
const slideshowNameOverlay = requiredElement<HTMLElement>("#slideshow-name-overlay");
const slideshowShortNameEn = requiredElement<HTMLElement>("#slideshow-short-name-en");
const slideshowShortNameJa = requiredElement<HTMLElement>("#slideshow-short-name-ja");
const reportDialog = requiredElement<HTMLDialogElement>("#report-dialog");
const reportNo = requiredElement<HTMLButtonElement>("#report-no");
const reportYes = requiredElement<HTMLAnchorElement>("#report-yes");
const metadataDialog = requiredElement<HTMLDialogElement>("#metadata-dialog");
const metadataTitle = requiredElement<HTMLElement>("#metadata-title");
const metadataClose = requiredElement<HTMLButtonElement>("#metadata-close");
const metadataStatus = requiredElement<HTMLElement>("#metadata-status");
const metadataContent = requiredElement<HTMLDListElement>("#metadata-content");
const toast = requiredElement<HTMLElement>("#toast");

lightboxReport.hidden = !galleryConfig.enableReporting;
reportDialog.hidden = !galleryConfig.enableReporting;
lightboxToggleName.hidden = !galleryConfig.showNames;
lightboxTextPosition.hidden = !galleryConfig.showNames;
lightboxWatermark.hidden = !galleryConfig.showWatermark;
lightboxWatermark.textContent = galleryConfig.watermarkText;
lightboxMedia.dataset.watermarkPosition = galleryConfig.watermarkPosition;

let toastTimer: number | undefined;
let activeOpener: HTMLButtonElement | undefined;
let activeImageIndex = -1;
let reportOpener: HTMLButtonElement | undefined;
let metadataOpener: HTMLButtonElement | undefined;
let metadataRequestToken = 0;
let lightboxTouchStart: { identifier: number; x: number; y: number; startedAt: number } | undefined;
let activeImageLoads = 0;
let allImages: GalleryImage[] = [];
let galleryImages: GalleryImage[] = [];
let searchTimer: number | undefined;
let shufflePending = false;
let slideshowSequence: GalleryImage[] = [];
let slideshowCurrentImage: GalleryImage | undefined;
let slideshowIndex = -1;
let slideshowActiveLayer = 0;
let slideshowTimer: number | undefined;
let slideshowLoadToken = 0;
const activeFilters = new Map<string, string>();
const imageSearchIndexes = new WeakMap<GalleryImage, string>();
const tilesByImage = new Map<GalleryImage, HTMLElement>();
const favoriteButtonsByImage = new Map<GalleryImage, HTMLButtonElement>();
const imageDetailsByPath = new Map<string, Promise<ImageDetailsResponse>>();
const favoritesStorageKey = "image-gallery:favorites:v1";
const nameLanguageStorageKey = "image-gallery:name-language:v1";
const overlayPreferencesStorageKey = "image-gallery:overlay-preferences:v1";
const contentConsentStorageKey = "image-gallery:content-consent:v1";
const themeStorageKey = "image-gallery:theme:v1";
const favoriteImagePaths = loadFavoriteImagePaths();
type NameLanguage = "en" | "ja";
type GalleryTheme = "editorial" | "glass" | "studio" | "classic" | "daylight" | "neon" | "accessible";
type OverlayNamePosition = "top-left" | "bottom-left" | "bottom-right" | "top-right";
const galleryThemes = new Set<GalleryTheme>(["editorial", "glass", "studio", "classic", "daylight", "neon", "accessible"]);
const uiCopy = {
  en: {
    shuffle: "Shuffle",
    slideshow: "Slideshow",
    searchImages: "Search images",
    onlyFavorites: "Only favorites",
    displayLanguage: "Display name language",
    advanced: "Advanced",
    buyCoffee: "Buy me a coffee",
    enjoyingGallery: "Enjoying the gallery?",
    loadingGallery: "Loading gallery\u2026",
    imageGallery: "Image gallery",
    supportSite: "Support this site",
    advancedFilters: "Advanced filters",
    filterHelp: "Choose any combination of metadata tags.",
    closeFilters: "Close filters",
    reset: "Reset",
    applyFilters: "Apply filters",
    closePreview: "Close preview",
    previousImage: "Previous image",
    nextImage: "Next image",
    addFavorite: "Add favorite",
    removeFavorite: "Remove favorite",
    hideName: "Hide name",
    showName: "Show name",
    textPosition: "Text position",
    copyImage: "Copy image",
    copyLink: "Copy link",
    reportImage: "Report image",
    any: "Any",
    addedFavorite: "Added to favorites",
    removedFavorite: "Removed from favorites",
    imageCopied: "Image copied",
    linkCopiedInstead: "Link copied instead",
    copyImageOrLinkFailed: "Could not copy image or link",
    linkCopied: "Link copied",
    copyLinkFailed: "Could not copy link",
    noImages: "No images yet. Add some files and refresh.",
    noMatches: "No images match your search and filters.",
    loadFailed: "The gallery could not be loaded.",
  },
  ja: {
    shuffle: "シャッフル",
    slideshow: "スライドショー",
    searchImages: "画像を検索",
    onlyFavorites: "お気に入りのみ",
    displayLanguage: "表示言語",
    advanced: "詳細設定",
    buyCoffee: "コーヒーをおごる",
    enjoyingGallery: "ギャラリーを楽しんでいますか？",
    loadingGallery: "ギャラリーを読み込み中…",
    imageGallery: "画像ギャラリー",
    supportSite: "このサイトを支援",
    advancedFilters: "詳細フィルター",
    filterHelp: "メタデータタグを自由に組み合わせてください。",
    closeFilters: "フィルターを閉じる",
    reset: "リセット",
    applyFilters: "フィルターを適用",
    closePreview: "プレビューを閉じる",
    previousImage: "前の画像",
    nextImage: "次の画像",
    addFavorite: "お気に入りに追加",
    removeFavorite: "お気に入りから削除",
    hideName: "名前を非表示",
    showName: "名前を表示",
    textPosition: "テキストの位置",
    copyImage: "画像をコピー",
    copyLink: "リンクをコピー",
    reportImage: "画像を報告",
    any: "指定なし",
    addedFavorite: "お気に入りに追加しました",
    removedFavorite: "お気に入りから削除しました",
    imageCopied: "画像をコピーしました",
    linkCopiedInstead: "代わりにリンクをコピーしました",
    copyImageOrLinkFailed: "画像またはリンクをコピーできませんでした",
    linkCopied: "リンクをコピーしました",
    copyLinkFailed: "リンクをコピーできませんでした",
    noImages: "画像はまだありません。ファイルを追加して更新してください。",
    noMatches: "検索条件やフィルターに一致する画像がありません。",
    loadFailed: "ギャラリーを読み込めませんでした。",
  },
} as const;
type UiCopyKey = keyof typeof uiCopy.en;

const overlayNamePositions: readonly OverlayNamePosition[] = [
  "top-left", "bottom-left", "bottom-right", "top-right",
];
const overlayPositionLabels: Record<NameLanguage, Record<OverlayNamePosition, string>> = {
  en: {
    "top-left": "top left",
    "bottom-left": "bottom left",
    "bottom-right": "bottom right",
    "top-right": "top right",
  },
  ja: {
    "top-left": "左上",
    "bottom-left": "左下",
    "bottom-right": "右下",
    "top-right": "右上",
  },
};
let nameLanguage = loadNameLanguage();
let { nameVisible: overlayNameVisible, namePosition: overlayNamePosition } = loadOverlayPreferences();
let galleryLoadState: "loading" | "ready" | "error" = "loading";
let galleryErrorMessage: string = uiCopy.en.loadFailed;
let galleryDetailsReady = !(galleryConfig.searchMetadata || galleryConfig.showNames);
let galleryDetailsPromise: Promise<void> | undefined;

const maximumConcurrentImageLoads = 4;
const lazyLoadMargin = 150;
const mobileSupportCardImageIndex = 24;
const pendingTiles: HTMLElement[] = [];
let queueRefreshFrame: number | undefined;
let headerLayoutFrame: number | undefined;
let oneRowControlsTrackWidth = 0;
let tileBuildFrame: number | undefined;
let tileBuildToken = 0;

function pixelValue(value: string): number {
  return Number.parseFloat(value) || 0;
}

function outerWidth(element: HTMLElement, minimumWidth = 0): number {
  const style = window.getComputedStyle(element);
  if (style.display === "none" && minimumWidth === 0) return 0;
  return Math.max(element.getBoundingClientRect().width, element.scrollWidth, minimumWidth)
    + pixelValue(style.marginLeft)
    + pixelValue(style.marginRight);
}

function flexRowWidth(container: HTMLElement, widthFor?: (element: HTMLElement) => number): number {
  const style = window.getComputedStyle(container);
  const widths = [...container.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement)
    .map((element) => widthFor?.(element) ?? outerWidth(element))
    .filter((width) => width > 0);
  return widths.reduce((total, width) => total + width, 0)
    + Math.max(0, widths.length - 1) * pixelValue(style.columnGap);
}

function syncHeaderLayout(): void {
  headerLayoutFrame = undefined;
  const headerStyle = window.getComputedStyle(siteHeader);
  if (!siteHeader.classList.contains("is-stacked")) {
    oneRowControlsTrackWidth = Math.max(
      oneRowControlsTrackWidth,
      headerControls.getBoundingClientRect().width,
    );
  }
  const controlsWidth = flexRowWidth(headerControls, (element) => {
    const style = window.getComputedStyle(element);
    const flexBasis = style.flexBasis.endsWith("px") ? pixelValue(style.flexBasis) : 0;
    if (flexBasis > 0) {
      return flexBasis + pixelValue(style.marginLeft) + pixelValue(style.marginRight);
    }
    return outerWidth(element);
  });
  const metaStyle = window.getComputedStyle(supportHeader);
  const metaWidths = [...supportHeader.children]
    .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== supportButton)
    .map((element) => outerWidth(element))
    .filter((width) => width > 0);
  const supportStyle = window.getComputedStyle(supportButton);
  metaWidths.push(outerWidth(supportButton, pixelValue(supportStyle.width)));
  const metaWidth = metaWidths.reduce((total, width) => total + width, 0)
    + Math.max(0, metaWidths.length - 1) * pixelValue(metaStyle.columnGap);
  const edgeColumnWidth = Math.max(flexRowWidth(headerTitle), metaWidth);
  const requiredWidth = 2 * edgeColumnWidth
    + Math.max(controlsWidth, oneRowControlsTrackWidth)
    + 2 * pixelValue(headerStyle.columnGap);
  const availableWidth = siteHeader.clientWidth
    - pixelValue(headerStyle.paddingLeft)
    - pixelValue(headerStyle.paddingRight);
  const shouldStack = requiredWidth > availableWidth;

  const layoutChanged = siteHeader.classList.contains("is-stacked") !== shouldStack;
  siteHeader.classList.toggle("is-stacked", shouldStack);
  if (layoutChanged) syncSupportButtonPlacement();
}

function scheduleHeaderLayout(): void {
  if (headerLayoutFrame !== undefined) return;
  headerLayoutFrame = window.requestAnimationFrame(syncHeaderLayout);
}

function syncSupportButtonPlacement(): void {
  const mobile = siteHeader.classList.contains("is-stacked");
  const anchorImage = galleryImages[mobileSupportCardImageIndex - 1];
  const anchorTile = anchorImage ? tilesByImage.get(anchorImage) : undefined;
  const buttonReady = Boolean(supportButton.querySelector(".bmc-btn"));
  const showCard = mobile && Boolean(anchorTile) && buttonReady;

  supportCard.hidden = !showCard;
  if (showCard && anchorTile) {
    anchorTile.after(supportCard);
    if (supportButton.parentElement !== supportCard) supportCard.append(supportButton);
  } else {
    gallery.insertAdjacentElement("afterend", supportCard);
    if (supportButton.parentElement !== supportHeader) supportHeader.append(supportButton);
  }
  supportButton.querySelector<HTMLAnchorElement>(".bmc-btn")?.setAttribute("rel", "noopener noreferrer");
}

function t(key: UiCopyKey): string {
  return uiCopy[nameLanguage][key];
}

function syncStaticUi(): void {
  document.documentElement.lang = nameLanguage;
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n as UiCopyKey | undefined;
    if (key) element.textContent = t(key);
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    const key = element.dataset.i18nAriaLabel as UiCopyKey | undefined;
    if (key) element.setAttribute("aria-label", t(key));
  }
  for (const element of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    const key = element.dataset.i18nPlaceholder as UiCopyKey | undefined;
    if (key) element.placeholder = t(key);
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-data-text]")) {
    const key = element.dataset.i18nDataText as UiCopyKey | undefined;
    if (key) element.dataset.text = t(key);
  }
  const supportText = supportButton.querySelector<HTMLElement>(".bmc-btn-text");
  if (supportText) supportText.textContent = t("buyCoffee");
}

const supportButtonObserver = new MutationObserver(() => {
  if (!supportButton.querySelector(".bmc-btn")) return;
  supportButtonObserver.disconnect();
  syncStaticUi();
  syncSupportButtonPlacement();
});
if (!supportButton.querySelector(".bmc-btn")) {
  supportButtonObserver.observe(supportButton, { childList: true, subtree: true });
}

syncHeaderLayout();
const headerLayoutObserver = new ResizeObserver(scheduleHeaderLayout);
headerLayoutObserver.observe(siteHeader);
for (const element of [headerTitle, headerControls, supportHeader, imageCount]) {
  headerLayoutObserver.observe(element);
}
void document.fonts.ready.then(scheduleHeaderLayout);

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

function parseFavoriteImagePaths(value: string | null): Set<string> {
  if (!value) return new Set();
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((path): path is string => typeof path === "string"));
  } catch {
    return new Set();
  }
}

function loadFavoriteImagePaths(): Set<string> {
  try {
    return parseFavoriteImagePaths(window.localStorage.getItem(favoritesStorageKey));
  } catch {
    return new Set();
  }
}

function saveFavoriteImagePaths(): void {
  try {
    window.localStorage.setItem(favoritesStorageKey, JSON.stringify([...favoriteImagePaths]));
  } catch {
    // Favorites still work for the current page when storage is unavailable.
  }
}

function loadNameLanguage(): NameLanguage {
  if (!galleryConfig.showLanguageToggle) return "en";
  try {
    return window.localStorage.getItem(nameLanguageStorageKey) === "ja" ? "ja" : "en";
  } catch {
    return "en";
  }
}

function saveNameLanguage(): void {
  try {
    window.localStorage.setItem(nameLanguageStorageKey, nameLanguage);
  } catch {
    // The language selection still works for the current page when storage is unavailable.
  }
}

function parseOverlayPreferences(value: string | null): {
  nameVisible: boolean;
  namePosition: OverlayNamePosition;
} {
  if (!value) return { nameVisible: true, namePosition: "top-left" };
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { nameVisible: true, namePosition: "top-left" };
    }
    const record = parsed as Record<string, unknown>;
    const namePosition = overlayNamePositions.includes(record.namePosition as OverlayNamePosition)
      ? record.namePosition as OverlayNamePosition
      : "top-left";
    return {
      nameVisible: typeof record.nameVisible === "boolean" ? record.nameVisible : true,
      namePosition,
    };
  } catch {
    return { nameVisible: true, namePosition: "top-left" };
  }
}

function loadOverlayPreferences(): { nameVisible: boolean; namePosition: OverlayNamePosition } {
  try {
    return parseOverlayPreferences(window.localStorage.getItem(overlayPreferencesStorageKey));
  } catch {
    return { nameVisible: true, namePosition: "top-left" };
  }
}

function saveOverlayPreferences(): void {
  try {
    window.localStorage.setItem(overlayPreferencesStorageKey, JSON.stringify({
      nameVisible: overlayNameVisible,
      namePosition: overlayNamePosition,
    }));
  } catch {
    // Overlay controls still work for the current page when storage is unavailable.
  }
}

function parseTheme(value: string | null | undefined): GalleryTheme {
  return galleryThemes.has(value as GalleryTheme) ? value as GalleryTheme : "editorial";
}

function loadTheme(): GalleryTheme {
  try {
    return parseTheme(window.localStorage.getItem(themeStorageKey));
  } catch {
    return "editorial";
  }
}

function setTheme(theme: GalleryTheme, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  themeSelect.value = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    {
      editorial: "#10110f",
      glass: "#111528",
      studio: "#171613",
      classic: "#0b0c0e",
      daylight: "#f4f1e9",
      neon: "#05070d",
      accessible: "#000000",
    }[theme],
  );
  if (!persist) return;
  try {
    window.localStorage.setItem(themeStorageKey, theme);
  } catch {
    // The selected style still works for the current page when storage is unavailable.
  }
}

function contentConsentWasAccepted(): boolean {
  try {
    return window.localStorage.getItem(contentConsentStorageKey) === "agreed";
  } catch {
    return false;
  }
}

function saveContentConsent(): void {
  try {
    window.localStorage.setItem(contentConsentStorageKey, "agreed");
  } catch {
    // Consent still applies for the current page when storage is unavailable.
  }
}

function openReportDialog(image: GalleryImage, opener: HTMLButtonElement): void {
  if (!galleryConfig.enableReporting) return;
  reportOpener = opener;
  const imageUrl = new URL(image.url, document.baseURI).href;
  const query = new URLSearchParams({
    subject: "waiaifu report",
    body: imageUrl,
  });
  reportYes.href = `mailto:admin@flamehorn.com?${query}`;
  reportDialog.showModal();
}

function displayNameFor(image: GalleryImage): string {
  return image.shortName?.[nameLanguage] ?? image.displayName;
}

function openImageLabel(displayName: string): string {
  return nameLanguage === "ja" ? `「${displayName}」を開く` : `Open ${displayName}`;
}

function copyImageLabel(displayName: string): string {
  return nameLanguage === "ja" ? `「${displayName}」を画像としてコピー` : `Copy ${displayName} as an image`;
}

function copyLinkLabel(displayName: string): string {
  return nameLanguage === "ja" ? `「${displayName}」への直接リンクをコピー` : `Copy direct link to ${displayName}`;
}

function reportImageLabel(displayName: string): string {
  return nameLanguage === "ja" ? `「${displayName}」を報告` : `Report ${displayName}`;
}

function favoriteActionLabel(favorite: boolean, displayName: string): string {
  if (nameLanguage === "ja") {
    return favorite ? `「${displayName}」をお気に入りから削除` : `「${displayName}」をお気に入りに追加`;
  }
  return `${favorite ? "Remove" : "Add"} ${displayName} ${favorite ? "from" : "to"} favorites`;
}

const overlayColorFields = [
  "hair_color_primary",
  "hair_color_secondary",
  "eye_color_primary",
  "eye_color_secondary",
  "outfit_color",
  "trim_color",
  "jewellery_color",
] as const;

const unusableCssColors = new Set([
  "currentcolor", "inherit", "initial", "revert", "revert-layer", "transparent", "unset",
]);

function resolvedCssColor(value: string): string | undefined {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return undefined;

  const candidates = [
    normalized,
    normalized.replace(/[\s_-]+/g, ""),
    ...normalized.split(/[^a-z0-9#().,%+-]+/).filter(Boolean).reverse(),
  ];
  for (const candidate of new Set(candidates)) {
    if (unusableCssColors.has(candidate) || !CSS.supports("color", candidate)) continue;
    return candidate;
  }
  return undefined;
}

const overlayColorSampler = document.createElement("canvas");
overlayColorSampler.width = 1;
overlayColorSampler.height = 1;
const overlayColorContext = overlayColorSampler.getContext("2d", { willReadFrequently: true });

function colorLuminance(color: string): number | undefined {
  if (!overlayColorContext) return undefined;
  overlayColorContext.clearRect(0, 0, 1, 1);
  overlayColorContext.fillStyle = color;
  overlayColorContext.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = overlayColorContext.getImageData(0, 0, 1, 1).data;
  if (red === undefined || green === undefined || blue === undefined || alpha !== 255) return undefined;

  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function colorsContrast(first: string, second: string): boolean {
  const firstLuminance = colorLuminance(first);
  const secondLuminance = colorLuminance(second);
  if (firstLuminance === undefined || secondLuminance === undefined) return false;
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05) >= 3;
}

const overlayFallbackColors = [
  { fill: "#ff6b6b", outline: "#172554" },
  { fill: "#facc15", outline: "#3b0764" },
  { fill: "#22d3ee", outline: "#312e81" },
  { fill: "#86efac", outline: "#881337" },
  { fill: "#c4b5fd", outline: "#14532d" },
  { fill: "#fdba74", outline: "#1e3a8a" },
  { fill: "#f9a8d4", outline: "#134e4a" },
  { fill: "#7dd3fc", outline: "#581c87" },
] as const;

function fallbackOverlayColors(image: GalleryImage): { fill: string; outline: string } {
  let hash = 2166136261;
  for (const character of image.path) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return overlayFallbackColors[(hash >>> 0) % overlayFallbackColors.length]!;
}

function overlayColors(image: GalleryImage): { fill: string; outline: string } {
  const colors: string[] = [];
  for (const field of overlayColorFields) {
    const value = image.metadata?.tags[field];
    if (!value) continue;
    const color = resolvedCssColor(value);
    if (color && !colors.includes(color)) colors.push(color);
  }
  const fill = colors[0];
  if (fill) {
    const outline = colors.slice(1).find((color) => colorsContrast(fill, color));
    if (outline) return { fill, outline };
  }
  return fallbackOverlayColors(image);
}

function syncLightboxOverlayScale(): void {
  const imageWidth = lightboxImage.getBoundingClientRect().width;
  if (imageWidth <= 0) return;
  const englishSize = Math.min(72, Math.max(22, imageWidth * 0.09));
  lightboxMedia.style.setProperty("--lightbox-name-en-size", `${englishSize}px`);
  lightboxMedia.style.setProperty("--lightbox-name-ja-size", `${englishSize / 2}px`);
}

const lightboxImageSizeObserver = new ResizeObserver(syncLightboxOverlayScale);
lightboxImageSizeObserver.observe(lightboxImage);
lightboxImage.addEventListener("load", syncLightboxOverlayScale);

function nextOverlayNamePosition(): OverlayNamePosition {
  const currentIndex = overlayNamePositions.indexOf(overlayNamePosition);
  return overlayNamePositions[(currentIndex + 1) % overlayNamePositions.length]!;
}

function oppositeOverlayPosition(position: OverlayNamePosition): OverlayNamePosition {
  const opposites: Record<OverlayNamePosition, OverlayNamePosition> = {
    "top-left": "bottom-right",
    "top-right": "bottom-left",
    "bottom-left": "top-right",
    "bottom-right": "top-left",
  };
  return opposites[position];
}

function syncLightboxOverlayState(image?: GalleryImage): void {
  const hasShortName = Boolean(image?.shortName);
  lightboxMedia.dataset.namePosition = overlayNamePosition;
  lightboxMedia.dataset.watermarkPosition = galleryConfig.showNames
    ? oppositeOverlayPosition(overlayNamePosition)
    : galleryConfig.watermarkPosition;
  lightboxNameOverlay.hidden = !galleryConfig.showNames || !hasShortName || !overlayNameVisible;
  lightboxToggleName.disabled = !galleryConfig.showNames || !hasShortName;
  lightboxToggleName.setAttribute("aria-pressed", String(overlayNameVisible));
  lightboxToggleName.querySelector("span")!.textContent = t(overlayNameVisible ? "hideName" : "showName");

  const nextPosition = nextOverlayNamePosition();
  const positionLabel = nameLanguage === "ja"
    ? `名前を${overlayPositionLabels.ja[nextPosition]}に移動`
    : `Move name to ${overlayPositionLabels.en[nextPosition]}`;
  lightboxTextPosition.setAttribute("aria-label", positionLabel);
  lightboxTextPosition.title = positionLabel;
}

function isFavorite(image: GalleryImage): boolean {
  return favoriteImagePaths.has(image.path);
}

function syncTileFavoriteButton(button: HTMLButtonElement, image: GalleryImage): void {
  const favorite = isFavorite(image);
  const displayName = displayNameFor(image);
  button.classList.toggle("is-favorite", favorite);
  button.title = t(favorite ? "removeFavorite" : "addFavorite");
  button.setAttribute("aria-label", favoriteActionLabel(favorite, displayName));
  button.setAttribute("aria-pressed", String(favorite));
}

function syncLightboxFavoriteButton(image: GalleryImage): void {
  const favorite = isFavorite(image);
  const displayName = displayNameFor(image);
  lightboxFavorite.classList.toggle("is-favorite", favorite);
  lightboxFavorite.querySelector("span")!.textContent = t(favorite ? "removeFavorite" : "addFavorite");
  lightboxFavorite.setAttribute("aria-label", favoriteActionLabel(favorite, displayName));
  lightboxFavorite.setAttribute("aria-pressed", String(favorite));
}

function toggleFavorite(image: GalleryImage): void {
  const favorite = !isFavorite(image);
  if (favorite) favoriteImagePaths.add(image.path);
  else favoriteImagePaths.delete(image.path);
  saveFavoriteImagePaths();

  const tileButton = favoriteButtonsByImage.get(image);
  if (tileButton) syncTileFavoriteButton(tileButton, image);
  if (lightbox.open && galleryImages[activeImageIndex] === image) syncLightboxFavoriteButton(image);
  showToast(t(favorite ? "addedFavorite" : "removedFavorite"));

  if (favoritesOnly.checked) {
    applyFilters();
    if (!favorite && lightbox.open) closeLightbox();
  }
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

  const values = [
    image.displayName,
    image.name,
    image.path,
  ];
  if (galleryConfig.searchMetadata) {
    const metadata = image.metadata;
    values.push(
      image.shortName?.en ?? "",
      image.shortName?.ja ?? "",
      image.batch ?? "",
      metadata?.schema ?? "",
      metadata?.resolvedPrompt ?? "",
      ...Object.values(metadata?.tags ?? {}),
      ...Object.values(metadata?.searchTokens ?? {}).flat(),
    );
  }
  const index = normalized(values.join("\n"));
  imageSearchIndexes.set(image, index);
  return index;
}

const japaneseFieldLabels: Record<string, string> = {
  batch: "バッチ",
  body_type: "体型",
  breast_type: "胸のタイプ",
  hair_style: "髪型",
  hair_color_primary: "メインの髪色",
  hair_color_secondary: "サブの髪色",
  hair_accent: "髪のアクセント",
  eye_shape: "目の形",
  eye_color_primary: "メインの瞳色",
  eye_color_secondary: "サブの瞳色",
  eye_accent: "目のアクセント",
  outfit: "衣装",
  outfit_color: "衣装の色",
  trim: "縁取り",
  trim_color: "縁取りの色",
  jewellery: "アクセサリー",
  jewellery_color: "アクセサリーの色",
  pose: "ポーズ",
  facing_direction: "向き",
  scene: "シーン",
  scene_detail: "シーンの詳細",
  lighting: "照明",
  secondary_lighting: "補助照明",
  finish_style: "仕上げスタイル",
};

const japaneseFilterValueLabels: Record<string, string> = {
  none: "なし",
  other: "その他",
  average: "標準",
  petite: "小柄",
  slim: "スリム",
  slender: "細身",
  athletic: "アスリート体型",
  curvy: "曲線的",
  voluptuous: "豊満",
  flat: "平ら",
  small: "小",
  medium: "中",
  large: "大",
  very_large: "特大",
  short: "ショート",
  medium_length: "ミディアム",
  long: "ロング",
  straight: "ストレート",
  wavy: "ウェーブ",
  curly: "カール",
  messy: "無造作",
  bob: "ボブ",
  bob_cut: "ボブカット",
  pixie_cut: "ピクシーカット",
  hime_cut: "姫カット",
  ponytail: "ポニーテール",
  high_ponytail: "ハイポニーテール",
  low_ponytail: "ローポニーテール",
  twin_tails: "ツインテール",
  twintails: "ツインテール",
  braid: "三つ編み",
  braided: "三つ編み",
  bun: "お団子",
  double_bun: "ツインお団子",
  black: "黒",
  white: "白",
  brown: "茶",
  blonde: "金",
  blond: "金",
  red: "赤",
  orange: "オレンジ",
  yellow: "黄",
  green: "緑",
  blue: "青",
  purple: "紫",
  pink: "ピンク",
  silver: "銀",
  gray: "グレー",
  grey: "グレー",
  gold: "金",
  teal: "青緑",
  cyan: "シアン",
  aqua: "水色",
  navy: "紺",
  maroon: "えんじ",
  highlights: "ハイライト",
  streaks: "メッシュ",
  gradient: "グラデーション",
  ombre: "オンブレ",
  colored_tips: "毛先カラー",
  split_color: "ツートーン",
  round: "丸目",
  almond: "アーモンド形",
  narrow: "細目",
  upturned: "つり目",
  downturned: "たれ目",
  sharp: "鋭い目",
  droopy: "たれ目",
  dress: "ドレス",
  school_uniform: "学生服",
  sailor_uniform: "セーラー服",
  kimono: "着物",
  yukata: "浴衣",
  maid_outfit: "メイド服",
  casual: "カジュアル",
  formal: "フォーマル",
  armor: "鎧",
  swimsuit: "水着",
  bikini: "ビキニ",
  hoodie: "パーカー",
  sweater: "セーター",
  jacket: "ジャケット",
  shirt: "シャツ",
  blouse: "ブラウス",
  skirt: "スカート",
  shorts: "ショートパンツ",
  pants: "パンツ",
  suit: "スーツ",
  lace: "レース",
  ribbon: "リボン",
  ribbons: "リボン",
  frills: "フリル",
  embroidery: "刺繍",
  fur: "ファー",
  earrings: "イヤリング",
  necklace: "ネックレス",
  choker: "チョーカー",
  bracelet: "ブレスレット",
  ring: "指輪",
  hairpin: "ヘアピン",
  tiara: "ティアラ",
  crown: "王冠",
  standing: "立ち姿",
  sitting: "座り姿",
  kneeling: "ひざまずき",
  lying: "横たわり",
  walking: "歩行",
  running: "走行",
  looking_back: "振り返り",
  arms_crossed: "腕組み",
  hands_on_hips: "腰に手",
  front: "正面",
  left: "左向き",
  right: "右向き",
  back: "後ろ向き",
  three_quarter: "斜め向き",
  profile: "横顔",
  studio: "スタジオ",
  bedroom: "寝室",
  classroom: "教室",
  city: "都市",
  street: "通り",
  forest: "森",
  beach: "海辺",
  garden: "庭園",
  shrine: "神社",
  cafe: "カフェ",
  night_sky: "夜空",
  sunset: "夕暮れ",
  soft: "柔らかい光",
  hard: "硬い光",
  natural: "自然光",
  warm: "暖色光",
  cool: "寒色光",
  dramatic: "ドラマチック",
  cinematic: "シネマティック",
  rim_light: "リムライト",
  backlight: "逆光",
  neon: "ネオン",
  moonlight: "月明かり",
  sunlight: "日光",
  anime: "アニメ調",
  painterly: "絵画調",
  cel_shaded: "セル画調",
  realistic: "写実的",
  semi_realistic: "半写実的",
  watercolor: "水彩画調",
  illustration: "イラスト調",
  glossy: "光沢仕上げ",
  matte: "マット仕上げ",
  detailed: "精密仕上げ",
};

function filterValueLabel(value: string): string {
  if (nameLanguage !== "ja") return value;
  const normalizedValue = value.trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_");
  return japaneseFilterValueLabels[normalizedValue] ?? value;
}

function fieldLabel(key: string): string {
  if (nameLanguage === "ja" && japaneseFieldLabels[key]) return japaneseFieldLabels[key];
  return key
    .split("_")
    .map((part) => part.charAt(0).toLocaleUpperCase() + part.slice(1))
    .join(" ");
}

function renderFilterControls(): void {
  if (!galleryConfig.searchMetadata) {
    filterGrid.replaceChildren();
    advancedButton.disabled = true;
    return;
  }
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
    anyOption.textContent = t("any");
    select.append(anyOption);

    const counts = facets.get(key)!;
    const values = [...counts.keys()].sort(filterCollator.compare);
    for (const value of values) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = `${filterValueLabel(value)} (${counts.get(value)})`;
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
  advancedButton.setAttribute("aria-label", count === 0
    ? t("advancedFilters")
    : (nameLanguage === "ja" ? `${count}件のフィルターが有効` : `Advanced filters, ${count} active`));
}

function applyFilters(): void {
  const terms = normalized(searchInput.value).split(/\s+/).filter(Boolean);
  const images = allImages.filter((image) => {
    if (favoritesOnly.checked && !isFavorite(image)) return false;
    if (terms.some((term) => !searchIndex(image).includes(term))) return false;
    for (const [key, value] of activeFilters) {
      if (tagValue(image, key) !== value) return false;
    }
    return true;
  });
  updateVisibleImages(images);
  updateFilterCount();
}

function loadingMessage(): string {
  return nameLanguage === "ja"
    ? "画像を読み込んでいます。もう少しだけ待ってね :3"
    : "Loading images, please wait—not long :3";
}

function showStatusModal(message: string, state: "busy" | "empty" | "error"): void {
  status.dataset.state = state;
  statusMessage.textContent = message;
  statusClose.hidden = state === "busy";
  if (!status.open) status.showModal();
}

function closeStatusModal(): void {
  if (status.open) status.close();
}

function waitForStatusPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

async function applyFiltersWithBusy(dialog?: HTMLDialogElement): Promise<void> {
  showStatusModal(loadingMessage(), "busy");
  await waitForStatusPaint();
  applyFilters();
  if (galleryImages.length > 0) closeStatusModal();
  if (dialog?.open) dialog.close();
}

statusClose.addEventListener("click", closeStatusModal);

advancedButton.addEventListener("click", async () => {
  syncFilterControls();
  filterDialog.showModal();
  if (!galleryDetailsReady && galleryDetailsPromise) {
    showStatusModal(loadingMessage(), "busy");
    await galleryDetailsPromise;
    closeStatusModal();
    renderFilterControls();
    syncFilterControls();
  }
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
  filterSubmit.disabled = true;
  void applyFiltersWithBusy(filterDialog).finally(() => {
    filterSubmit.disabled = false;
  });
});
filterDialog.addEventListener("click", (event) => {
  if (event.target === filterDialog) filterDialog.close();
});
searchInput.addEventListener("input", () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void applyFiltersWithBusy(), 120);
});
favoritesOnly.addEventListener("change", () => void applyFiltersWithBusy());

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
    if (!tile.isConnected || tile.dataset.loadState !== "queued" || loadPriority(tile) > 0) {
      pendingTiles.splice(index, 1);
      if (tile.dataset.loadState === "queued") delete tile.dataset.loadState;
    }
  }

  for (const tile of tilesByImage.values()) {
    if (!tile.hidden && loadPriority(tile) === 0) queueImage(tile);
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
  const displayName = displayNameFor(image);
  lightboxName.hidden = !galleryConfig.showNames;
  lightboxName.textContent = displayName;
  lightboxImage.src = new URL(image.url, document.baseURI).href;
  lightboxImage.alt = displayName;
  const shortName = image.shortName;
  lightboxShortNameEn.textContent = shortName?.en ?? "";
  lightboxShortNameJa.textContent = shortName?.ja ?? "";
  const colors = overlayColors(image);
  lightboxMedia.style.setProperty("--lightbox-name-fill", colors.fill);
  lightboxMedia.style.setProperty("--lightbox-name-outline", colors.outline);
  syncLightboxOverlayState(image);
  syncLightboxFavoriteButton(image);
  lightboxReport.setAttribute("aria-label", reportImageLabel(displayName));
  lightboxReport.title = t("reportImage");
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
lightboxReport.addEventListener("click", () => {
  if (!galleryConfig.enableReporting) return;
  const image = galleryImages[activeImageIndex];
  if (image) openReportDialog(image, lightboxReport);
});
lightboxFavorite.addEventListener("click", () => {
  const image = galleryImages[activeImageIndex];
  if (image) toggleFavorite(image);
});
lightboxToggleName.addEventListener("click", () => {
  const image = galleryImages[activeImageIndex];
  if (!image?.shortName) return;
  overlayNameVisible = !overlayNameVisible;
  saveOverlayPreferences();
  syncLightboxOverlayState(image);
});
lightboxTextPosition.addEventListener("click", () => {
  overlayNamePosition = nextOverlayNamePosition();
  saveOverlayPreferences();
  syncLightboxOverlayState(galleryImages[activeImageIndex]);
});
lightboxPrevious.addEventListener("click", () => navigateLightbox(-1));
lightboxNext.addEventListener("click", () => navigateLightbox(1));
lightbox.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    event.preventDefault();
    navigateLightbox(-1);
  } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    event.preventDefault();
    navigateLightbox(1);
  }
});
lightboxStage.addEventListener("touchstart", (event) => {
  const target = event.target instanceof Element ? event.target : undefined;
  if (event.touches.length !== 1 || !target?.closest(".lightbox-content") || target.closest("button")) {
    lightboxTouchStart = undefined;
    return;
  }

  const touch = event.touches.item(0);
  if (!touch) return;
  lightboxTouchStart = {
    identifier: touch.identifier,
    x: touch.clientX,
    y: touch.clientY,
    startedAt: Date.now(),
  };
}, { passive: true });
lightboxStage.addEventListener("touchend", (event) => {
  const start = lightboxTouchStart;
  lightboxTouchStart = undefined;
  if (!start || Date.now() - start.startedAt > 800) return;

  let touch: Touch | undefined;
  for (let index = 0; index < event.changedTouches.length; index += 1) {
    const candidate = event.changedTouches.item(index);
    if (candidate?.identifier === start.identifier) {
      touch = candidate;
      break;
    }
  }
  if (!touch) return;

  const horizontalDistance = touch.clientX - start.x;
  const verticalDistance = touch.clientY - start.y;
  if (Math.max(Math.abs(horizontalDistance), Math.abs(verticalDistance)) < 48) return;
  const forward = Math.abs(horizontalDistance) > Math.abs(verticalDistance)
    ? horizontalDistance < 0
    : verticalDistance < 0;
  navigateLightbox(forward ? 1 : -1);
}, { passive: true });
lightboxStage.addEventListener("touchcancel", () => {
  lightboxTouchStart = undefined;
}, { passive: true });
lightbox.addEventListener("click", (event) => {
  if (event.target === lightbox || event.target === lightboxStage) closeLightbox();
});
lightbox.addEventListener("close", () => {
  document.body.classList.remove("lightbox-open");
  lightboxName.textContent = "";
  lightboxNameOverlay.hidden = true;
  lightboxShortNameEn.textContent = "";
  lightboxShortNameJa.textContent = "";
  lightboxImage.removeAttribute("src");
  lightboxTouchStart = undefined;
  activeImageIndex = -1;
  activeOpener?.focus({ preventScroll: true });
  activeOpener = undefined;
});
lightboxInfo.addEventListener("click", () => {
  const image = galleryImages[activeImageIndex];
  if (image) void openMetadataDialog(image, lightboxInfo);
});

function randomOverlayNamePosition(): OverlayNamePosition {
  return overlayNamePositions[Math.floor(Math.random() * overlayNamePositions.length)]!;
}

function clearSlideshowTimer(): void {
  if (slideshowTimer !== undefined) window.clearTimeout(slideshowTimer);
  slideshowTimer = undefined;
}

function syncSlideshowName(image?: GalleryImage): void {
  const shortName = image?.shortName;
  slideshowNameOverlay.hidden = !galleryConfig.showNames || !shortName;
  slideshowShortNameEn.textContent = shortName?.en ?? "";
  slideshowShortNameJa.textContent = shortName?.ja ?? "";
  if (!image) return;

  const colors = overlayColors(image);
  slideshowMedia.style.setProperty("--slideshow-name-fill", colors.fill);
  slideshowMedia.style.setProperty("--slideshow-name-outline", colors.outline);
}

function scheduleSlideshowAdvance(): void {
  clearSlideshowTimer();
  if (!slideshowDialog.open) return;
  slideshowTimer = window.setTimeout(advanceSlideshow, 5000);
}

function advanceSlideshow(): void {
  if (!slideshowDialog.open || slideshowSequence.length === 0) return;

  slideshowIndex = (slideshowIndex + 1) % slideshowSequence.length;
  const nextImage = slideshowSequence[slideshowIndex]!;
  const nextLayer = slideshowActiveLayer === 0 ? 1 : 0;
  const nextElement = slideshowImages[nextLayer]!;
  const loadToken = ++slideshowLoadToken;
  const displayName = displayNameFor(nextImage);

  const complete = (): void => {
    if (loadToken !== slideshowLoadToken || !slideshowDialog.open) return;
    slideshowImages[slideshowActiveLayer]!.classList.remove("is-active");
    nextElement.classList.add("is-active");
    slideshowActiveLayer = nextLayer;
    slideshowCurrentImage = nextImage;
    slideshowMedia.dataset.namePosition = randomOverlayNamePosition();
    syncSlideshowName(nextImage);
    scheduleSlideshowAdvance();
  };
  nextElement.addEventListener("load", complete, { once: true });
  nextElement.addEventListener("error", () => {
    if (loadToken === slideshowLoadToken && slideshowDialog.open) scheduleSlideshowAdvance();
  }, { once: true });
  nextElement.alt = displayName;
  nextElement.src = new URL(nextImage.url, document.baseURI).href;
}

function openSlideshow(): void {
  if (galleryImages.length < 2) return;
  if (lightbox.open) closeLightbox();
  slideshowSequence = shuffledImages(galleryImages);
  slideshowIndex = -1;
  slideshowCurrentImage = undefined;
  slideshowActiveLayer = 0;
  slideshowLoadToken += 1;
  clearSlideshowTimer();
  for (const image of slideshowImages) {
    image.classList.remove("is-active");
    image.removeAttribute("src");
  }
  syncSlideshowName();
  slideshowDialog.showModal();
  document.body.classList.add("slideshow-open");
  advanceSlideshow();
}

function closeSlideshow(): void {
  if (slideshowDialog.open) slideshowDialog.close();
}

slideshowButton.addEventListener("click", openSlideshow);
slideshowDialog.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeSlideshow();
});
slideshowDialog.addEventListener("click", (event) => {
  if (event.target === slideshowDialog) closeSlideshow();
});
slideshowDialog.addEventListener("close", () => {
  clearSlideshowTimer();
  slideshowLoadToken += 1;
  slideshowSequence = [];
  slideshowCurrentImage = undefined;
  slideshowIndex = -1;
  for (const image of slideshowImages) {
    image.classList.remove("is-active");
    image.removeAttribute("src");
  }
  syncSlideshowName();
  document.body.classList.remove("slideshow-open");
  slideshowButton.focus({ preventScroll: true });
});

reportNo.addEventListener("click", () => reportDialog.close());
reportYes.addEventListener("click", () => reportDialog.close());
reportDialog.addEventListener("close", () => {
  reportOpener?.focus({ preventScroll: true });
  reportOpener = undefined;
});

function metadataLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function appendMetadataRow(label: string, value: string): void {
  const term = document.createElement("dt");
  term.textContent = label;
  const description = document.createElement("dd");
  description.textContent = value || "—";
  metadataContent.append(term, description);
}

function renderImageMetadata(image: GalleryImage): void {
  metadataTitle.textContent = displayNameFor(image);
  metadataContent.replaceChildren();
  if (image.shortName) {
    appendMetadataRow("English name", image.shortName.en);
    appendMetadataRow("Japanese name", image.shortName.ja);
  }

  const metadata = image.metadata;
  if (!metadata) {
    metadataStatus.textContent = "No metadata sidecar is available for this image.";
    return;
  }
  metadataStatus.textContent = "";
  for (const [key, value] of Object.entries(metadata.tags)) appendMetadataRow(metadataLabel(key), value);
  for (const [key, values] of Object.entries(metadata.searchTokens)) {
    appendMetadataRow(`${metadataLabel(key)} search tokens`, values.join(", "));
  }
  appendMetadataRow("Resolved prompt", metadata.resolvedPrompt);
}

async function loadImageDetails(image: GalleryImage): Promise<ImageDetailsResponse> {
  let request = imageDetailsByPath.get(image.path);
  if (!request) {
    const url = new URL("api/image-details", document.baseURI);
    url.searchParams.set("path", image.path);
    request = fetch(url).then(async (response) => {
      const payload = await response.json() as ImageDetailsResponse | ErrorResponse;
      if (!response.ok || "error" in payload) throw new Error("error" in payload ? payload.error : "Image metadata could not be loaded.");
      return payload;
    });
    imageDetailsByPath.set(image.path, request);
  }
  return request;
}

async function openMetadataDialog(image: GalleryImage, opener: HTMLButtonElement): Promise<void> {
  metadataOpener = opener;
  const token = ++metadataRequestToken;
  metadataTitle.textContent = displayNameFor(image);
  metadataStatus.textContent = "Loading image metadata…";
  metadataContent.replaceChildren();
  if (!metadataDialog.open) metadataDialog.showModal();
  try {
    Object.assign(image, await loadImageDetails(image));
    if (token === metadataRequestToken) renderImageMetadata(image);
  } catch (error) {
    if (token === metadataRequestToken) metadataStatus.textContent = error instanceof Error ? error.message : "Image metadata could not be loaded.";
  }
}

metadataClose.addEventListener("click", () => metadataDialog.close());
metadataDialog.addEventListener("click", (event) => {
  if (event.target === metadataDialog) metadataDialog.close();
});
metadataDialog.addEventListener("close", () => {
  metadataRequestToken += 1;
  metadataOpener?.focus({ preventScroll: true });
  metadataOpener = undefined;
});

function createTile(image: GalleryImage): HTMLElement {
  const tile = document.createElement("article");
  tile.className = "gallery-item is-loading";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "image-open";
  openButton.setAttribute("aria-label", openImageLabel(displayNameFor(image)));
  openButton.setAttribute("aria-busy", "true");

  const element = document.createElement("img");
  element.className = "gallery-image";
  element.dataset.src = new URL(image.previewUrl ?? image.url, document.baseURI).href;
  element.alt = "";
  element.loading = "lazy";
  element.decoding = "async";
  element.fetchPriority = "low";

  const shortName = document.createElement("span");
  shortName.className = "gallery-short-name";
  shortName.hidden = !galleryConfig.showNames;
  shortName.textContent = image.shortName?.[nameLanguage] ?? "";
  shortName.lang = nameLanguage === "ja" ? "ja" : "en";
  shortName.setAttribute("aria-hidden", "true");

  const actions = document.createElement("div");
  actions.className = "tile-actions";

  const favoriteButton = document.createElement("button");
  favoriteButton.type = "button";
  favoriteButton.className = "tile-action-button favorite-button";
  favoriteButton.append(createActionIcon([
    "m12 2.75 2.85 5.78 6.38.93-4.62 4.5 1.09 6.35-5.7-3-5.7 3 1.09-6.35-4.62-4.5 6.38-.93L12 2.75Z",
  ]));
  syncTileFavoriteButton(favoriteButton, image);
  favoriteButtonsByImage.set(image, favoriteButton);

  const imageCopyButton = document.createElement("button");
  imageCopyButton.type = "button";
  imageCopyButton.className = "tile-action-button";
  imageCopyButton.dataset.action = "copy-image";
  imageCopyButton.title = t("copyImage");
  imageCopyButton.setAttribute("aria-label", copyImageLabel(displayNameFor(image)));
  imageCopyButton.append(createActionIcon([
    "M8 8h11v11H8z",
    "M5 16H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v1",
  ]));

  const linkCopyButton = document.createElement("button");
  linkCopyButton.type = "button";
  linkCopyButton.className = "tile-action-button";
  linkCopyButton.dataset.action = "copy-link";
  linkCopyButton.title = t("copyLink");
  linkCopyButton.setAttribute("aria-label", copyLinkLabel(displayNameFor(image)));
  linkCopyButton.append(createActionIcon([
    "M10.5 13.5l3-3",
    "M7.5 16.5 6 18a4 4 0 0 1-5.7-5.7l3-3A4 4 0 0 1 9 9",
    "M16.5 7.5 18 6a4 4 0 0 1 5.7 5.7l-3 3A4 4 0 0 1 15 15",
  ]));

  actions.append(favoriteButton, imageCopyButton, linkCopyButton);

  const infoButton = document.createElement("button");
  infoButton.type = "button";
  infoButton.className = "tile-action-button tile-info-button";
  infoButton.title = "Image information";
  infoButton.setAttribute("aria-label", `Show information for ${displayNameFor(image)}`);
  infoButton.textContent = "i";

  openButton.append(element, shortName);
  tile.append(openButton, actions, infoButton);
  openButton.addEventListener("click", () => openLightbox(galleryImages.indexOf(image), openButton));
  if (galleryConfig.enableReporting) {
    const reportButton = document.createElement("button");
    reportButton.type = "button";
    reportButton.className = "report-button tile-report-button";
    reportButton.title = t("reportImage");
    reportButton.setAttribute("aria-label", reportImageLabel(displayNameFor(image)));
    const reportSymbol = document.createElement("span");
    reportSymbol.setAttribute("aria-hidden", "true");
    reportSymbol.textContent = "!";
    reportButton.append(reportSymbol);
    tile.append(reportButton);
    reportButton.addEventListener("click", () => openReportDialog(image, reportButton));
  }
  favoriteButton.addEventListener("click", () => toggleFavorite(image));
  infoButton.addEventListener("click", () => void openMetadataDialog(image, infoButton));
  imageCopyButton.addEventListener("click", async () => {
    const absoluteUrl = new URL(image.url, document.baseURI).href;
    imageCopyButton.disabled = true;
    imageCopyButton.setAttribute("aria-busy", "true");
    try {
      await copyImage(image, absoluteUrl);
      showToast(t("imageCopied"));
    } catch {
      try {
        await copyText(absoluteUrl);
        showToast(t("linkCopiedInstead"));
      } catch {
        showToast(t("copyImageOrLinkFailed"));
      }
    } finally {
      imageCopyButton.disabled = false;
      imageCopyButton.removeAttribute("aria-busy");
    }
  });
  linkCopyButton.addEventListener("click", async () => {
    try {
      await copyText(new URL(image.url, document.baseURI).href);
      showToast(t("linkCopied"));
    } catch {
      showToast(t("copyLinkFailed"));
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
    favoriteButtonsByImage.delete(image);
    tileObserver.unobserve(openButton);
    lazyImageObserver.unobserve(tile);
  }, { once: true });

  tileObserver.observe(openButton);
  lazyImageObserver.observe(tile);
  return tile;
}

function syncNameLanguageDisplay(): void {
  syncStaticUi();
  for (const input of nameLanguageInputs) input.checked = input.value === nameLanguage;
  for (const [image, tile] of tilesByImage) {
    const displayName = displayNameFor(image);
    tile.querySelector<HTMLButtonElement>(".image-open")?.setAttribute("aria-label", openImageLabel(displayName));
    const shortName = tile.querySelector<HTMLElement>(".gallery-short-name");
    if (shortName) {
      shortName.textContent = image.shortName?.[nameLanguage] ?? "";
      shortName.lang = nameLanguage === "ja" ? "ja" : "en";
      shortName.hidden = !galleryConfig.showNames;
    }
    const copyImageButton = tile.querySelector<HTMLButtonElement>('[data-action="copy-image"]');
    copyImageButton?.setAttribute("aria-label", copyImageLabel(displayName));
    if (copyImageButton) copyImageButton.title = t("copyImage");
    const copyLinkButton = tile.querySelector<HTMLButtonElement>('[data-action="copy-link"]');
    copyLinkButton?.setAttribute("aria-label", copyLinkLabel(displayName));
    if (copyLinkButton) copyLinkButton.title = t("copyLink");
    const reportButton = tile.querySelector<HTMLButtonElement>(".tile-report-button");
    reportButton?.setAttribute("aria-label", reportImageLabel(displayName));
    if (reportButton) reportButton.title = t("reportImage");
    const favoriteButton = favoriteButtonsByImage.get(image);
    if (favoriteButton) syncTileFavoriteButton(favoriteButton, image);
  }

  const activeImage = galleryImages[activeImageIndex];
  if (lightbox.open && activeImage) {
    const displayName = displayNameFor(activeImage);
    lightboxName.textContent = displayName;
    lightboxImage.alt = displayName;
    lightboxReport.setAttribute("aria-label", reportImageLabel(displayName));
    lightboxReport.title = t("reportImage");
    syncLightboxFavoriteButton(activeImage);
  }
  syncLightboxOverlayState(activeImage);
  syncSlideshowName(slideshowCurrentImage);
  if (galleryLoadState === "ready") {
    renderFilterControls();
    syncFilterControls();
    applyFilters();
  } else if (galleryLoadState === "error") {
    showStatusModal(nameLanguage === "ja" ? t("loadFailed") : galleryErrorMessage, "error");
  }
}

function setNameLanguage(value: NameLanguage, persist: boolean): void {
  nameLanguage = value;
  if (persist) saveNameLanguage();
  syncNameLanguageDisplay();
}

function updateShuffleButtonState(): void {
  shuffleButton.disabled = shufflePending || allImages.length < 2;
  slideshowButton.disabled = galleryImages.length < 2;
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
  syncSupportButtonPlacement();
  scheduleQueueRefresh();
}

function initializeTiles(): void {
  tileBuildToken += 1;
  const buildToken = tileBuildToken;
  if (tileBuildFrame !== undefined) {
    window.cancelAnimationFrame(tileBuildFrame);
    tileBuildFrame = undefined;
  }
  cancelQueueRefresh();
  tilesByImage.clear();
  favoriteButtonsByImage.clear();
  tileObserver.disconnect();
  lazyImageObserver.disconnect();
  pendingTiles.length = 0;
  activeImageLoads = 0;
  let nextIndex = 0;
  const buildBatch = (): void => {
    tileBuildFrame = undefined;
    if (buildToken !== tileBuildToken) return;

    const batchSize = nextIndex === 0
      ? Math.max(24, Math.ceil((window.innerWidth / 300) * (window.innerHeight / 240)) * 2)
      : 96;
    const fragment = document.createDocumentFragment();
    const endIndex = Math.min(allImages.length, nextIndex + batchSize);
    for (; nextIndex < endIndex; nextIndex += 1) {
      const image = allImages[nextIndex]!;
      const tile = createTile(image);
      tilesByImage.set(image, tile);
      fragment.append(tile);
    }
    gallery.append(fragment);

    if (nextIndex === endIndex && nextIndex < allImages.length) {
      if (nextIndex === batchSize) {
        reorderTiles();
        applyFilters();
        closeStatusModal();
      }
      tileBuildFrame = window.requestAnimationFrame(buildBatch);
      return;
    }

  reorderTiles();
  applyFilters();
  closeStatusModal();
  };
  buildBatch();
}

function updateVisibleImages(images: GalleryImage[]): void {
  galleryImages = images;
  const visibleImages = new Set(images);
  for (const image of allImages) {
    const tile = tilesByImage.get(image);
    if (tile) tile.hidden = !visibleImages.has(image);
  }
  syncSupportButtonPlacement();

  const maximumImages = allImages.length;
  if (images.length === maximumImages) {
    imageCount.textContent = nameLanguage === "ja"
      ? `${images.length}枚`
      : (images.length === 1 ? "1 image" : `${images.length} images`);
  } else {
    imageCount.textContent = nameLanguage === "ja"
      ? `${maximumImages}枚中${images.length}枚`
      : `${images.length} of ${maximumImages} images`;
  }
  updateShuffleButtonState();
  if (images.length === 0) {
    showStatusModal(t(allImages.length === 0 ? "noImages" : "noMatches"), "empty");
  } else if (status.dataset.state !== "busy") {
    closeStatusModal();
  }
  scheduleQueueRefresh();
}

async function loadGallery(): Promise<void> {
  galleryLoadState = "loading";
  showStatusModal(loadingMessage(), "busy");
  try {
    const imagesUrl = new URL("api/images", document.baseURI);
    const response = await fetch(imagesUrl);
    const payload = (await response.json()) as GalleryResponse | ErrorResponse;
    if (!response.ok || !("images" in payload)) {
      showGalleryLoadError("error" in payload ? payload.error : uiCopy.en.loadFailed);
      return;
    }
    allImages = shuffledImages(payload.images);
    galleryLoadState = "ready";
    activeFilters.clear();
    renderFilterControls();
    initializeTiles();
    if (galleryConfig.searchMetadata || galleryConfig.showNames) {
      galleryDetailsPromise = loadGalleryDetails();
    }
  } catch (error) {
    showGalleryLoadError(error instanceof Error ? error.message : uiCopy.en.loadFailed);
  }
}

async function loadGalleryDetails(): Promise<void> {
  try {
    const imagesUrl = new URL("api/images", document.baseURI);
    imagesUrl.searchParams.set("details", "1");
    const response = await fetch(imagesUrl);
    const payload = await response.json() as GalleryResponse | ErrorResponse;
    if (!response.ok || !("images" in payload)) return;
    const detailsByPath = new Map(payload.images.map((image) => [image.path, image]));
    for (const image of allImages) {
      const details = detailsByPath.get(image.path);
      if (details) Object.assign(image, details);
    }
    syncNameLanguageDisplay();
  } catch (error) {
    console.warn("Could not load gallery metadata in the background:", error);
  } finally {
    galleryDetailsReady = true;
  }
}

function showGalleryLoadError(message: string): void {
  galleryLoadState = "error";
  galleryErrorMessage = message;
  allImages = [];
  galleryImages = [];
  gallery.replaceChildren();
  syncSupportButtonPlacement();
  shuffleButton.disabled = true;
  slideshowButton.disabled = true;
  advancedButton.disabled = true;
  imageCount.textContent = "";
  showStatusModal(nameLanguage === "ja" ? t("loadFailed") : galleryErrorMessage, "error");
}

shuffleButton.addEventListener("click", shuffleGallery);
themeSelect.addEventListener("change", () => setTheme(parseTheme(themeSelect.value), true));
for (const input of nameLanguageInputs) {
  input.addEventListener("change", () => {
    if (input.checked && (input.value === "en" || input.value === "ja")) {
      setNameLanguage(input.value, true);
    }
  });
}
window.addEventListener("storage", (event) => {
  if (event.key === themeStorageKey) {
    setTheme(parseTheme(event.newValue), false);
  } else if (event.key === nameLanguageStorageKey) {
    setNameLanguage(event.newValue === "ja" ? "ja" : "en", false);
  } else if (event.key === overlayPreferencesStorageKey) {
    const preferences = parseOverlayPreferences(event.newValue);
    overlayNameVisible = preferences.nameVisible;
    overlayNamePosition = preferences.namePosition;
    syncLightboxOverlayState(lightbox.open ? galleryImages[activeImageIndex] : undefined);
  } else if (event.key === favoritesStorageKey) {
    const updatedPaths = parseFavoriteImagePaths(event.newValue);
    favoriteImagePaths.clear();
    for (const path of updatedPaths) favoriteImagePaths.add(path);
    for (const [image, button] of favoriteButtonsByImage) syncTileFavoriteButton(button, image);
    const activeImage = galleryImages[activeImageIndex];
    if (lightbox.open && activeImage) syncLightboxFavoriteButton(activeImage);
    if (lightbox.open && favoritesOnly.checked && activeImage && !isFavorite(activeImage)) closeLightbox();
    applyFilters();
  }
});

setTheme(loadTheme(), false);
syncNameLanguageDisplay();
syncLightboxOverlayState();

consentDialog.addEventListener("cancel", (event) => event.preventDefault());
consentAgree.addEventListener("click", () => {
  saveContentConsent();
  consentDialog.close();
  document.body.classList.remove("consent-pending");
  void loadGallery();
});

if (contentConsentWasAccepted()) {
  document.body.classList.remove("consent-pending");
  void loadGallery();
} else {
  consentDialog.showModal();
}
