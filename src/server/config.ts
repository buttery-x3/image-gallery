import { readFileSync } from "node:fs";
import path from "node:path";
import type { GalleryCategory } from "../shared/types.js";

const projectRoot = path.resolve(process.cwd());
export type ShortNameRepresentation = "en" | "ja";

export interface MetadataSchemaRuntimeConfig {
  enabled: boolean;
  category?: GalleryCategory;
  nameGeneration?: {
    definition: string;
    pipeline?: "contextual/v1";
    shortNames: ShortNameRepresentation[];
  };
}

function readGalleryRuntimeConfig(): {
  reportingEnabled: boolean;
  metadataSchemas?: Record<string, MetadataSchemaRuntimeConfig>;
} {
  const configPath = path.join(projectRoot, "gallery.config.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { reportingEnabled: false };
    const record = parsed as Record<string, unknown>;
    const metadata = record.metadata;
    let metadataSchemas: Record<string, MetadataSchemaRuntimeConfig> | undefined;
    if (metadata !== undefined) {
      if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("gallery.config.json metadata must be an object.");
      }
      const metadataRecord = metadata as Record<string, unknown>;
      if (metadataRecord.enabledSchemas !== undefined) {
        throw new Error("gallery.config.json metadata.enabledSchemas has been replaced by metadata.schemas.");
      }
      if (metadataRecord.schemas !== undefined) {
        if (!metadataRecord.schemas || typeof metadataRecord.schemas !== "object" || Array.isArray(metadataRecord.schemas)) {
          throw new Error("gallery.config.json metadata.schemas must be an object keyed by source metadata schema.");
        }
        metadataSchemas = {};
        for (const [sourceSchema, value] of Object.entries(metadataRecord.schemas as Record<string, unknown>)) {
          if (!sourceSchema.trim() || !value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error(`gallery.config.json metadata.schemas.${sourceSchema} must be an object.`);
          }
          const schema = value as Record<string, unknown>;
          if (typeof schema.enabled !== "boolean") {
            throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.enabled must be true or false.`);
          }
          if (schema.category !== undefined && !["women", "creatures", "men"].includes(schema.category as string)) {
            throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.category must be women, creatures, or men.`);
          }
          let nameGeneration: MetadataSchemaRuntimeConfig["nameGeneration"];
          if (schema.nameGeneration !== undefined) {
            if (!schema.enabled) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration cannot be configured when enabled is false.`);
            }
            if (!schema.nameGeneration || typeof schema.nameGeneration !== "object" || Array.isArray(schema.nameGeneration)) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration must be an object.`);
            }
            const naming = schema.nameGeneration as Record<string, unknown>;
            if (typeof naming.definition !== "string" || !naming.definition.trim()) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.definition must be a non-empty string.`);
            }
            const shortNames = naming.shortNames ?? [];
            if (naming.pipeline !== undefined && naming.pipeline !== "contextual/v1") {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.pipeline must be contextual/v1.`);
            }
            if (!Array.isArray(shortNames) || shortNames.some((language) => language !== "en" && language !== "ja")) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.shortNames must contain only en and ja.`);
            }
            if (new Set(shortNames).size !== shortNames.length) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.shortNames must not contain duplicates.`);
            }
            nameGeneration = {
              definition: naming.definition.trim(),
              ...(naming.pipeline === "contextual/v1" ? { pipeline: naming.pipeline } : {}),
              shortNames: [...shortNames] as ShortNameRepresentation[],
            };
          }
          metadataSchemas[sourceSchema] = {
            enabled: schema.enabled,
            ...(schema.category ? { category: schema.category as GalleryCategory } : {}),
            ...(nameGeneration ? { nameGeneration } : {}),
          };
        }
      }
    }
    return { reportingEnabled: record.enableReporting === true, ...(metadataSchemas ? { metadataSchemas } : {}) };
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
  metadataSchemas: runtimeConfig.metadataSchemas,
  nameGenerationDefinitionsDir: path.join(projectRoot, "name-generation-schemas"),
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  reportingEnabled: runtimeConfig.reportingEnabled,
};
