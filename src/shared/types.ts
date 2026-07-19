export const imageKinds = ["jpeg", "png", "gif", "webp", "avif"] as const;

export type ImageKind = (typeof imageKinds)[number];

export interface GalleryMetadata {
  schema: string;
  resolvedPrompt: string;
  tags: Record<string, string>;
  searchTokens: Record<string, string[]>;
}

export interface GalleryShortName {
  en: string;
  ja: string;
}

export interface GalleryImage {
  name: string;
  displayName: string;
  path: string;
  url: string;
  previewUrl?: string;
  previewCached?: boolean;
  modifiedAt: string;
  type: ImageKind;
  batch?: string;
  metadata?: GalleryMetadata;
  shortName?: GalleryShortName;
}

export interface GalleryResponse {
  images: GalleryImage[];
}

export interface ImageDetailsResponse {
  metadata?: GalleryMetadata;
  shortName?: GalleryShortName;
}

export interface ImageReportRequest {
  imagePath: string;
}

export interface ImageReportResponse {
  message: string;
}

export interface ErrorResponse {
  error: string;
}
