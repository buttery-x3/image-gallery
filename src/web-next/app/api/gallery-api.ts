import type { AdminDeleteResponse, AdminSessionResponse, ErrorResponse, GalleryImage, GalleryIndexItem, GalleryIndexResponse, GalleryResponse, ImageDetailsResponse } from "../../../shared/types";

let applicationBaseUrl = new URL("./", typeof document === "undefined" ? "http://localhost/" : document.baseURI);

export function galleryPageUrlFor(currentHref: string): URL {
  const url = new URL(currentHref);
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.at(-1)?.toLocaleLowerCase() === "slideshow") segments.pop();
  url.pathname = `/${segments.join("/")}${segments.length ? "/" : ""}`;
  url.search = "";
  url.hash = "";
  return url;
}

export function applicationBaseFor(baseUri: string, routeSlugs: readonly string[]): URL {
  const url = new URL(baseUri);
  const segments = url.pathname.split("/").filter(Boolean);
  const knownRoutes = new Set(["slideshow", ...routeSlugs.map((slug) => slug.toLocaleLowerCase())]);
  while (segments.length > 0 && knownRoutes.has(segments.at(-1)!.toLocaleLowerCase())) segments.pop();
  url.pathname = `/${segments.join("/")}${segments.length ? "/" : ""}`;
  url.search = "";
  url.hash = "";
  return url;
}

export function configureApplicationBase(routeSlugs: readonly string[]): void {
  applicationBaseUrl = applicationBaseFor(document.baseURI, routeSlugs);
}

export function applicationUrl(relativeUrl: string): URL {
  return new URL(relativeUrl, applicationBaseUrl);
}

async function jsonRequest<T>(relativeUrl: string, init?: RequestInit): Promise<T> {
  const response = await fetch(applicationUrl(relativeUrl), init);
  const payload = await response.json() as T | ErrorResponse;
  if (!response.ok || (payload && typeof payload === "object" && "error" in payload)) {
    throw new Error("error" in (payload as ErrorResponse) ? (payload as ErrorResponse).error : `Request failed (${response.status})`);
  }
  return payload as T;
}

export async function loadImages(): Promise<GalleryImage[]> {
  return (await jsonRequest<GalleryResponse>("api/v2/images")).images;
}

export async function loadGalleryIndex(): Promise<Map<string, GalleryIndexItem>> {
  const payload = await jsonRequest<GalleryIndexResponse>("api/v2/gallery-index");
  return new Map(payload.images.map((image) => [image.path, image]));
}

export function loadImageDetails(path: string): Promise<ImageDetailsResponse> {
  const url = applicationUrl("api/image-details");
  url.searchParams.set("path", path);
  return jsonRequest<ImageDetailsResponse>(url.href);
}

export function loadAdminSession(): Promise<AdminSessionResponse> {
  return jsonRequest<AdminSessionResponse>("api/admin/session", { cache: "no-store" });
}

export function loginAdmin(password: string): Promise<AdminSessionResponse> {
  return jsonRequest<AdminSessionResponse>("api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
}

export function logoutAdmin(): Promise<AdminSessionResponse> {
  return jsonRequest<AdminSessionResponse>("api/admin/logout", { method: "POST" });
}

export function deleteAdminImage(imagePath: string): Promise<AdminDeleteResponse> {
  return jsonRequest<AdminDeleteResponse>("api/admin/images", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imagePath }),
  });
}

export function absoluteMediaUrl(image: GalleryImage): string {
  return applicationUrl(image.url).href;
}

export function tileMediaUrl(image: GalleryImage): string {
  return applicationUrl(image.previewUrl ?? image.url).href;
}

export function posterMediaUrl(image: GalleryImage): string | undefined {
  return image.posterUrl ? applicationUrl(image.posterUrl).href : undefined;
}
