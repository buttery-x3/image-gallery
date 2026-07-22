import type { TileRatio, TileWidth } from "../preferences";

export interface MasonryItem {
  key: string;
  width?: number;
  height?: number;
  chromeHeight?: number;
}

export interface MasonryRect {
  key: string;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MasonryLayout {
  width: number;
  height: number;
  columnWidth: number;
  columns: number;
  rects: MasonryRect[];
  buckets: Map<number, number[]>;
  bucketHeight: number;
}

const widths: Record<Exclude<TileWidth, "adaptive">, number> = {
  compact: 220,
  standard: 300,
  large: 400,
};

const fixedRatios: Record<Exclude<TileRatio, "natural">, number> = {
  square: 1,
  portrait: 2 / 3,
  landscape: 4 / 3,
};

export function itemAspectRatio(item: MasonryItem, ratio: TileRatio): number {
  if (ratio !== "natural") return fixedRatios[ratio];
  if (item.width && item.height && item.width > 0 && item.height > 0) return item.width / item.height;
  return 1;
}

export function calculateMasonryLayout(
  items: readonly MasonryItem[],
  containerWidth: number,
  tileWidth: TileWidth,
  ratio: TileRatio,
  gap = 12,
  bucketHeight = 640,
): MasonryLayout {
  const safeWidth = Math.max(1, containerWidth);
  const mobile = safeWidth < 480;
  const targetWidth = mobile ? safeWidth : tileWidth === "adaptive" ? 300 : widths[tileWidth];
  const columns = mobile ? 1 : Math.max(1, Math.floor((safeWidth + gap) / (targetWidth + gap)));
  const columnWidth = tileWidth === "adaptive" || mobile
    ? (safeWidth - gap * (columns - 1)) / columns
    : Math.min(targetWidth, safeWidth);
  const usedWidth = columnWidth * columns + gap * (columns - 1);
  const offsetX = Math.max(0, (safeWidth - usedWidth) / 2);
  const heights = Array.from({ length: columns }, () => 0);
  const rects: MasonryRect[] = [];
  const buckets = new Map<number, number[]>();

  items.forEach((item, index) => {
    let column = 0;
    for (let candidate = 1; candidate < heights.length; candidate += 1) {
      if (heights[candidate]! < heights[column]!) column = candidate;
    }
    const mediaHeight = columnWidth / itemAspectRatio(item, ratio);
    const height = mediaHeight + (item.chromeHeight ?? 0);
    const rect: MasonryRect = {
      key: item.key,
      index,
      x: offsetX + column * (columnWidth + gap),
      y: heights[column]!,
      width: columnWidth,
      height,
    };
    rects.push(rect);
    heights[column] = rect.y + rect.height + gap;
    const firstBucket = Math.floor(rect.y / bucketHeight);
    const lastBucket = Math.floor((rect.y + rect.height) / bucketHeight);
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const indexes = buckets.get(bucket) ?? [];
      indexes.push(index);
      buckets.set(bucket, indexes);
    }
  });

  return {
    width: safeWidth,
    height: Math.max(0, ...heights) - (items.length > 0 ? gap : 0),
    columnWidth,
    columns,
    rects,
    buckets,
    bucketHeight,
  };
}

export function visibleMasonryIndexes(
  layout: MasonryLayout,
  viewportTop: number,
  viewportHeight: number,
  overscan = 700,
): number[] {
  const top = Math.max(0, viewportTop - overscan);
  const bottom = viewportTop + viewportHeight + overscan;
  const firstBucket = Math.floor(top / layout.bucketHeight);
  const lastBucket = Math.floor(bottom / layout.bucketHeight);
  const candidates = new Set<number>();
  for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
    for (const index of layout.buckets.get(bucket) ?? []) candidates.add(index);
  }
  return [...candidates]
    .filter((index) => {
      const rect = layout.rects[index]!;
      return rect.y + rect.height >= top && rect.y <= bottom;
    })
    .sort((left, right) => left - right);
}
