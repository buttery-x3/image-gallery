import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { GalleryImage, ImageDetailsResponse, ImageKind } from "../shared/types.js";
import { readImageMetadataResult, readImageNameMetadata } from "./metadata.js";
import { imagePreviewIsCached, imagePreviewProfile } from "./previews.js";
import { ImageDimensionCache } from "./dimensions.js";

const supportedExtensions = new Map<string, ImageKind>([
  [".jpg", "jpeg"],
  [".jpeg", "jpeg"],
  [".png", "png"],
  [".gif", "gif"],
  [".webp", "webp"],
  [".avif", "avif"],
]);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const nameMetadataSuffix = ".gallery-name.json";

export class GalleryDirectoryError extends Error {}

export function imageKindFor(filePath: string): ImageKind | undefined {
  return supportedExtensions.get(path.extname(filePath).toLowerCase());
}

function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

interface GalleryReadOptions {
  includePreviewStatus?: boolean;
  previewCacheDir?: string;
  includeDetails?: boolean;
  dimensionCachePath?: string;
}

export async function readGalleryImages(root: string, options: GalleryReadOptions = {}): Promise<GalleryImage[]> {
  const includeDetails = options.includeDetails !== false;
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
  const dimensionCache = options.dimensionCachePath ? new ImageDimensionCache(options.dimensionCachePath) : undefined;

  async function walk(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    const metadataFiles = new Map(
      entries
        .filter((entry) =>
          !entry.name.startsWith(".") && !entry.isSymbolicLink() && entry.isFile() &&
          path.extname(entry.name).toLowerCase() === ".json" && !entry.name.endsWith(nameMetadataSuffix)
        )
        .map((entry) => [path.basename(entry.name, path.extname(entry.name)), path.join(directory, entry.name)]),
    );
    const nameMetadataFiles = new Map(
      entries
        .filter((entry) =>
          !entry.name.startsWith(".") && !entry.isSymbolicLink() && entry.isFile() &&
          entry.name.endsWith(nameMetadataSuffix)
        )
        .map((entry) => [entry.name.slice(0, -nameMetadataSuffix.length), path.join(directory, entry.name)]),
    );
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
      const dimensions = await dimensionCache?.dimensions(absolutePath, relativePath, stats.size, stats.mtimeMs);
      const relativeDirectory = path.posix.dirname(relativePath);
      const previewUrl = type === "gif" || type === "png"
        ? `previews/${toUrlPath(relativePath)}?v=${Math.trunc(stats.mtimeMs)}-${stats.size}-${imagePreviewProfile}`
        : undefined;
      let metadata;
      let category;
      let metadataPresent;
      let metadataInvalid;
      let metadataSchema;
      let metadataSupported;
      let metadataEnabled;
      let metadataDisplay;
      let shortName;
      const metadataPath = metadataFiles.get(path.basename(entry.name, path.extname(entry.name)));
      if (metadataPath) {
        metadataPresent = true;
        try {
          const result = await readImageMetadataResult(metadataPath);
          category = result.category;
          metadataSchema = result.schema;
          metadataSupported = result.supported;
          metadataEnabled = result.enabled;
          metadataDisplay = result.metadataDisplay;
          if (includeDetails) metadata = result.metadata;
        } catch (error) {
          metadataInvalid = true;
          console.warn(`Ignoring invalid metadata for ${relativePath}:`, error);
        }
      }

      if (includeDetails) {
        const nameMetadataPath = nameMetadataFiles.get(path.basename(entry.name, path.extname(entry.name)));
        if (nameMetadataPath) {
          try {
            shortName = await readImageNameMetadata(nameMetadataPath);
            if (!shortName) console.warn(`Ignoring unsupported generated-name metadata for ${relativePath}.`);
          } catch (error) {
            console.warn(`Ignoring invalid generated-name metadata for ${relativePath}:`, error);
          }
        }
      }

      let previewCached: boolean | undefined;
      if (previewUrl && options.includePreviewStatus && options.previewCacheDir) {
        previewCached = await imagePreviewIsCached(
          relativePath,
          stats.size,
          stats.mtimeMs,
          options.previewCacheDir,
        );
      }

      images.push({
        name: entry.name,
        displayName: path.basename(entry.name, path.extname(entry.name)),
        path: relativePath,
        url: `media/${toUrlPath(relativePath)}`,
        ...(previewUrl ? { previewUrl } : {}),
        ...(previewCached === undefined ? {} : { previewCached }),
        modifiedAt: stats.mtime.toISOString(),
        ...(dimensions ?? {}),
        type,
        ...(relativeDirectory === "." ? {} : { batch: relativeDirectory }),
        ...(category ? { category } : {}),
        ...(metadataPresent ? { metadataPresent } : {}),
        ...(metadataInvalid ? { metadataInvalid } : {}),
        ...(metadataSchema ? { metadataSchema } : {}),
        ...(metadataSupported === undefined ? {} : { metadataSupported }),
        ...(metadataEnabled === undefined ? {} : { metadataEnabled }),
        ...(metadata ? { metadata } : {}),
        ...(metadataDisplay ? { metadataDisplay } : {}),
        ...(shortName ? { shortName } : {}),
      });
    }
  }

  try {
    await walk(root);
    await dimensionCache?.flush();
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

export async function readGalleryImageDetails(root: string, requestedPath: string): Promise<ImageDetailsResponse | undefined> {
  const imagePath = await resolveSafeMediaPath(root, requestedPath);
  if (!imagePath) return undefined;

  const stem = imagePath.slice(0, -path.extname(imagePath).length);
  let metadata;
  let category;
  let metadataPresent;
  let metadataInvalid;
  let metadataSchema;
  let metadataSupported;
  let metadataEnabled;
  let metadataDisplay;
  let shortName;
  try {
    metadataPresent = true;
    const result = await readImageMetadataResult(`${stem}.json`);
    metadata = result.metadata;
    category = result.category;
    metadataSchema = result.schema;
    metadataSupported = result.supported;
    metadataEnabled = result.enabled;
    metadataDisplay = result.metadataDisplay;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      metadataPresent = undefined;
    } else {
      metadataInvalid = true;
      console.warn(`Ignoring invalid metadata for ${requestedPath}:`, error);
    }
  }
  try {
    shortName = await readImageNameMetadata(`${stem}${nameMetadataSuffix}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Ignoring invalid generated-name metadata for ${requestedPath}:`, error);
    }
  }
  return {
    ...(category ? { category } : {}),
    ...(metadataPresent ? { metadataPresent } : {}),
    ...(metadataInvalid ? { metadataInvalid } : {}),
    ...(metadataSchema ? { metadataSchema } : {}),
    ...(metadataSupported === undefined ? {} : { metadataSupported }),
    ...(metadataEnabled === undefined ? {} : { metadataEnabled }),
    ...(metadata ? { metadata } : {}),
    ...(metadataDisplay ? { metadataDisplay } : {}),
    ...(shortName ? { shortName } : {}),
  };
}
