import { describe, expect, it } from "vitest";
import { defaultAppearancePreferences, parseAppearancePreferences } from "./preferences";

describe("appearance preferences", () => {
  it("uses the compact portrait gallery defaults", () => {
    expect(parseAppearancePreferences(null)).toEqual({
      version: 1,
      tileWidth: "compact",
      tileRatio: "portrait",
      tileFit: "cover",
      tileZoom: "moderate",
      tileActions: "minimal",
      stickyHeader: false,
    });
  });

  it("accepts a complete v1 value", () => {
    const parsed = parseAppearancePreferences(JSON.stringify({
      version: 1, tileWidth: "large", tileRatio: "portrait", tileFit: "contain",
      tileZoom: "subtle", tileActions: "always",
    }));
    expect(parsed.tileWidth).toBe("large");
    expect(parsed.stickyHeader).toBe(false);
  });

  it("loads the opt-in sticky header preference", () => {
    const parsed = parseAppearancePreferences(JSON.stringify({
      version: 1, tileWidth: "standard", tileRatio: "natural", tileFit: "cover",
      tileZoom: "off", tileActions: "hover", stickyHeader: true,
    }));
    expect(parsed.stickyHeader).toBe(true);
  });

  it("falls back atomically for invalid state", () => {
    expect(parseAppearancePreferences('{"version":1,"tileWidth":"huge"}')).toEqual(defaultAppearancePreferences);
  });
});
