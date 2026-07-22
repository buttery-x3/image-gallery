import { describe, expect, it } from "vitest";
import { injectSpaBase, relativeSpaBaseHref } from "../../../server/spa-base";

describe("SPA fallback base", () => {
  it.each([
    ["/", "./"],
    ["/waifus", "../"],
    ["/waifus/", "../"],
    ["/husbandais/", "../"],
    ["/beastais/slideshow/", "../../"],
  ])("maps %s to %s", (requestPath, expected) => {
    expect(relativeSpaBaseHref(requestPath)).toBe(expected);
  });

  it("injects the base before relative build assets are resolved", () => {
    expect(injectSpaBase("<html><head><script src=\"./assets/app.js\"></script></head></html>", "/waifus/"))
      .toContain('<head>\n    <base href="../" />');
  });
});
