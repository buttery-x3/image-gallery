import "dotenv/config";
import { createHash } from "node:crypto";
import { constants as fileSystemConstants, createReadStream } from "node:fs";
import { access, copyFile, lstat, mkdir, readdir, readFile, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { generateJapaneseFantasyName } from "./gallery-name-generator.mjs";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const namingStyle = process.env.BATCH_NAME_STYLE?.trim() ?? "";
if (namingStyle && namingStyle !== "japanese-fantasy") {
  throw new Error(`Unsupported BATCH_NAME_STYLE: ${namingStyle}`);
}
const namingEnabled = namingStyle === "japanese-fantasy";

const argumentsToParse = process.argv.slice(2);
const knownFlags = new Set(["--dry-run", "--rename-existing"]);
const unknownFlags = argumentsToParse.filter((argument) => argument.startsWith("--") && !knownFlags.has(argument));
const positionalArguments = argumentsToParse.filter((argument) => !argument.startsWith("--"));
const dryRun = argumentsToParse.includes("--dry-run");
const renameExisting = argumentsToParse.includes("--rename-existing");
if (unknownFlags.length > 0 || positionalArguments.length > 1 || (renameExisting && positionalArguments.length > 0)) {
  console.error("Usage: node process-gallery-batch.mjs [--dry-run] [base-url]");
  console.error("       node process-gallery-batch.mjs --rename-existing [--dry-run]");
  process.exit(2);
}

const requestedBaseUrl = positionalArguments[0];
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");
const previewCacheRoot = path.resolve(process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");

function supportedMetadataRecord(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (parsed.schema === "anime_waifu_lite/v1") return parsed;
  return Object.values(parsed).find(
    (value) => value && typeof value === "object" && !Array.isArray(value) && value.schema === "anime_waifu_lite/v1",
  );
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function metadataFingerprint(metadata) {
  return createHash("sha256").update(canonicalJson(metadata)).digest("hex");
}

function timestampedBatchName(date) {
  const twoDigits = (value) => String(value).padStart(2, "0");
  return [date.getFullYear(), twoDigits(date.getMonth() + 1), twoDigits(date.getDate())].join("-") + "_" +
    [twoDigits(date.getHours()), twoDigits(date.getMinutes()), twoDigits(date.getSeconds())].join("-");
}

function relativeGalleryPath(absolutePath) {
  return path.relative(galleryRoot, absolutePath).split(path.sep).join("/");
}

function lowerStem(fileName) {
  return path.basename(fileName, path.extname(fileName)).toLocaleLowerCase("en-US");
}

async function exists(filePath) {
  return access(filePath).then(() => true, () => false);
}

async function nextBatchTarget() {
  const timestamp = timestampedBatchName(new Date());
  let batchName = timestamp;
  let batchDirectory = path.join(galleryRoot, batchName);
  for (let suffix = 2; await exists(batchDirectory); suffix += 1) {
    batchName = `${timestamp}-${String(suffix).padStart(2, "0")}`;
    batchDirectory = path.join(galleryRoot, batchName);
  }
  return { batchName, batchDirectory };
}

async function nextQuarantineTarget() {
  const quarantineRoot = path.join(galleryRoot, ".duplicates");
  const timestamp = timestampedBatchName(new Date());
  let quarantineName = timestamp;
  let quarantineDirectory = path.join(quarantineRoot, quarantineName);
  for (let suffix = 2; await exists(quarantineDirectory); suffix += 1) {
    quarantineName = `${timestamp}-${String(suffix).padStart(2, "0")}`;
    quarantineDirectory = path.join(quarantineRoot, quarantineName);
  }
  return { quarantineDirectory, quarantineRelativeDirectory: `.duplicates/${quarantineName}` };
}

async function readImageRecords(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const regularFiles = entries.filter(
    (entry) => !entry.name.startsWith(".") && entry.isFile() && !entry.isSymbolicLink(),
  );
  const jsonFiles = regularFiles.filter((entry) => path.extname(entry.name).toLowerCase() === ".json");
  const imageFiles = regularFiles.filter((entry) => supportedExtensions.has(path.extname(entry.name).toLowerCase()));
  const imagesByStem = new Map();
  for (const imageFile of imageFiles) {
    const stem = path.basename(imageFile.name, path.extname(imageFile.name));
    const matches = imagesByStem.get(stem) ?? [];
    matches.push(imageFile);
    imagesByStem.set(stem, matches);
  }
  const metadataByImage = new Map();

  for (const jsonFile of jsonFiles) {
    const stem = path.basename(jsonFile.name, path.extname(jsonFile.name));
    const matches = imagesByStem.get(stem) ?? [];
    const displayPath = relativeGalleryPath(path.join(directory, jsonFile.name));
    if (matches.length === 0) throw new Error(`${displayPath} does not have a same-name image.`);
    if (matches.length > 1) throw new Error(`${displayPath} matches more than one image.`);

    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(directory, jsonFile.name), "utf8"));
    } catch (error) {
      throw new Error(`${displayPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const metadata = supportedMetadataRecord(parsed);
    if (!metadata) {
      throw new Error(`${displayPath} does not contain supported anime_waifu_lite/v1 metadata.`);
    }
    metadataByImage.set(matches[0].name, {
      metadataName: jsonFile.name,
      metadataFingerprint: metadataFingerprint(metadata),
    });
  }

  return imageFiles.map((imageFile) => {
    const metadata = metadataByImage.get(imageFile.name);
    return {
      directory,
      imageName: imageFile.name,
      metadataName: metadata?.metadataName,
      metadataFingerprint: metadata?.metadataFingerprint,
    };
  });
}

async function collectBatchedImageRecords() {
  const records = [];

  async function walk(directory, isRoot) {
    if (!isRoot) records.push(...await readImageRecords(directory));
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isDirectory()) continue;
      await walk(path.join(directory, entry.name), false);
    }
  }

  await walk(galleryRoot, true);
  return records;
}

function addCandidate(index, key, candidate) {
  if (key === undefined) return;
  const candidates = index.get(key) ?? [];
  candidates.push(candidate);
  index.set(key, candidates);
}

function contentHash(filePath, hashCache) {
  const existing = hashCache.get(filePath);
  if (existing) return existing;

  const pending = new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
  hashCache.set(filePath, pending);
  return pending;
}

async function classifyIncomingRecords(incomingRecords) {
  const existingRecords = await collectBatchedImageRecords();
  const candidatesBySize = new Map();
  const candidatesByMetadata = new Map();
  const hashCache = new Map();

  for (const record of existingRecords) {
    const absolutePath = path.join(record.directory, record.imageName);
    const stats = await lstat(absolutePath);
    const candidate = {
      absolutePath,
      relativePath: relativeGalleryPath(absolutePath),
      size: stats.size,
      metadataFingerprint: record.metadataFingerprint,
    };
    addCandidate(candidatesBySize, stats.size, candidate);
    addCandidate(candidatesByMetadata, record.metadataFingerprint, candidate);
  }

  const uniqueRecords = [];
  const duplicates = [];
  const metadataCollisions = [];
  for (const record of incomingRecords) {
    const absolutePath = path.join(record.directory, record.imageName);
    const stats = await lstat(absolutePath);
    const sizeCandidates = candidatesBySize.get(stats.size) ?? [];
    const metadataCandidates = record.metadataFingerprint
      ? candidatesByMetadata.get(record.metadataFingerprint) ?? []
      : [];
    const metadataCandidatePaths = new Set(metadataCandidates.map((candidate) => candidate.absolutePath));
    const orderedCandidates = [
      ...sizeCandidates.filter((candidate) => metadataCandidatePaths.has(candidate.absolutePath)),
      ...sizeCandidates.filter((candidate) => !metadataCandidatePaths.has(candidate.absolutePath)),
    ];

    let duplicateOf;
    if (orderedCandidates.length > 0) {
      const incomingHash = await contentHash(absolutePath, hashCache);
      for (const candidate of orderedCandidates) {
        if (await contentHash(candidate.absolutePath, hashCache) === incomingHash) {
          duplicateOf = candidate;
          break;
        }
      }
    }

    if (duplicateOf) {
      duplicates.push({ record, duplicateOf: duplicateOf.relativePath });
      continue;
    }

    if (metadataCandidates.length > 0) {
      metadataCollisions.push({
        imageName: record.imageName,
        matches: metadataCandidates.map((candidate) => candidate.relativePath),
      });
    }

    const incomingCandidate = {
      absolutePath,
      relativePath: relativeGalleryPath(absolutePath),
      size: stats.size,
      metadataFingerprint: record.metadataFingerprint,
    };
    addCandidate(candidatesBySize, stats.size, incomingCandidate);
    addCandidate(candidatesByMetadata, record.metadataFingerprint, incomingCandidate);
    uniqueRecords.push(record);
  }

  return { duplicates, metadataCollisions, uniqueRecords };
}

async function collectUsedImageStems() {
  const stems = new Set();

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await walk(path.join(directory, entry.name));
      } else if (entry.isFile() && supportedExtensions.has(path.extname(entry.name).toLowerCase())) {
        stems.add(lowerStem(entry.name));
      }
    }
  }

  await walk(galleryRoot);
  return stems;
}

function previewCacheKey(identifier, size, modifiedAt) {
  return createHash("sha256")
    .update(identifier)
    .update("\0")
    .update(String(size))
    .update("\0")
    .update(String(modifiedAt))
    .digest("hex");
}

function previewCachePath(identifier, size, modifiedAt) {
  const key = previewCacheKey(identifier, size, modifiedAt);
  return path.join(previewCacheRoot, key.slice(0, 2), `${key}.webp`);
}

async function preserveCachedPreview(imageMove) {
  const extension = path.extname(imageMove.sourcePath).toLowerCase();
  if (extension !== ".png" && extension !== ".gif") return undefined;

  const sourceStats = await lstat(imageMove.sourcePath);
  const targetCachePath = previewCachePath(
    path.posix.basename(imageMove.targetRelativePath),
    sourceStats.size,
    sourceStats.mtimeMs,
  );
  if (await exists(targetCachePath)) return undefined;

  const sourceCandidates = [
    previewCachePath(path.posix.basename(imageMove.sourceRelativePath), sourceStats.size, sourceStats.mtimeMs),
    previewCachePath(imageMove.sourceRelativePath, sourceStats.size, sourceStats.mtimeMs),
  ];
  let cachedSource;
  for (const candidate of sourceCandidates) {
    if (candidate !== targetCachePath && await exists(candidate)) {
      cachedSource = candidate;
      break;
    }
  }
  if (!cachedSource) return undefined;

  await mkdir(path.dirname(targetCachePath), { recursive: true });
  try {
    await copyFile(cachedSource, targetCachePath, fileSystemConstants.COPYFILE_EXCL);
    return targetCachePath;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") return undefined;
    throw error;
  }
}

async function preparePreviewCopies(imageMoves) {
  const createdCachePaths = [];
  try {
    for (const imageMove of imageMoves) {
      const createdPath = await preserveCachedPreview(imageMove);
      if (createdPath) createdCachePaths.push(createdPath);
    }
    return createdCachePaths;
  } catch (error) {
    await Promise.all(createdCachePaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
}

async function executeMoves(fileMoves, newDirectories = []) {
  const createdDirectories = [];
  const createdParents = [];
  const completedMoves = [];
  try {
    for (const directory of newDirectories) {
      if (await exists(directory)) throw new Error(`Target directory already exists: ${directory}`);
      const parentDirectory = path.dirname(directory);
      const parentExisted = await exists(parentDirectory);
      await mkdir(directory, { recursive: true });
      createdDirectories.push(directory);
      if (!parentExisted) createdParents.push(parentDirectory);
    }
    for (const fileMove of fileMoves) {
      if (await exists(fileMove.targetPath)) throw new Error(`Target already exists: ${fileMove.targetPath}`);
      await rename(fileMove.sourcePath, fileMove.targetPath);
      completedMoves.push(fileMove);
    }
  } catch (error) {
    for (const fileMove of completedMoves.reverse()) {
      await rename(fileMove.targetPath, fileMove.sourcePath).catch(() => undefined);
    }
    for (const directory of createdDirectories.reverse()) {
      await rmdir(directory).catch(() => undefined);
    }
    for (const directory of createdParents.reverse()) {
      await rmdir(directory).catch(() => undefined);
    }
    throw error;
  }
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
    (image) => image && typeof image.previewUrl === "string" && (!batchName ||
      (typeof image.path === "string" && image.path.startsWith(`${batchName}/`))),
  );
  const cachedCount = previewImages.filter((image) => image.previewCached === true).length;
  const previewUrls = previewImages
    .filter((image) => image.previewCached !== true)
    .map((image) => image.previewUrl);

  if (cachedCount > 0) {
    console.log(`${cachedCount} preview${cachedCount === 1 ? " is" : "s are"} already cached.`);
  }
  if (previewUrls.length === 0) {
    console.log(batchName
      ? `No PNG or GIF previews need caching in ${batchName}.`
      : "No PNG or GIF previews need caching.");
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

async function renameExistingBatches() {
  if (!namingEnabled) {
    throw new Error("Set BATCH_NAME_STYLE=japanese-fantasy before renaming existing batches.");
  }

  const records = await collectBatchedImageRecords();
  if (records.length === 0) {
    console.log("No images were found in existing batch directories.");
    return;
  }

  const usedNames = await collectUsedImageStems();
  const imageMoves = [];
  const fileMoves = [];
  const mappings = [];
  for (const record of records) {
    const generatedName = generateJapaneseFantasyName(usedNames);
    const imageTargetName = `${generatedName}${path.extname(record.imageName).toLowerCase()}`;
    const sourcePath = path.join(record.directory, record.imageName);
    const targetPath = path.join(record.directory, imageTargetName);
    const sourceRelativePath = relativeGalleryPath(sourcePath);
    const targetRelativePath = relativeGalleryPath(targetPath);
    imageMoves.push({ sourcePath, targetPath, sourceRelativePath, targetRelativePath });
    fileMoves.push({ sourcePath, targetPath });

    let metadataMapping = "";
    if (record.metadataName) {
      const metadataTargetName = `${generatedName}.json`;
      fileMoves.push({
        sourcePath: path.join(record.directory, record.metadataName),
        targetPath: path.join(record.directory, metadataTargetName),
      });
      metadataMapping = ` + ${record.metadataName} -> ${metadataTargetName}`;
    }
    mappings.push(`- ${sourceRelativePath} -> ${targetRelativePath}${metadataMapping}`);
  }

  console.log(`${dryRun ? "Would rename" : "Renaming"} ${records.length} existing batched image${records.length === 1 ? "" : "s"}.`);
  if (dryRun) {
    for (const mapping of mappings) console.log(mapping);
    return;
  }

  const createdCachePaths = await preparePreviewCopies(imageMoves);
  try {
    await executeMoves(fileMoves);
  } catch (error) {
    await Promise.all(createdCachePaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
  if (createdCachePaths.length > 0) {
    console.log(`Preserved ${createdCachePaths.length} cached preview${createdCachePaths.length === 1 ? "" : "s"}.`);
  }
  console.log("Existing batch images have been renamed.");
}

async function processIncomingBatch() {
  const records = await readImageRecords(galleryRoot);
  if (records.length === 0) {
    console.log("No root-level images are ready to process. Checking the full gallery for missing previews.");
    try {
      await cacheMissingPreviews();
    } catch (error) {
      console.error("Preview caching failed. Re-run ./process-batch.sh when the service is available.");
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  const { duplicates, metadataCollisions, uniqueRecords } = await classifyIncomingRecords(records);
  const quarantineTarget = duplicates.length > 0 ? await nextQuarantineTarget() : undefined;
  const batchTarget = uniqueRecords.length > 0 ? await nextBatchTarget() : undefined;
  const usedNames = namingEnabled && uniqueRecords.length > 0 ? await collectUsedImageStems() : new Set();
  const imageMoves = [];
  const fileMoves = [];
  const newDirectories = [];
  const mappings = [];
  const quarantineMappings = [];
  let metadataCount = 0;

  if (quarantineTarget) {
    newDirectories.push(quarantineTarget.quarantineDirectory);
    for (const duplicate of duplicates) {
      const imageSourcePath = path.join(duplicate.record.directory, duplicate.record.imageName);
      const imageTargetPath = path.join(quarantineTarget.quarantineDirectory, duplicate.record.imageName);
      fileMoves.push({ sourcePath: imageSourcePath, targetPath: imageTargetPath });
      let metadataMapping = "";
      if (duplicate.record.metadataName) {
        fileMoves.push({
          sourcePath: path.join(duplicate.record.directory, duplicate.record.metadataName),
          targetPath: path.join(quarantineTarget.quarantineDirectory, duplicate.record.metadataName),
        });
        metadataMapping = ` + ${duplicate.record.metadataName}`;
      }
      quarantineMappings.push(
        `- ${duplicate.record.imageName}${metadataMapping} -> ${quarantineTarget.quarantineRelativeDirectory}/ ` +
        `(duplicate of ${duplicate.duplicateOf})`,
      );
    }
  }

  if (batchTarget) newDirectories.push(batchTarget.batchDirectory);
  for (const record of uniqueRecords) {
    const sourceStem = path.basename(record.imageName, path.extname(record.imageName));
    const targetStem = namingEnabled ? generateJapaneseFantasyName(usedNames) : sourceStem;
    const imageTargetName = `${targetStem}${path.extname(record.imageName)}`;
    const sourcePath = path.join(galleryRoot, record.imageName);
    const targetPath = path.join(batchTarget.batchDirectory, imageTargetName);
    const sourceRelativePath = relativeGalleryPath(sourcePath);
    const targetRelativePath = `${batchTarget.batchName}/${imageTargetName}`;
    imageMoves.push({ sourcePath, targetPath, sourceRelativePath, targetRelativePath });
    fileMoves.push({ sourcePath, targetPath });

    let metadataMapping = "";
    if (record.metadataName) {
      metadataCount += 1;
      const metadataTargetName = namingEnabled ? `${targetStem}.json` : record.metadataName;
      fileMoves.push({
        sourcePath: path.join(galleryRoot, record.metadataName),
        targetPath: path.join(batchTarget.batchDirectory, metadataTargetName),
      });
      metadataMapping = namingEnabled
        ? ` + ${record.metadataName} -> ${metadataTargetName}`
        : ` + ${record.metadataName}`;
    }
    mappings.push(namingEnabled
      ? `- ${record.imageName} -> ${imageTargetName}${metadataMapping}`
      : `- ${record.imageName}${metadataMapping}`);
  }

  if (duplicates.length > 0) {
    console.log(
      `${dryRun ? "Would quarantine" : "Quarantining"} ${duplicates.length} duplicate ` +
      `image${duplicates.length === 1 ? "" : "s"} in ${quarantineTarget.quarantineRelativeDirectory}/`,
    );
    for (const mapping of quarantineMappings) console.log(mapping);
  }
  if (metadataCollisions.length > 0) {
    console.log(
      `${metadataCollisions.length} metadata match${metadataCollisions.length === 1 ? " has" : "es have"} ` +
      "different image content and will remain in the batch:",
    );
    for (const collision of metadataCollisions) {
      console.log(`- ${collision.imageName} differs from ${collision.matches.join(", ")}`);
    }
  }
  if (batchTarget) {
    console.log(
      `${dryRun ? "Would move" : "Moving"} ${uniqueRecords.length} unique ` +
      `image${uniqueRecords.length === 1 ? "" : "s"} (${metadataCount} with metadata) ` +
      `to ${batchTarget.batchName}/${namingEnabled ? " using generated names" : ""}`,
    );
  } else {
    console.log("No unique images remain to batch.");
  }
  if (dryRun) {
    for (const mapping of mappings) console.log(mapping);
    return;
  }

  const createdCachePaths = await preparePreviewCopies(imageMoves);
  try {
    await executeMoves(fileMoves, newDirectories);
  } catch (error) {
    await Promise.all(createdCachePaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
  if (createdCachePaths.length > 0) {
    console.log(`Preserved ${createdCachePaths.length} cached preview${createdCachePaths.length === 1 ? "" : "s"}.`);
  }
  if (duplicates.length > 0) {
    console.log(`Quarantined duplicates in ${quarantineTarget.quarantineRelativeDirectory}/.`);
  }

  if (!batchTarget) return;

  console.log(`Batch ${batchTarget.batchName}/ is ready.`);
  try {
    await cacheMissingPreviews(batchTarget.batchName);
  } catch (error) {
    console.error("The batch was organized successfully, but preview caching failed. Re-run ./process-batch.sh when the service is available.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const rootStats = await lstat(galleryRoot).catch(() => undefined);
if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
  throw new Error("GALLERY_DIR must be an existing, non-symbolic-link directory.");
}
const cacheRelativeToGallery = path.relative(galleryRoot, previewCacheRoot);
if (
  cacheRelativeToGallery === "" ||
  (!cacheRelativeToGallery.startsWith("..") && !path.isAbsolute(cacheRelativeToGallery))
) {
  throw new Error("PREVIEW_CACHE_DIR must be outside GALLERY_DIR.");
}

if (renameExisting) await renameExistingBatches();
else await processIncomingBatch();
