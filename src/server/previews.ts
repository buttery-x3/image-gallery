import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

export const imagePreviewProfile = "v3-360-q55";
export const imagePosterProfile = "v1-360-q45";
const previewWidth = 360;
const maximumConcurrentPreviewGenerations = 2;
const pendingPreviews = new Map<string, Promise<string>>();
const previewGenerationWaiters: Array<() => void> = [];
let activePreviewGenerations = 0;

async function withPreviewGenerationSlot<T>(operation: () => Promise<T>): Promise<T> {
  if (activePreviewGenerations >= maximumConcurrentPreviewGenerations) {
    await new Promise<void>((resolve) => previewGenerationWaiters.push(resolve));
  }
  activePreviewGenerations += 1;
  try {
    return await operation();
  } finally {
    activePreviewGenerations -= 1;
    previewGenerationWaiters.shift()?.();
  }
}

function cacheKey(profile: string, identifier: string, size: number, modifiedAt: number): string {
  return createHash("sha256")
    .update(profile)
    .update("\0")
    .update(identifier)
    .update("\0")
    .update(String(size))
    .update("\0")
    .update(String(modifiedAt))
    .digest("hex");
}

export function imagePreviewCachePath(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): string {
  const key = cacheKey(imagePreviewProfile, path.posix.basename(relativePath), size, modifiedAt);
  return path.join(cacheDirectory, key.slice(0, 2), `${key}.webp`);
}

export function imagePosterCachePath(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): string {
  const key = cacheKey(imagePosterProfile, path.posix.basename(relativePath), size, modifiedAt);
  return path.join(cacheDirectory, key.slice(0, 2), `${key}.webp`);
}

function legacyCachePath(
  profile: string,
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): string {
  const key = cacheKey(profile, relativePath, size, modifiedAt);
  return path.join(cacheDirectory, key.slice(0, 2), `${key}.webp`);
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function existingImagePreviewPath(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): Promise<string | undefined> {
  const stablePath = imagePreviewCachePath(relativePath, size, modifiedAt, cacheDirectory);
  if (await exists(stablePath)) return stablePath;

  const legacyPath = legacyCachePath(imagePreviewProfile, relativePath, size, modifiedAt, cacheDirectory);
  if (legacyPath !== stablePath && await exists(legacyPath)) return legacyPath;
  return undefined;
}

async function existingImagePosterPath(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): Promise<string | undefined> {
  const stablePath = imagePosterCachePath(relativePath, size, modifiedAt, cacheDirectory);
  if (await exists(stablePath)) return stablePath;
  const legacyPath = legacyCachePath(imagePosterProfile, relativePath, size, modifiedAt, cacheDirectory);
  if (legacyPath !== stablePath && await exists(legacyPath)) return legacyPath;
  return undefined;
}

export async function imagePreviewIsCached(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): Promise<boolean> {
  return (await existingImagePreviewPath(relativePath, size, modifiedAt, cacheDirectory)) !== undefined;
}

export async function imagePosterIsCached(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): Promise<boolean> {
  return (await existingImagePosterPath(relativePath, size, modifiedAt, cacheDirectory)) !== undefined;
}

async function generatePreview(sourcePath: string, outputPath: string, animated: boolean): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (await exists(outputPath)) return outputPath;

  const temporaryPath = `${outputPath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    const pipeline = sharp(sourcePath, animated ? { animated: true } : { page: 0 })
      .resize({ width: previewWidth, withoutEnlargement: true });
    await (animated
      ? pipeline.webp({ quality: 55, alphaQuality: 65, smartSubsample: true, effort: 2 })
      : pipeline.webp({ quality: 45, alphaQuality: 55, smartSubsample: true, effort: 3 }))
      .toFile(temporaryPath);
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function imagePreviewPath(
  sourcePath: string,
  relativePath: string,
  cacheDirectory: string,
): Promise<string> {
  const sourceStats = await stat(sourcePath);
  const cachedPath = await existingImagePreviewPath(
    relativePath,
    sourceStats.size,
    sourceStats.mtimeMs,
    cacheDirectory,
  );
  if (cachedPath) return cachedPath;

  const outputPath = imagePreviewCachePath(relativePath, sourceStats.size, sourceStats.mtimeMs, cacheDirectory);

  const existing = pendingPreviews.get(outputPath);
  if (existing) return existing;

  const pending = withPreviewGenerationSlot(() => generatePreview(sourcePath, outputPath, true));
  pendingPreviews.set(outputPath, pending);
  try {
    return await pending;
  } finally {
    pendingPreviews.delete(outputPath);
  }
}

export async function imagePosterPath(
  sourcePath: string,
  relativePath: string,
  cacheDirectory: string,
): Promise<string> {
  const sourceStats = await stat(sourcePath);
  const cachedPath = await existingImagePosterPath(
    relativePath,
    sourceStats.size,
    sourceStats.mtimeMs,
    cacheDirectory,
  );
  if (cachedPath) return cachedPath;

  const outputPath = imagePosterCachePath(relativePath, sourceStats.size, sourceStats.mtimeMs, cacheDirectory);
  const existing = pendingPreviews.get(outputPath);
  if (existing) return existing;

  const pending = withPreviewGenerationSlot(() => generatePreview(sourcePath, outputPath, false));
  pendingPreviews.set(outputPath, pending);
  try {
    return await pending;
  } finally {
    pendingPreviews.delete(outputPath);
  }
}
