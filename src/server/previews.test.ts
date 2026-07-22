import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import { imagePreviewPath, imagePreviewProfile } from "./previews.js";

test("generates the high-quality 600px preview profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "image-gallery-preview-test-"));
  try {
    const sourcePath = path.join(directory, "source.png");
    const cachePath = path.join(directory, "cache");
    await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 30, g: 80, b: 140, alpha: 0.75 } } })
      .png()
      .toFile(sourcePath);
    const generatedPath = await imagePreviewPath(sourcePath, "batch/source.png", cachePath);
    const metadata = await sharp(await readFile(generatedPath)).metadata();
    assert.equal(imagePreviewProfile, "v2-600-q86");
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 600);
    assert.equal(metadata.height, 400);
    assert.equal(metadata.hasAlpha, true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
