import { describe, expect, it } from "vitest";
import { calculateMasonryLayout, visibleMasonryIndexes } from "./masonry-layout";

describe("masonry layout", () => {
  it("preserves 300px standard tiles and natural ratios", () => {
    const layout = calculateMasonryLayout([
      { key: "a", width: 600, height: 900 },
      { key: "b", width: 1200, height: 600 },
    ], 940, "standard", "natural", 12);
    expect(layout.columns).toBe(3);
    expect(layout.columnWidth).toBe(300);
    expect(layout.rects[0]?.height).toBe(450);
    expect(layout.rects[1]?.height).toBe(150);
  });

  it("uses predictable fixed-ratio heights", () => {
    const layout = calculateMasonryLayout([{ key: "a", width: 1, height: 10 }], 600, "adaptive", "square");
    expect(layout.rects[0]?.height).toBe(layout.columnWidth);
  });

  it("returns only viewport-adjacent rectangles", () => {
    const items = Array.from({ length: 30 }, (_, index) => ({ key: String(index), width: 1, height: 1 }));
    const layout = calculateMasonryLayout(items, 300, "standard", "natural", 12, 300);
    const indexes = visibleMasonryIndexes(layout, 0, 300, 0);
    expect(indexes.length).toBeLessThan(items.length);
    expect(indexes).toContain(0);
  });
});
