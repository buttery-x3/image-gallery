import type { ErrorResponse, GalleryImage, GalleryIndexItem, GalleryIndexResponse, GalleryResponse, ImageDetailsResponse } from "../../../shared/types";

async function jsonRequest<T>(relativeUrl: string): Promise<T> {
  const response = await fetch(new URL(relativeUrl, document.baseURI));
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
  const url = new URL("api/image-details", document.baseURI);
  url.searchParams.set("path", path);
  return jsonRequest<ImageDetailsResponse>(url.href);
}

export function absoluteMediaUrl(image: GalleryImage): string {
  return new URL(image.url, document.baseURI).href;
}

export function tileMediaUrl(image: GalleryImage): string {
  return new URL(image.previewUrl ?? image.url, document.baseURI).href;
}
