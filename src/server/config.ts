import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
function readReportingEnabled(): boolean {
  const configPath = path.join(projectRoot, "gallery.config.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return (parsed as Record<string, unknown>).enableReporting === true;
  } catch {
    return false;
  }
}
const reportingEnabled = readReportingEnabled();
const galleryDir = path.resolve(projectRoot, process.env.GALLERY_DIR ?? "gallery");
const previewCacheDir = path.resolve(projectRoot, process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");

const cacheRelativeToGallery = path.relative(galleryDir, previewCacheDir);
if (
  cacheRelativeToGallery === "" ||
  (!cacheRelativeToGallery.startsWith("..") && !path.isAbsolute(cacheRelativeToGallery))
) {
  throw new Error("PREVIEW_CACHE_DIR must be outside GALLERY_DIR.");
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8080", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value ?? ""}`);
  }

  return port;
}

export const config = {
  galleryDir,
  previewCacheDir,
  reportListPath: path.resolve(projectRoot, process.env.REPORT_LIST_PATH ?? "reported-image-paths.txt"),
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  reportingEnabled,
};
