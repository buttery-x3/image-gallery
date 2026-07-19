import "dotenv/config";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, rm, rmdir } from "node:fs/promises";
import path from "node:path";

const extensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const previewExtensions = new Set([".png", ".gif"]);
const tagFields = [
  "body_type", "breast_type", "hair_style", "hair_color_primary", "hair_color_secondary",
  "hair_accent", "eye_shape", "eye_color_primary", "eye_color_secondary", "eye_accent",
  "outfit", "outfit_color", "trim", "trim_color", "jewellery", "jewellery_color",
  "pose", "facing_direction", "scene", "scene_detail", "lighting", "secondary_lighting",
  "finish_style",
];
const activeFlags = {
  hair_accent: "hair_accent_active", eye_accent: "eye_accent_active", trim: "trim_active",
  trim_color: "trim_active", jewellery: "jewellery_active", jewellery_color: "jewellery_active",
  scene_detail: "scene_detail_active", secondary_lighting: "secondary_lighting_active",
};
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");
const previewRoot = path.resolve(process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");
const apply = process.argv.slice(2).includes("--apply");
const unknown = process.argv.slice(2).filter((arg) => !["--apply", "--dry-run"].includes(arg));
if (unknown.length) {
  console.error("Usage: npm run clear-untagged -- [--dry-run|--apply]");
  process.exit(2);
}

function isRecord(value) { return value && typeof value === "object" && !Array.isArray(value); }
function tagsFrom(value) {
  if (!isRecord(value)) return undefined;
  const record = value.schema === "anime_waifu_lite/v1"
    ? value
    : Object.values(value).find((candidate) => isRecord(candidate) && candidate.schema === "anime_waifu_lite/v1");
  if (!record) return undefined;
  const flags = isRecord(record.active_flags) ? record.active_flags : {};
  const tags = {};
  for (const field of tagFields) {
    const flag = activeFlags[field];
    if (flag && flags[flag] === false) continue;
    if (typeof record[field] === "string" && record[field].trim()) tags[field] = record[field].trim();
  }
  return tags;
}
async function walk(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) result.push(...await walk(full));
    else if (stat.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) result.push(full);
  }
  return result;
}
function cachePath(identifier, size, modifiedAt) {
  const key = createHash("sha256").update(identifier).update("\0").update(String(size)).update("\0").update(String(modifiedAt)).digest("hex");
  return path.join(previewRoot, key.slice(0, 2), key + ".webp");
}
async function main() {
  let images;
  try { images = await walk(galleryRoot); } catch (error) {
    if (error?.code === "ENOENT") { console.log("Gallery directory does not exist; nothing to clear."); return; }
    throw error;
  }
  const candidates = [];
  for (const imagePath of images) {
    const stem = imagePath.slice(0, -path.extname(imagePath).length);
    let reason = "no active metadata tags";
    try {
      const parsed = JSON.parse(await readFile(stem + ".json", "utf8"));
      const tags = tagsFrom(parsed);
      if (tags === undefined) reason = "missing supported metadata schema";
      else if (Object.keys(tags).length > 0) continue;
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      reason = error?.code === "ENOENT" ? "missing metadata file" : "invalid metadata JSON";
    }
    candidates.push({ imagePath, stem, reason });
  }
  console.log(`${apply ? "Applying" : "Dry run"}: ${candidates.length} image(s) without Advanced-filter metadata tags.`);
  for (const candidate of candidates) {
    const relative = path.relative(galleryRoot, candidate.imagePath);
    console.log(`  ${candidate.reason}: ${relative}`);
  }
  if (!apply) { console.log("No files changed. Pass --apply to permanently remove these images."); return; }
  for (const candidate of candidates) {
    const stat = await lstat(candidate.imagePath);
    const relative = path.relative(galleryRoot, candidate.imagePath).split(path.sep).join("/");
    await rm(candidate.imagePath);
    for (const suffix of [".json", ".gallery-name.json"]) {
      try { await rm(candidate.stem + suffix); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    if (previewExtensions.has(path.extname(candidate.imagePath).toLowerCase())) {
      const ids = new Set([relative, path.posix.basename(relative)]);
      for (const id of ids) {
        try { await rm(cachePath(id, stat.size, stat.mtimeMs)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    }
    let dir = path.dirname(candidate.imagePath);
    while (dir !== galleryRoot) {
      if ((await readdir(dir)).length) break;
      await rmdir(dir); dir = path.dirname(dir);
    }
  }
  console.log(`Removed ${candidates.length} image(s).`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
