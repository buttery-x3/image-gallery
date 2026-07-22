import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const previewWidth = 300;
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

function cacheKey(identifier: string, size: number, modifiedAt: number): string {
  return createHash("sha256")
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
  const key = cacheKey(path.posix.basename(relativePath), size, modifiedAt);
  return path.join(cacheDirectory, key.slice(0, 2), `${key}.webp`);
}

function legacyImagePreviewCachePath(
  relativePath: string,
  size: number,
  modifiedAt: number,
  cacheDirectory: string,
): string {
  const key = cacheKey(relativePath, size, modifiedAt);
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

  const legacyPath = legacyImagePreviewCachePath(relativePath, size, modifiedAt, cacheDirectory);
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

async function generatePreview(sourcePath: string, outputPath: string): Promise<string> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  if (await exists(outputPath)) return outputPath;

  const temporaryPath = `${outputPath}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await sharp(sourcePath, { animated: true })
      .resize({ width: previewWidth })
      .webp({ quality: 78, effort: 4 })
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

  const pending = withPreviewGenerationSlot(() => generatePreview(sourcePath, outputPath));
  pendingPreviews.set(outputPath, pending);
  try {
    return await pending;
  } finally {
    pendingPreviews.delete(outputPath);
  }
}
