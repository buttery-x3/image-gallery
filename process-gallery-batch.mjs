import "dotenv/config";
import { lstat, mkdir, readdir, readFile, rename, rmdir } from "node:fs/promises";
import path from "node:path";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const argumentsToParse = process.argv.slice(2);
const dryRun = argumentsToParse.includes("--dry-run");
const positionalArguments = argumentsToParse.filter((argument) => argument !== "--dry-run");
if (positionalArguments.length > 1) {
  console.error("Usage: node process-gallery-batch.mjs [--dry-run] [base-url]");
  process.exit(2);
}

const requestedBaseUrl = positionalArguments[0];
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");

function supportedMetadataRecord(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (parsed.schema === "anime_waifu_lite/v1") return parsed;
  return Object.values(parsed).find(
    (value) => value && typeof value === "object" && !Array.isArray(value) && value.schema === "anime_waifu_lite/v1",
  );
}

function timestampedBatchName(date) {
  const twoDigits = (value) => String(value).padStart(2, "0");
  return [date.getFullYear(), twoDigits(date.getMonth() + 1), twoDigits(date.getDate())].join("-") + "_" +
    [twoDigits(date.getHours()), twoDigits(date.getMinutes()), twoDigits(date.getSeconds())].join("-");
}

async function nextBatchTarget() {
  const timestamp = timestampedBatchName(new Date());
  let batchName = timestamp;
  let batchDirectory = path.join(galleryRoot, batchName);
  for (let suffix = 2; await lstat(batchDirectory).then(() => true, () => false); suffix += 1) {
    batchName = `${timestamp}-${String(suffix).padStart(2, "0")}`;
    batchDirectory = path.join(galleryRoot, batchName);
  }
  return { batchName, batchDirectory };
}

async function cacheMissingPreviews(batchName) {
  const baseUrl = new URL(
    requestedBaseUrl || `http://127.0.0.1:${process.env.PORT ?? "8080"}/`,
  );
  if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";

  const galleryUrl = new URL("api/images", baseUrl);
  galleryUrl.searchParams.set("includePreviewStatus", "1");
  const galleryResponse = await fetch(galleryUrl, { cache: "no-store" });
  if (!galleryResponse.ok) {
    throw new Error(`Could not load the gallery (${galleryResponse.status} ${galleryResponse.statusText}).`);
  }

  const payload = await galleryResponse.json();
  if (!payload || !Array.isArray(payload.images)) throw new Error("The gallery returned an unexpected response.");

  const previewImages = payload.images.filter(
    (image) => image && typeof image.previewUrl === "string" &&
      typeof image.path === "string" && image.path.startsWith(`${batchName}/`),
  );
  const cachedCount = previewImages.filter((image) => image.previewCached === true).length;
  const previewUrls = previewImages
    .filter((image) => image.previewCached !== true)
    .map((image) => image.previewUrl);

  if (cachedCount > 0) {
    console.log(`${cachedCount} preview${cachedCount === 1 ? " is" : "s are"} already cached.`);
  }
  if (previewUrls.length === 0) {
    console.log(`No PNG or GIF previews need caching in ${batchName}.`);
    return;
  }

  console.log(`Caching ${previewUrls.length} missing preview${previewUrls.length === 1 ? "" : "s"} through ${baseUrl.href}`);
  let nextIndex = 0;
  let completed = 0;
  const failures = [];

  async function cacheNextPreview() {
    while (nextIndex < previewUrls.length) {
      const previewUrl = new URL(previewUrls[nextIndex], baseUrl);
      nextIndex += 1;
      try {
        const response = await fetch(previewUrl, { method: "HEAD", cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      } catch (error) {
        failures.push(`${previewUrl.href}: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        completed += 1;
        process.stdout.write(`\rCached ${completed}/${previewUrls.length}`);
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(4, previewUrls.length) },
    () => cacheNextPreview(),
  ));
  process.stdout.write("\n");
  if (failures.length > 0) throw new Error(failures.join("\n"));
  console.log("All previews are cached.");
}

const rootStats = await lstat(galleryRoot).catch(() => undefined);
if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
  throw new Error("GALLERY_DIR must be an existing, non-symbolic-link directory.");
}

const entries = await readdir(galleryRoot, { withFileTypes: true });
const regularFiles = entries.filter((entry) => !entry.name.startsWith(".") && entry.isFile() && !entry.isSymbolicLink());
const jsonFiles = regularFiles.filter((entry) => path.extname(entry.name).toLowerCase() === ".json");
const imageFiles = regularFiles.filter((entry) => supportedExtensions.has(path.extname(entry.name).toLowerCase()));
const pairs = [];

for (const jsonFile of jsonFiles) {
  const stem = path.basename(jsonFile.name, path.extname(jsonFile.name));
  const matches = imageFiles.filter((imageFile) => path.basename(imageFile.name, path.extname(imageFile.name)) === stem);
  if (matches.length === 0) throw new Error(`${jsonFile.name} does not have a same-name image.`);
  if (matches.length > 1) throw new Error(`${jsonFile.name} matches more than one image.`);

  let parsed;
  try {
    parsed = JSON.parse(await readFile(path.join(galleryRoot, jsonFile.name), "utf8"));
  } catch (error) {
    throw new Error(`${jsonFile.name} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!supportedMetadataRecord(parsed)) {
    throw new Error(`${jsonFile.name} does not contain supported anime_waifu_lite/v1 metadata.`);
  }
  pairs.push({ image: matches[0].name, metadata: jsonFile.name });
}

if (pairs.length === 0) {
  console.log("No root-level image and JSON pairs are ready to process.");
  process.exit(0);
}

const { batchName, batchDirectory } = await nextBatchTarget();
console.log(`${dryRun ? "Would move" : "Moving"} ${pairs.length} image/metadata pair${pairs.length === 1 ? "" : "s"} to ${batchName}/`);
for (const pair of pairs) console.log(`- ${pair.image} + ${pair.metadata}`);
if (dryRun) process.exit(0);

await mkdir(batchDirectory);
const movedFiles = [];
try {
  for (const pair of pairs) {
    for (const fileName of [pair.image, pair.metadata]) {
      await rename(path.join(galleryRoot, fileName), path.join(batchDirectory, fileName));
      movedFiles.push(fileName);
    }
  }
} catch (error) {
  for (const fileName of movedFiles.reverse()) {
    await rename(path.join(batchDirectory, fileName), path.join(galleryRoot, fileName)).catch(() => undefined);
  }
  await rmdir(batchDirectory).catch(() => undefined);
  throw error;
}

console.log(`Batch ${batchName}/ is ready.`);
try {
  await cacheMissingPreviews(batchName);
} catch (error) {
  console.error("The batch was organized successfully, but preview caching failed. Re-run cache-previews.sh when the service is available.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
