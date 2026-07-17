import "dotenv/config";
import { createHash } from "node:crypto";
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const previewExtensions = new Set([".png", ".gif"]);
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");
const previewCacheRoot = path.resolve(process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");

function fail(message) {
  throw new Error(message);
}

function relativeGalleryPath(absolutePath) {
  return path.relative(galleryRoot, absolutePath).split(path.sep).join("/");
}

function previewCacheKey(identifier, size, modifiedAt) {
  return createHash("sha256")
    .update(identifier)
    .update("\0")
    .update(String(size))
    .update("\0")
    .update(String(modifiedAt))
    .digest("hex");
}

function previewCachePath(identifier, size, modifiedAt) {
  const key = previewCacheKey(identifier, size, modifiedAt);
  return path.join(previewCacheRoot, key.slice(0, 2), `${key}.webp`);
}

function parseMediaPath(value) {
  let mediaUrl;
  try {
    mediaUrl = new URL(value);
  } catch {
    fail("Expected an absolute direct media URL.");
  }

  if (mediaUrl.protocol !== "https:" && mediaUrl.protocol !== "http:") {
    fail("The media URL must use HTTP or HTTPS.");
  }

  const encodedSegments = mediaUrl.pathname.split("/");
  const mediaIndex = encodedSegments.indexOf("media");
  if (mediaIndex < 0 || mediaIndex === encodedSegments.length - 1) {
    fail("The URL does not contain a /media/<path> route.");
  }

  const encodedMediaSegments = encodedSegments.slice(mediaIndex + 1);
  if (encodedMediaSegments.some((segment) => segment.length === 0)) {
    fail("The media URL contains an empty path segment.");
  }

  const mediaSegments = encodedMediaSegments.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      fail("The media URL contains invalid percent encoding.");
    }
  });

  if (mediaSegments.some((segment) =>
    !segment || segment === "." || segment === ".." || segment.startsWith(".") ||
    segment.includes("/") || segment.includes("\\") || segment.includes("\0")
  )) {
    fail("The media URL contains an unsafe path segment.");
  }

  const extension = path.extname(mediaSegments.at(-1)).toLowerCase();
  if (!supportedExtensions.has(extension)) {
    fail("The URL does not point to a supported gallery image.");
  }

  return { mediaSegments, extension };
}

async function resolveExistingImage(mediaSegments) {
  let currentPath = galleryRoot;

  for (const [index, segment] of mediaSegments.entries()) {
    currentPath = path.join(currentPath, segment);
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT") fail(`Gallery image does not exist: ${mediaSegments.join("/")}`);
      throw error;
    }

    if (stats.isSymbolicLink()) fail(`Refusing to remove a symbolic link: ${relativeGalleryPath(currentPath)}`);
    const isLast = index === mediaSegments.length - 1;
    if (!isLast && !stats.isDirectory()) fail(`Gallery path is not a directory: ${relativeGalleryPath(currentPath)}`);
    if (isLast && !stats.isFile()) fail(`Gallery path is not a file: ${relativeGalleryPath(currentPath)}`);
  }

  const relative = path.relative(galleryRoot, currentPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    fail("Refusing to remove a path outside the gallery.");
  }

  return currentPath;
}

async function removeIfPresent(filePath, removedPaths) {
  try {
    await rm(filePath);
    removedPaths.push(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function pruneEmptyGalleryDirectories(startDirectory) {
  let directory = startDirectory;
  while (directory !== galleryRoot) {
    if ((await readdir(directory)).length > 0) return;
    await rmdir(directory);
    directory = path.dirname(directory);
  }
}

async function main() {
  if (process.argv.length !== 3) {
    console.error("Usage: bash ./remove-image.sh <direct-media-url>");
    process.exitCode = 2;
    return;
  }

  const { mediaSegments, extension } = parseMediaPath(process.argv[2]);
  const imagePath = await resolveExistingImage(mediaSegments);
  const imageStats = await lstat(imagePath);
  const relativePath = mediaSegments.join("/");
  const imageStem = imagePath.slice(0, -extension.length);
  const removedPaths = [];

  const previewPaths = new Set();
  if (previewExtensions.has(extension)) {
    previewPaths.add(previewCachePath(path.posix.basename(relativePath), imageStats.size, imageStats.mtimeMs));
    previewPaths.add(previewCachePath(relativePath, imageStats.size, imageStats.mtimeMs));
  }

  // Remove the source first so it becomes unavailable even if later cleanup fails.
  await rm(imagePath);
  removedPaths.push(imagePath);
  await removeIfPresent(`${imageStem}.json`, removedPaths);
  await removeIfPresent(`${imageStem}.gallery-name.json`, removedPaths);
  for (const previewPath of previewPaths) await removeIfPresent(previewPath, removedPaths);

  await pruneEmptyGalleryDirectories(path.dirname(imagePath));

  console.log(`Permanently removed ${relativePath}`);
  for (const removedPath of removedPaths) console.log(`  ${removedPath}`);
}

main().catch((error) => {
  console.error(`Removal failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
