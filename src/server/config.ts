import { readFileSync } from "node:fs";
import path from "node:path";
import type { GalleryCategory } from "../shared/types.js";

const projectRoot = path.resolve(process.cwd());
export type ShortNameRepresentation = "en" | "ja";

export interface MetadataSchemaRuntimeConfig {
  enabled: boolean;
  category?: GalleryCategory;
  typeLabel?: string;
  filename?: {
    tag: string;
    collisionTag?: string;
  };
  display?: {
    nameTag: string;
    subtitleTag?: string;
    subtitleUrlTag?: string;
  };
  nameGeneration?: {
    definition: string;
    pipeline?: "contextual/v1";
    shortNames: ShortNameRepresentation[];
  };
}

function readGalleryRuntimeConfig(): {
  reportingEnabled: boolean;
  supportEmbedEnabled: boolean;
  metadataSchemas?: Record<string, MetadataSchemaRuntimeConfig>;
} {
  const configPath = path.join(projectRoot, "gallery.config.json");
  try {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { reportingEnabled: false, supportEmbedEnabled: false };
    }
    const record = parsed as Record<string, unknown>;
    if (record.enableSupportEmbed !== undefined && typeof record.enableSupportEmbed !== "boolean") {
      throw new Error("gallery.config.json enableSupportEmbed must be true or false when configured.");
    }
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
          if (schema.typeLabel !== undefined && (typeof schema.typeLabel !== "string" || !schema.typeLabel.trim())) {
            throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.typeLabel must be a non-empty string.`);
          }
          let nameGeneration: MetadataSchemaRuntimeConfig["nameGeneration"];
          let filename: MetadataSchemaRuntimeConfig["filename"];
          if (schema.filename !== undefined) {
            if (!schema.enabled) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.filename cannot be configured when enabled is false.`);
            }
            if (!schema.filename || typeof schema.filename !== "object" || Array.isArray(schema.filename)) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.filename must be an object.`);
            }
            const filenameRecord = schema.filename as Record<string, unknown>;
            for (const key of ["tag", "collisionTag"] as const) {
              const value = filenameRecord[key];
              if (key === "tag" && value === undefined) {
                throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.filename.tag must be configured.`);
              }
              if (value !== undefined && (typeof value !== "string" || !/^[a-z][a-z0-9_]*$/.test(value))) {
                throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.filename.${key} must be a canonical tag name.`);
              }
            }
            filename = {
              tag: filenameRecord.tag as string,
              ...(typeof filenameRecord.collisionTag === "string" ? { collisionTag: filenameRecord.collisionTag } : {}),
            };
          }
          let display: MetadataSchemaRuntimeConfig["display"];
          if (schema.display !== undefined) {
            if (!schema.enabled) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.display cannot be configured when enabled is false.`);
            }
            if (!schema.display || typeof schema.display !== "object" || Array.isArray(schema.display)) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.display must be an object.`);
            }
            const displayRecord = schema.display as Record<string, unknown>;
            const configuredTags = ["nameTag", "subtitleTag", "subtitleUrlTag"] as const;
            for (const key of configuredTags) {
              const value = displayRecord[key];
              if (key === "nameTag" && value === undefined) {
                throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.display.nameTag must be configured.`);
              }
              if (value !== undefined && (typeof value !== "string" || !/^[a-z][a-z0-9_]*$/.test(value))) {
                throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.display.${key} must be a canonical tag name.`);
              }
            }
            display = {
              nameTag: displayRecord.nameTag as string,
              ...(typeof displayRecord.subtitleTag === "string" ? { subtitleTag: displayRecord.subtitleTag } : {}),
              ...(typeof displayRecord.subtitleUrlTag === "string" ? { subtitleUrlTag: displayRecord.subtitleUrlTag } : {}),
            };
          }
          if (schema.nameGeneration !== undefined) {
            if (filename) {
              throw new Error(`gallery.config.json metadata.schemas.${sourceSchema} cannot configure both filename and nameGeneration.`);
            }
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
            ...(typeof schema.typeLabel === "string" ? { typeLabel: schema.typeLabel.trim() } : {}),
            ...(filename ? { filename } : {}),
            ...(display ? { display } : {}),
            ...(nameGeneration ? { nameGeneration } : {}),
          };
        }
      }
    }
    return {
      reportingEnabled: record.enableReporting === true,
      supportEmbedEnabled: record.enableSupportEmbed === true,
      ...(metadataSchemas ? { metadataSchemas } : {}),
    };
  } catch (error) {
    throw new Error(`Could not read gallery runtime configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const runtimeConfig = readGalleryRuntimeConfig();
const galleryDir = path.resolve(projectRoot, process.env.GALLERY_DIR ?? "gallery");
const previewCacheDir = path.resolve(projectRoot, process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");
const dimensionCachePath = path.resolve(projectRoot, process.env.DIMENSION_CACHE_PATH ?? ".cache/catalog-dimensions.json");

const cacheRelativeToGallery = path.relative(galleryDir, previewCacheDir);
if (
  cacheRelativeToGallery === "" ||
  (!cacheRelativeToGallery.startsWith("..") && !path.isAbsolute(cacheRelativeToGallery))
) {
  throw new Error("PREVIEW_CACHE_DIR must be outside GALLERY_DIR.");
}

const dimensionsRelativeToGallery = path.relative(galleryDir, dimensionCachePath);
if (
  dimensionsRelativeToGallery === "" ||
  (!dimensionsRelativeToGallery.startsWith("..") && !path.isAbsolute(dimensionsRelativeToGallery))
) {
  throw new Error("DIMENSION_CACHE_PATH must be outside GALLERY_DIR.");
}

function parsePort(value: string | undefined): number {
  const port = Number.parseInt(value ?? "8080", 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid PORT value: ${value ?? ""}`);
  }

  return port;
}

function optionalBoolean(value: string | undefined, name: string): boolean | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false when configured.`);
}

function supportScriptOrigins(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  return [...new Set(value.split(/[\s,]+/).filter(Boolean).map((entry) => {
    const url = new URL(entry);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new Error("SUPPORT_SCRIPT_ORIGINS must contain only http or https origins without credentials.");
    }
    return url.origin;
  }))];
}

const supportEmbedEnabled = optionalBoolean(process.env.ENABLE_SUPPORT_EMBED, "ENABLE_SUPPORT_EMBED")
  ?? runtimeConfig.supportEmbedEnabled;
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH?.trim();
if (adminPasswordHash && !adminPasswordHash.startsWith("$argon2id$")) {
  throw new Error("ADMIN_PASSWORD_HASH must be an Argon2id encoded hash.");
}

export const config = {
  galleryDir,
  previewCacheDir,
  dimensionCachePath,
  reportListPath: path.resolve(projectRoot, process.env.REPORT_LIST_PATH ?? "reported-image-paths.txt"),
  metadataDefinitionsDir: path.join(projectRoot, "metadata-schemas"),
  metadataSchemas: runtimeConfig.metadataSchemas,
  nameGenerationDefinitionsDir: path.join(projectRoot, "name-generation-schemas"),
  publicDir: path.resolve(projectRoot, "dist/public"),
  host: process.env.HOST ?? "127.0.0.1",
  port: parsePort(process.env.PORT),
  reportingEnabled: runtimeConfig.reportingEnabled,
  supportEmbedEnabled,
  supportScriptOrigins: supportEmbedEnabled ? supportScriptOrigins(process.env.SUPPORT_SCRIPT_ORIGINS) : [],
  adminPasswordHash,
};
