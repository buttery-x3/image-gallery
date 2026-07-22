import { describe, expect, it } from "vitest";
import { defaultAppearancePreferences, parseAppearancePreferences } from "./preferences";

describe("appearance preferences", () => {
  it("accepts a complete v1 value", () => {
    const parsed = parseAppearancePreferences(JSON.stringify({
      version: 1, tileWidth: "large", tileRatio: "portrait", tileFit: "contain",
      tileZoom: "subtle", tileActions: "always",
    }));
    expect(parsed.tileWidth).toBe("large");
  });

  it("falls back atomically for invalid state", () => {
    expect(parseAppearancePreferences('{"version":1,"tileWidth":"huge"}')).toEqual(defaultAppearancePreferences);
  });
});
