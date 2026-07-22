import { describe, expect, it } from "vitest";
import { applicationBaseFor } from "./gallery-api";

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
