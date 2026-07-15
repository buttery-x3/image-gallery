import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { GalleryImage, ImageKind } from "../shared/types.js";

const supportedExtensions = new Map<string, ImageKind>([
  [".jpg", "jpeg"],
  [".jpeg", "jpeg"],
  [".png", "png"],
  [".gif", "gif"],
  [".webp", "webp"],
  [".avif", "avif"],
]);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export class GalleryDirectoryError extends Error {}

export function imageKindFor(filePath: string): ImageKind | undefined {
  return supportedExtensions.get(path.extname(filePath).toLowerCase());
}

function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

export async function readGalleryImages(root: string): Promise<GalleryImage[]> {
  let rootStats;
  try {
    rootStats = await lstat(root);
  } catch {
    throw new GalleryDirectoryError("The gallery directory does not exist or cannot be read.");
  }

  if (!rootStats.isDirectory()) {
    throw new GalleryDirectoryError("The configured gallery path is not a directory.");
  }

  const images: GalleryImage[] = [];

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;

      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const type = imageKindFor(entry.name);
      if (!type) continue;

      const stats = await lstat(absolutePath);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      images.push({
        name: entry.name,
        path: relativePath,
        url: `media/${toUrlPath(relativePath)}`,
        ...(type === "gif" ? {
          previewUrl: `previews/${toUrlPath(relativePath)}?v=${Math.trunc(stats.mtimeMs)}-${stats.size}`,
        } : {}),
        modifiedAt: stats.mtime.toISOString(),
        type,
      });
    }
  }

  try {
    await walk(root);
  } catch {
    throw new GalleryDirectoryError("The gallery directory could not be scanned.");
  }

  return images.sort((left, right) => collator.compare(left.path, right.path));
}

export async function resolveSafeMediaPath(root: string, requestedPath: string): Promise<string | undefined> {
  if (
    requestedPath.length === 0 || requestedPath.includes("\0") || requestedPath.includes("\\") ||
    path.posix.isAbsolute(requestedPath) || !imageKindFor(requestedPath)
  ) return undefined;

  const segments = requestedPath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    return undefined;
  }

  let currentPath = path.resolve(root);
  for (const segment of segments) {
    currentPath = path.join(currentPath, segment);
    try {
      const stats = await lstat(currentPath);
      if (stats.isSymbolicLink()) return undefined;
    } catch {
      return undefined;
    }
  }

  const relative = path.relative(path.resolve(root), currentPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;

  const stats = await lstat(currentPath);
  return stats.isFile() ? currentPath : undefined;
}
