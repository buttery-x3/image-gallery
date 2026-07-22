import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { ImageDimensionCache } from "./dimensions.js";

test("caches intrinsic dimensions outside the gallery", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "image-gallery-dimensions-"));
  try {
    const imagePath = path.join(directory, "sample.png");
    const cachePath = path.join(directory, "cache", "dimensions.json");
    await sharp({ create: { width: 24, height: 36, channels: 4, background: "transparent" } }).png().toFile(imagePath);
    const stats = await sharp(imagePath).metadata();
    assert.equal(stats.width, 24);
    const file = await import("node:fs/promises").then(({ stat }) => stat(imagePath));
    const cache = new ImageDimensionCache(cachePath);
    assert.deepEqual(await cache.dimensions(imagePath, "sample.png", file.size, file.mtimeMs), { width: 24, height: 36 });
    await cache.flush();
    const persisted = JSON.parse(await readFile(cachePath, "utf8")) as { version: number; images: Record<string, unknown> };
    assert.equal(persisted.version, 1);
    assert.ok(persisted.images["sample.png"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
