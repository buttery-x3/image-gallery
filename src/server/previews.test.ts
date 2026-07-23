import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  imagePosterPath,
  imagePosterProfile,
  imagePreviewPath,
  imagePreviewProfile,
} from "./previews.js";

sharp.cache(false);

test("generates the compact 360px animated preview profile", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "image-gallery-preview-test-"));
  try {
    const sourcePath = path.join(directory, "source.png");
    const cachePath = path.join(directory, "cache");
    await sharp({ create: { width: 1200, height: 800, channels: 4, background: { r: 30, g: 80, b: 140, alpha: 0.75 } } })
      .png()
      .toFile(sourcePath);
    const generatedPath = await imagePreviewPath(sourcePath, "batch/source.png", cachePath);
    const metadata = await sharp(await readFile(generatedPath)).metadata();
    assert.equal(imagePreviewProfile, "v3-360-q55");
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 360);
    assert.equal(metadata.height, 240);
    assert.equal(metadata.hasAlpha, true);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("preserves GIF animation in the optimized WebP preview", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "image-gallery-animated-preview-test-"));
  try {
    const sourcePath = path.join(directory, "source.gif");
    const cachePath = path.join(directory, "cache");
    const frameWidth = 600;
    const frameHeight = 2;
    const framePixels = frameWidth * frameHeight;
    const pixels = Buffer.alloc(framePixels * 2 * 4);
    for (let index = 0; index < framePixels; index += 1) {
      pixels[index * 4] = 255;
      pixels[index * 4 + 3] = 255;
    }
    for (let index = framePixels; index < framePixels * 2; index += 1) {
      pixels[index * 4 + 2] = 255;
      pixels[index * 4 + 3] = 255;
    }
    await sharp(pixels, {
      raw: { width: frameWidth, height: frameHeight * 2, channels: 4, pageHeight: frameHeight },
    })
      .gif({ delay: [100, 150], loop: 0 })
      .toFile(sourcePath);

    const generatedPath = await imagePreviewPath(sourcePath, "batch/source.gif", cachePath);
    const metadata = await sharp(await readFile(generatedPath), { animated: true }).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.pages, 2);
    assert.deepEqual(metadata.delay, [100, 150]);
    assert.equal(metadata.loop, 0);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

test("generates a single-frame first-frame poster", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "image-gallery-poster-test-"));
  try {
    const sourcePath = path.join(directory, "source.gif");
    const cachePath = path.join(directory, "cache");
    const frameWidth = 600;
    const frameHeight = 240;
    const framePixels = frameWidth * frameHeight;
    const pixels = Buffer.alloc(framePixels * 2 * 4);
    for (let index = 0; index < framePixels; index += 1) {
      pixels[index * 4] = 255;
      pixels[index * 4 + 3] = 255;
    }
    for (let index = framePixels; index < framePixels * 2; index += 1) {
      pixels[index * 4 + 2] = 255;
      pixels[index * 4 + 3] = 255;
    }
    await sharp(pixels, {
      raw: { width: frameWidth, height: frameHeight * 2, channels: 4, pageHeight: frameHeight },
    }).gif({ delay: [100, 150], loop: 0 }).toFile(sourcePath);

    const generatedPath = await imagePosterPath(sourcePath, "batch/source.gif", cachePath);
    const metadata = await sharp(await readFile(generatedPath), { animated: true }).metadata();
    assert.equal(imagePosterProfile, "v1-360-q45");
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 360);
    assert.equal(metadata.height, 144);
    assert.equal(metadata.pages, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
