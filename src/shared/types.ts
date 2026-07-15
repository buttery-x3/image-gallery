export const imageKinds = ["jpeg", "png", "gif", "webp", "avif"] as const;

export type ImageKind = (typeof imageKinds)[number];

export interface GalleryImage {
  name: string;
  path: string;
  url: string;
  modifiedAt: string;
  type: ImageKind;
}

export interface GalleryResponse {
  images: GalleryImage[];
}

export interface ErrorResponse {
  error: string;
}
