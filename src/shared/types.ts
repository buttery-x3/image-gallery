export const imageKinds = ["jpeg", "png", "gif", "webp", "avif"] as const;

export type ImageKind = (typeof imageKinds)[number];

export const galleryCategories = ["women", "creatures", "men"] as const;

export type GalleryCategory = (typeof galleryCategories)[number];

export interface GalleryMetadata {
  schema: string;
  category?: GalleryCategory;
  resolvedPrompt: string;
  tags: Record<string, string>;
  searchTokens: Record<string, string[]>;
  facets: Record<string, string[]>;
}

export interface GalleryShortName {
  en?: string;
  ja?: string;
}

export interface GalleryMetadataDisplay {
  name: string;
  subtitle?: string;
  subtitleUrl?: string;
}

export interface GalleryImage {
  name: string;
  displayName: string;
  path: string;
  url: string;
  previewUrl?: string;
  previewCached?: boolean;
  modifiedAt: string;
  width?: number;
  height?: number;
  type: ImageKind;
  batch?: string;
  category?: GalleryCategory;
  metadataPresent?: boolean;
  metadataInvalid?: boolean;
  metadataSchema?: string;
  metadataSupported?: boolean;
  metadataEnabled?: boolean;
  metadata?: GalleryMetadata;
  metadataDisplay?: GalleryMetadataDisplay;
  shortName?: GalleryShortName;
}

export interface GalleryResponse {
  images: GalleryImage[];
}

export interface GalleryIndexItem {
  path: string;
  searchText: string;
  tags: Record<string, string>;
  facets?: Record<string, string[]>;
  metadataDisplay?: GalleryMetadataDisplay;
  shortName?: GalleryShortName;
}

export interface GalleryIndexResponse {
  images: GalleryIndexItem[];
}

export interface ImageDetailsResponse {
  category?: GalleryCategory;
  metadataPresent?: boolean;
  metadataInvalid?: boolean;
  metadataSchema?: string;
  metadataSupported?: boolean;
  metadataEnabled?: boolean;
  metadata?: GalleryMetadata;
  metadataDisplay?: GalleryMetadataDisplay;
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
