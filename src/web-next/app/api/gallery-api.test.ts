import { describe, expect, it } from "vitest";
import { applicationBaseFor, galleryPageUrlFor } from "./gallery-api";

describe("application URL base", () => {
  const routeSlugs = ["waifus", "beastais", "husbandais"];

  it.each([
    ["https://example.test/", "https://example.test/"],
    ["https://example.test/image-gallery/", "https://example.test/image-gallery/"],
    ["https://example.test/image-gallery/slideshow/", "https://example.test/image-gallery/"],
    ["https://example.test/image-gallery/waifus/", "https://example.test/image-gallery/"],
    ["https://example.test/image-gallery/waifus/slideshow/", "https://example.test/image-gallery/"],
  ])("derives the stable app base from %s", (input, expected) => {
    expect(applicationBaseFor(input, routeSlugs).href).toBe(expected);
  });
});

describe("gallery page URL", () => {
  it.each([
    ["https://example.test/slideshow/?q=1#image", "https://example.test/"],
    ["https://example.test/waifus/slideshow/", "https://example.test/waifus/"],
    ["https://example.test/image-gallery/beastais/slideshow/", "https://example.test/image-gallery/beastais/"],
    ["https://example.test/image-gallery/", "https://example.test/image-gallery/"],
  ])("maps %s to %s", (input, expected) => {
    expect(galleryPageUrlFor(input).href).toBe(expected);
  });
});
