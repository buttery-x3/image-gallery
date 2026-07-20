import { readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(process.cwd());
function readGalleryRuntimeConfig(): { reportingEnabled: boolean; enabledMetadataSchemas?: string[] } {
  const configPath = path.join(projectRoot, "gallery.config.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { reportingEnabled: false };
    const record = parsed as Record<string, unknown>;
    const metadata = record.metadata;
    let enabledMetadataSchemas: string[] | undefined;
    if (metadata !== undefined) {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("gallery.config.json metadata must be an object.");
      }
      const enabled = (metadata as Record<string, unknown>).enabledSchemas;
      if (enabled !== undefined) {
        if (!Array.isArray(enabled) || enabled.some((schema) => typeof schema !== "string" || !schema.trim())) {
          throw new Error("gallery.config.json metadata.enabledSchemas must be an array of non-empty strings.");
        }
        enabledMetadataSchemas = enabled.map((schema) => (schema as string).trim());
      }
    }
    return { reportingEnabled: record.enableReporting === true, ...(enabledMetadataSchemas ? { enabledMetadataSchemas } : {}) };
  } catch (error) {
    throw new Error(`Could not read gallery runtime configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const runtimeConfig = readGalleryRuntimeConfig();
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
  metadataDefinitionsDir: path.join(projectRoot, "metadata-schemas"),
  enabledMetadataSchemas: runtimeConfig.enabledMetadataSchemas,
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  reportingEnabled: runtimeConfig.reportingEnabled,
};
