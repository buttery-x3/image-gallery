import { defaultAppearancePreferences, parseAppearancePreferences, type GalleryAppearancePreferencesV1 } from "./preferences";

export const appearanceStorageKey = "image-gallery:appearance:v1";

export function loadAppearance(storage: Pick<Storage, "getItem"> = window.localStorage): GalleryAppearancePreferencesV1 {
  return parseAppearancePreferences(storage.getItem(appearanceStorageKey));
}

export function saveAppearance(
  value: GalleryAppearancePreferencesV1,
  storage: Pick<Storage, "setItem"> = window.localStorage,
): void {
  storage.setItem(appearanceStorageKey, JSON.stringify(value));
}

export function resetAppearance(storage: Pick<Storage, "removeItem"> = window.localStorage): GalleryAppearancePreferencesV1 {
  storage.removeItem(appearanceStorageKey);
  return { ...defaultAppearancePreferences };
}
