import type { GalleryImage } from "../../shared/types";

export interface OverlayColors {
  fill: string;
  outline: string;
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

const overlayFallbackColors: readonly OverlayColors[] = [
  { fill: "#ff6b6b", outline: "#172554" },
  { fill: "#facc15", outline: "#3b0764" },
  { fill: "#22d3ee", outline: "#312e81" },
  { fill: "#86efac", outline: "#881337" },
  { fill: "#c4b5fd", outline: "#14532d" },
  { fill: "#fdba74", outline: "#1e3a8a" },
  { fill: "#f9a8d4", outline: "#134e4a" },
  { fill: "#7dd3fc", outline: "#581c87" },
];

let colorContext: CanvasRenderingContext2D | null | undefined;

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

function colorLuminance(color: string): number | undefined {
  if (colorContext === undefined) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    colorContext = canvas.getContext("2d", { willReadFrequently: true });
  }
  if (!colorContext) return undefined;
  colorContext.clearRect(0, 0, 1, 1);
  colorContext.fillStyle = color;
  colorContext.fillRect(0, 0, 1, 1);
  const [red, green, blue, alpha] = colorContext.getImageData(0, 0, 1, 1).data;
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

function fallbackOverlayColors(path: string): OverlayColors {
  let hash = 2166136261;
  for (const character of path) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return overlayFallbackColors[(hash >>> 0) % overlayFallbackColors.length]!;
}

export function overlayColors(image: GalleryImage, indexedTags?: Record<string, string>): OverlayColors {
  const tags = indexedTags ?? image.metadata?.tags;
  const colors: string[] = [];
  for (const field of overlayColorFields) {
    const value = tags?.[field];
    if (!value) continue;
    const color = resolvedCssColor(value);
    if (color && !colors.includes(color)) colors.push(color);
  }
  const fill = colors[0];
  if (fill) {
    const outline = colors.slice(1).find((color) => colorsContrast(fill, color));
    if (outline) return { fill, outline };
  }
  return fallbackOverlayColors(image.path);
}
