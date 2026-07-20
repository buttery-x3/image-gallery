import { readFile, stat } from "node:fs/promises";
import type { GalleryShortName } from "../shared/types.js";
import { config } from "./config.js";
import {
  loadMetadataDefinitions,
  normalizeParsedMetadata,
  type NormalizedMetadataResult,
} from "./metadata-definitions.js";

const supportedNameSchema = "image-gallery/name/v1";
const registry = loadMetadataDefinitions(config.metadataDefinitionsDir, config.enabledMetadataSchemas);

interface MetadataCacheEntry {
  size: number;
  modifiedAt: number;
  result: NormalizedMetadataResult;
}

const metadataCache = new Map<string, MetadataCacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readImageMetadataResult(filePath: string): Promise<NormalizedMetadataResult> {
  const fileStats = await stat(filePath);
  const cached = metadataCache.get(filePath);
  if (cached && cached.size === fileStats.size && cached.modifiedAt === fileStats.mtimeMs) return cached.result;

  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  const result = normalizeParsedMetadata(parsed, registry);
  metadataCache.set(filePath, { size: fileStats.size, modifiedAt: fileStats.mtimeMs, result });
  return result;
}

export async function readImageNameMetadata(filePath: string): Promise<GalleryShortName | undefined> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed) || parsed.schema !== supportedNameSchema || !isRecord(parsed.shortName)) return undefined;

  const en = typeof parsed.shortName.en === "string" ? parsed.shortName.en.trim() : "";
  const ja = typeof parsed.shortName.ja === "string" ? parsed.shortName.ja.trim() : "";
  return en && ja ? { en, ja } : undefined;
}
