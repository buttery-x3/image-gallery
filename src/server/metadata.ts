import { readFile } from "node:fs/promises";
import type { GalleryMetadata, GalleryShortName } from "../shared/types.js";

const supportedSchema = "anime_waifu_lite/v1";
const supportedNameSchema = "image-gallery/name/v1";

const tagFields = [
  "body_type",
  "breast_type",
  "hair_style",
  "hair_color_primary",
  "hair_color_secondary",
  "hair_accent",
  "eye_shape",
  "eye_color_primary",
  "eye_color_secondary",
  "eye_accent",
  "outfit",
  "outfit_color",
  "trim",
  "trim_color",
  "jewellery",
  "jewellery_color",
  "pose",
  "facing_direction",
  "scene",
  "scene_detail",
  "lighting",
  "secondary_lighting",
  "finish_style",
] as const;

const activeFlagForField: Partial<Record<(typeof tagFields)[number], string>> = {
  hair_accent: "hair_accent_active",
  eye_accent: "eye_accent_active",
  trim: "trim_active",
  trim_color: "trim_active",
  jewellery: "jewellery_active",
  jewellery_color: "jewellery_active",
  scene_detail: "scene_detail_active",
  secondary_lighting: "secondary_lighting_active",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function supportedRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schema === supportedSchema) return value;

  const matches = Object.values(value).filter(
    (candidate): candidate is Record<string, unknown> => isRecord(candidate) && candidate.schema === supportedSchema,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export async function readImageMetadata(filePath: string): Promise<GalleryMetadata | undefined> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  const record = supportedRecord(parsed);
  if (!record) return undefined;

  const activeFlags = isRecord(record.active_flags) ? record.active_flags : {};
  const tags: Record<string, string> = {};
  for (const field of tagFields) {
    const activeFlag = activeFlagForField[field];
    if (activeFlag && activeFlags[activeFlag] === false) continue;

    const value = record[field];
    if (typeof value === "string" && value.trim()) tags[field] = value.trim();
  }

  const searchTokens: Record<string, string[]> = {};
  if (isRecord(record.search_tokens)) {
    for (const [field, values] of Object.entries(record.search_tokens)) {
      if (!Array.isArray(values)) continue;
      const tokens = values.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
      if (tokens.length > 0) searchTokens[field] = tokens.map((value) => value.trim());
    }
  }

  return {
    schema: supportedSchema,
    resolvedPrompt: typeof record.resolved_prompt === "string" ? record.resolved_prompt.trim() : "",
    tags,
    searchTokens,
  };
}

export async function readImageNameMetadata(filePath: string): Promise<GalleryShortName | undefined> {
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  if (!isRecord(parsed) || parsed.schema !== supportedNameSchema || !isRecord(parsed.shortName)) return undefined;

  const en = typeof parsed.shortName.en === "string" ? parsed.shortName.en.trim() : "";
  const ja = typeof parsed.shortName.ja === "string" ? parsed.shortName.ja.trim() : "";
  return en && ja ? { en, ja } : undefined;
}
