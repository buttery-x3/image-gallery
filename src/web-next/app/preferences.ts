export const tileWidths = ["compact", "standard", "large", "adaptive"] as const;
export const tileRatios = ["natural", "square", "portrait", "landscape"] as const;
export const tileFits = ["cover", "contain"] as const;
export const tileZooms = ["off", "subtle", "moderate"] as const;
export const tileActions = ["hover", "always", "menu", "minimal"] as const;

export type TileWidth = typeof tileWidths[number];
export type TileRatio = typeof tileRatios[number];
export type TileFit = typeof tileFits[number];
export type TileZoom = typeof tileZooms[number];
export type TileActions = typeof tileActions[number];

export interface GalleryAppearancePreferencesV1 {
  version: 1;
  tileWidth: TileWidth;
  tileRatio: TileRatio;
  tileFit: TileFit;
  tileZoom: TileZoom;
  tileActions: TileActions;
  stickyHeader: boolean;
}

export const defaultAppearancePreferences: GalleryAppearancePreferencesV1 = {
  version: 1,
  tileWidth: "standard",
  tileRatio: "natural",
  tileFit: "cover",
  tileZoom: "off",
  tileActions: "hover",
  stickyHeader: false,
};

function isMember<T extends string>(value: unknown, choices: readonly T[]): value is T {
  return typeof value === "string" && choices.includes(value as T);
}

export function parseAppearancePreferences(value: string | null): GalleryAppearancePreferencesV1 {
  if (!value) return { ...defaultAppearancePreferences };
  try {
    const parsed = JSON.parse(value) as Partial<GalleryAppearancePreferencesV1>;
    if (
      parsed.version !== 1 ||
      !isMember(parsed.tileWidth, tileWidths) ||
      !isMember(parsed.tileRatio, tileRatios) ||
      !isMember(parsed.tileFit, tileFits) ||
      !isMember(parsed.tileZoom, tileZooms) ||
      !isMember(parsed.tileActions, tileActions) ||
      (parsed.stickyHeader !== undefined && typeof parsed.stickyHeader !== "boolean")
    ) return { ...defaultAppearancePreferences };
    return { ...(parsed as Omit<GalleryAppearancePreferencesV1, "stickyHeader">), stickyHeader: parsed.stickyHeader ?? false };
  } catch {
    return { ...defaultAppearancePreferences };
  }
}
