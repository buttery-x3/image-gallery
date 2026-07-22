import "dotenv/config";
import { createHash } from "node:crypto";
import { constants as fileSystemConstants, createReadStream, readFileSync } from "node:fs";
import { access, copyFile, lstat, mkdir, readdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateName, generateShortNameForStem, loadNameGenerationDefinitions } from "./gallery-name-generator.mjs";
import { extractMetadataContext, loadMetadataContextDefinitions } from "./gallery-metadata-context.mjs";

const supportedExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
const nameMetadataSuffix = ".gallery-name.json";
const legacyNameMetadataSchema = "image-gallery/name/v1";
const nameMetadataSchema = "image-gallery/name/v2";
if (process.env.BATCH_NAME_STYLE?.trim()) {
  throw new Error(
    "BATCH_NAME_STYLE is no longer supported. Configure metadata.schemas.<source-schema>.nameGeneration in gallery.config.json.",
  );
}

function readMetadataSchemaPolicies() {
  const configPath = path.resolve("gallery.config.json");
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
    const metadata = parsed.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return new Map();
    if (metadata.enabledSchemas !== undefined) {
      throw new Error("gallery.config.json metadata.enabledSchemas has been replaced by metadata.schemas.");
    }
    if (metadata.schemas === undefined) return new Map();
    if (!metadata.schemas || typeof metadata.schemas !== "object" || Array.isArray(metadata.schemas)) {
      throw new Error("gallery.config.json metadata.schemas must be an object.");
    }
    const policies = new Map();
    for (const [sourceSchema, value] of Object.entries(metadata.schemas)) {
      if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.enabled !== "boolean") {
        throw new Error(`gallery.config.json metadata.schemas.${sourceSchema} must contain enabled: true or false.`);
      }
      let nameGeneration;
      if (value.nameGeneration !== undefined) {
        if (!value.enabled) throw new Error(`Name generation cannot be configured for disabled metadata schema ${sourceSchema}.`);
        if (!value.nameGeneration || typeof value.nameGeneration !== "object" || Array.isArray(value.nameGeneration)) {
          throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration must be an object.`);
        }
        const definition = value.nameGeneration.definition;
        const pipeline = value.nameGeneration.pipeline;
        const shortNames = value.nameGeneration.shortNames ?? [];
        if (typeof definition !== "string" || !definition.trim()) {
          throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.definition must be a non-empty string.`);
        }
        if (pipeline !== undefined && pipeline !== "contextual/v1") {
          throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.pipeline must be contextual/v1.`);
        }
        if (!Array.isArray(shortNames) || shortNames.some((language) => language !== "en" && language !== "ja") || new Set(shortNames).size !== shortNames.length) {
          throw new Error(`gallery.config.json metadata.schemas.${sourceSchema}.nameGeneration.shortNames must contain unique en/ja values.`);
        }
        nameGeneration = {
          definition: definition.trim(),
          ...(pipeline === "contextual/v1" ? { pipeline } : {}),
          shortNames: [...shortNames],
        };
      }
      policies.set(sourceSchema, { enabled: value.enabled, ...(nameGeneration ? { nameGeneration } : {}) });
    }
    return policies;
  } catch (error) {
    throw new Error(`Could not read gallery metadata configuration: ${error instanceof Error ? error.message : String(error)}`);
  }
}
const metadataSchemaPolicies = readMetadataSchemaPolicies();

const argumentsToParse = process.argv.slice(2);
const knownFlags = new Set(["--backfill-name-metadata", "--dry-run", "--rename-existing"]);
const unknownFlags = argumentsToParse.filter((argument) => argument.startsWith("--") && !knownFlags.has(argument));
const positionalArguments = argumentsToParse.filter((argument) => !argument.startsWith("--"));
const dryRun = argumentsToParse.includes("--dry-run");
const renameExisting = argumentsToParse.includes("--rename-existing");
const backfillNameMetadata = argumentsToParse.includes("--backfill-name-metadata");
if (
  unknownFlags.length > 0 || positionalArguments.length > 1 ||
  ((renameExisting || backfillNameMetadata) && positionalArguments.length > 0) ||
  (renameExisting && backfillNameMetadata)
) {
  console.error("Usage: node process-gallery-batch.mjs [--dry-run] [base-url]");
  console.error("       node process-gallery-batch.mjs --rename-existing [--dry-run]");
  console.error("       node process-gallery-batch.mjs --backfill-name-metadata [--dry-run]");
  process.exit(2);
}

const requestedBaseUrl = positionalArguments[0];
const galleryRoot = path.resolve(process.env.GALLERY_DIR ?? "gallery");
const previewCacheRoot = path.resolve(process.env.PREVIEW_CACHE_DIR ?? ".cache/previews");
const previewCacheProfile = "v2-600-q86";
const nameGenerationDefinitionsRoot = path.resolve("name-generation-schemas");
const metadataDefinitionsRoot = path.resolve("metadata-schemas");
let validatedNameDefinitions = new Map();
let validatedMetadataDefinitions = new Map();

function sourceMetadataSchema(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  if (typeof parsed.schema === "string" && parsed.schema.trim()) return parsed.schema.trim();
  const candidates = Object.values(parsed).filter(
    (value) => value && typeof value === "object" && !Array.isArray(value) && typeof value.schema === "string" && value.schema.trim(),
  );
  return candidates.length === 1 ? candidates[0].schema.trim() : undefined;
}

function supportedNameMetadataRecord(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const shortName = parsed.shortName;
  if (!shortName || typeof shortName !== "object" || Array.isArray(shortName)) return undefined;
  const en = typeof shortName.en === "string" ? shortName.en.trim() : "";
  const ja = typeof shortName.ja === "string" ? shortName.ja.trim() : "";
  if (parsed.schema === legacyNameMetadataSchema) return en && ja ? { shortName: { en, ja } } : undefined;
  if (
    parsed.schema !== nameMetadataSchema || (!en && !ja) ||
    typeof parsed.sourceMetadataSchema !== "string" || !parsed.sourceMetadataSchema.trim() ||
    typeof parsed.generatorSchema !== "string" || !parsed.generatorSchema.trim()
  ) return undefined;
  return {
    shortName: { ...(en ? { en } : {}), ...(ja ? { ja } : {}) },
    sourceMetadataSchema: parsed.sourceMetadataSchema.trim(),
    generatorSchema: parsed.generatorSchema.trim(),
  };
}

function nameMetadataContents(sourceSchema, generatorSchema, shortName, components) {
  return `${JSON.stringify({
    schema: nameMetadataSchema,
    sourceMetadataSchema: sourceSchema,
    generatorSchema,
    shortName,
    ...(components ? { components } : {}),
  }, null, 2)}\n`;
}

function nameMetadataStem(fileName) {
  return fileName.endsWith(nameMetadataSuffix) ? fileName.slice(0, -nameMetadataSuffix.length) : undefined;
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

async function readImageRecords(directory, options = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const regularFiles = entries.filter(
    (entry) => !entry.name.startsWith(".") && entry.isFile() && !entry.isSymbolicLink(),
  );
  const nameMetadataFiles = regularFiles.filter((entry) => entry.name.endsWith(nameMetadataSuffix));
  const jsonFiles = regularFiles.filter(
    (entry) => path.extname(entry.name).toLowerCase() === ".json" && !entry.name.endsWith(nameMetadataSuffix),
  );
  const imageFiles = regularFiles.filter((entry) => supportedExtensions.has(path.extname(entry.name).toLowerCase()));
  const imagesByStem = new Map();
  for (const imageFile of imageFiles) {
    const stem = path.basename(imageFile.name, path.extname(imageFile.name));
    const matches = imagesByStem.get(stem) ?? [];
    matches.push(imageFile);
    imagesByStem.set(stem, matches);
  }
  const metadataByImage = new Map();
  const nameMetadataByImage = new Map();

  for (const jsonFile of jsonFiles) {
    const stem = path.basename(jsonFile.name, path.extname(jsonFile.name));
    const matches = imagesByStem.get(stem) ?? [];
    const displayPath = relativeGalleryPath(path.join(directory, jsonFile.name));
    if (matches.length === 0 && options.allowOrphanedMetadata) {
      options.orphanedMetadataFiles?.push(displayPath);
      continue;
    }
    if (matches.length === 0) throw new Error(`${displayPath} does not have a same-name image.`);
    if (matches.length > 1) throw new Error(`${displayPath} matches more than one image.`);

    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(directory, jsonFile.name), "utf8"));
    } catch (error) {
      throw new Error(`${displayPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    metadataByImage.set(matches[0].name, {
      metadataName: jsonFile.name,
      metadataFingerprint: metadataFingerprint(parsed),
      sourceMetadataSchema: sourceMetadataSchema(parsed),
      sourceMetadata: parsed,
    });
  }

  for (const nameMetadataFile of nameMetadataFiles) {
    const stem = nameMetadataStem(nameMetadataFile.name);
    const matches = stem ? imagesByStem.get(stem) ?? [] : [];
    const displayPath = relativeGalleryPath(path.join(directory, nameMetadataFile.name));
    if (!options.allowNameMetadata) {
      throw new Error(`${displayPath} is reserved generated-name metadata and cannot be supplied as an incoming file.`);
    }
    if (matches.length === 0) throw new Error(`${displayPath} does not have a same-name image.`);
    if (matches.length > 1) throw new Error(`${displayPath} matches more than one image.`);

    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(directory, nameMetadataFile.name), "utf8"));
    } catch (error) {
      throw new Error(`${displayPath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const nameMetadata = supportedNameMetadataRecord(parsed);
    if (!nameMetadata && !options.allowInvalidNameMetadata) {
      throw new Error(`${displayPath} does not contain supported ${legacyNameMetadataSchema} or ${nameMetadataSchema} metadata.`);
    }
    nameMetadataByImage.set(matches[0].name, {
      nameMetadataName: nameMetadataFile.name,
      shortName: nameMetadata?.shortName,
      nameGeneratorSchema: nameMetadata?.generatorSchema,
      nameSourceMetadataSchema: nameMetadata?.sourceMetadataSchema,
      nameMetadataInvalid: !nameMetadata,
    });
  }

  return imageFiles.map((imageFile) => {
    const metadata = metadataByImage.get(imageFile.name);
    const nameMetadata = nameMetadataByImage.get(imageFile.name);
    return {
      directory,
      imageName: imageFile.name,
      metadataName: metadata?.metadataName,
      metadataFingerprint: metadata?.metadataFingerprint,
      sourceMetadataSchema: metadata?.sourceMetadataSchema,
      sourceMetadata: metadata?.sourceMetadata,
      nameMetadataName: nameMetadata?.nameMetadataName,
      shortName: nameMetadata?.shortName,
      nameGeneratorSchema: nameMetadata?.nameGeneratorSchema,
      nameSourceMetadataSchema: nameMetadata?.nameSourceMetadataSchema,
      nameMetadataInvalid: nameMetadata?.nameMetadataInvalid,
    };
  });
}

async function collectBatchedImageRecords(options = {}) {
  const records = [];

  async function walk(directory, isRoot) {
    if (!isRoot) records.push(...await readImageRecords(directory, {
      allowNameMetadata: true,
      allowInvalidNameMetadata: options.allowInvalidNameMetadata !== false,
    }));
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

async function collectUsedShortNames() {
  const records = await collectBatchedImageRecords({ allowInvalidNameMetadata: true });
  return {
    en: new Set(records.flatMap((record) => record.shortName?.en
      ? [record.shortName.en.toLocaleLowerCase("en-US")]
      : [])),
    ja: new Set(records.flatMap((record) => record.shortName?.ja
      ? [record.shortName.ja.toLocaleLowerCase("en-US")]
      : [])),
  };
}

function nameGenerationPolicy(record) {
  if (!record.sourceMetadataSchema) return undefined;
  return metadataSchemaPolicies.get(record.sourceMetadataSchema)?.nameGeneration;
}

async function nameDefinitionsFor(records) {
  for (const record of records) {
    const policy = nameGenerationPolicy(record);
    if (!policy) continue;
    const definition = validatedNameDefinitions.get(policy.definition);
    if (policy.pipeline === "contextual/v1" && definition?.engine !== "pipeline/v1") {
      throw new Error(`${policy.definition} must use engine pipeline/v1 when pipeline contextual/v1 is configured.`);
    }
    if (!policy.pipeline && definition?.engine === "pipeline/v1") {
      throw new Error(`${policy.definition} requires nameGeneration.pipeline: contextual/v1.`);
    }
  }
  return validatedNameDefinitions;
}

function pipelineContextKeys(definition) {
  return new Set(definition.stages.flatMap((stage) => {
    if (stage.type === "contextual-compound/v1") {
      return [stage.context.family, stage.context.species, ...stage.context.traits];
    }
    if (stage.type === "contextual-pool/v1") return stage.contexts;
    return [];
  }));
}

async function validateBatchSchemas() {
  const enabledMetadataSchemas = new Set(
    [...metadataSchemaPolicies].filter(([, policy]) => policy.enabled).map(([schema]) => schema),
  );
  validatedMetadataDefinitions = await loadMetadataContextDefinitions(
    metadataDefinitionsRoot,
    enabledMetadataSchemas,
    { validateAll: true },
  );

  const requestedByNameSchema = new Map();
  for (const policy of metadataSchemaPolicies.values()) {
    if (!policy.nameGeneration) continue;
    const requested = requestedByNameSchema.get(policy.nameGeneration.definition) ?? new Set();
    for (const representation of policy.nameGeneration.shortNames) requested.add(representation);
    requestedByNameSchema.set(policy.nameGeneration.definition, requested);
  }
  validatedNameDefinitions = await loadNameGenerationDefinitions(
    nameGenerationDefinitionsRoot,
    new Map([...requestedByNameSchema].map(([schema, representations]) => [schema, [...representations]])),
    { validateAll: true },
  );

  for (const [sourceSchema, policy] of metadataSchemaPolicies) {
    const naming = policy.nameGeneration;
    if (!naming) continue;
    const nameDefinition = validatedNameDefinitions.get(naming.definition);
    if (naming.pipeline === "contextual/v1" && nameDefinition.engine !== "pipeline/v1") {
      throw new Error(`${naming.definition} must use engine pipeline/v1 when pipeline contextual/v1 is configured.`);
    }
    if (!naming.pipeline && nameDefinition.engine === "pipeline/v1") {
      throw new Error(`${naming.definition} requires nameGeneration.pipeline: contextual/v1.`);
    }
    if (naming.pipeline !== "contextual/v1") continue;
    const metadataDefinition = validatedMetadataDefinitions.get(sourceSchema);
    const missingTags = [...pipelineContextKeys(nameDefinition)].filter((tag) => !(tag in metadataDefinition.tags));
    if (missingTags.length > 0) {
      throw new Error(
        `${naming.definition} requests canonical context tag${missingTags.length === 1 ? "" : "s"} not provided by ` +
        `${sourceSchema}: ${missingTags.join(", ")}`,
      );
    }
  }
}

async function addGenerationContexts(records, nameDefinitions) {
  for (const record of records) {
    const policy = nameGenerationPolicy(record);
    if (policy?.pipeline !== "contextual/v1" || !record.sourceMetadataSchema) continue;
    const metadataDefinition = validatedMetadataDefinitions.get(record.sourceMetadataSchema);
    const nameDefinition = nameDefinitions.get(policy.definition);
    const missingTags = [...pipelineContextKeys(nameDefinition)].filter((tag) => !(tag in metadataDefinition.tags));
    if (missingTags.length > 0) {
      throw new Error(
        `${policy.definition} requests canonical context tag${missingTags.length === 1 ? "" : "s"} not provided by ` +
        `${record.sourceMetadataSchema}: ${missingTags.join(", ")}`,
      );
    }
    record.generationContext = extractMetadataContext(
      record.sourceMetadata,
      metadataDefinition,
    );
  }
}

function generateNameForRecord(record, definitions, usedNames, usedShortNames) {
  const policy = nameGenerationPolicy(record);
  if (!policy) return undefined;
  const definition = definitions.get(policy.definition);
  if (!definition) throw new Error(`Name generation definition ${policy.definition} was not loaded.`);
  return generateName(definition, policy.shortNames, usedNames, usedShortNames, record.generationContext);
}

function previewCacheKey(identifier, size, modifiedAt) {
  return createHash("sha256")
    .update(previewCacheProfile)
    .update("\0")
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

async function executeMoves(fileMoves, newDirectories = [], fileWrites = []) {
  const createdDirectories = [];
  const createdParents = [];
  const completedMoves = [];
  const completedWrites = [];
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
    for (const fileWrite of fileWrites) {
      if (fileWrite.replaceExisting) {
        const previousContents = await readFile(fileWrite.targetPath, "utf8");
        completedWrites.push({ ...fileWrite, previousContents });
        await writeFile(fileWrite.targetPath, fileWrite.contents, "utf8");
      } else {
        await writeFile(fileWrite.targetPath, fileWrite.contents, { encoding: "utf8", flag: "wx" });
        completedWrites.push(fileWrite);
      }
    }
  } catch (error) {
    for (const fileWrite of completedWrites.reverse()) {
      if ("previousContents" in fileWrite) {
        await writeFile(fileWrite.targetPath, fileWrite.previousContents, "utf8").catch(() => undefined);
      } else {
        await rm(fileWrite.targetPath, { force: true }).catch(() => undefined);
      }
    }
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
  const records = await collectBatchedImageRecords({ allowInvalidNameMetadata: true });
  if (records.length === 0) {
    console.log("No images were found in existing batch directories.");
    return;
  }
  const recordsToRename = records.filter((record) => nameGenerationPolicy(record));
  if (recordsToRename.length === 0) {
    console.log("No existing images use a source metadata schema with configured name generation.");
    return;
  }
  const invalidRecord = recordsToRename.find((record) => record.nameMetadataInvalid);
  if (invalidRecord) {
    throw new Error(`${relativeGalleryPath(path.join(invalidRecord.directory, invalidRecord.nameMetadataName))} is invalid and cannot be replaced automatically.`);
  }

  const definitions = await nameDefinitionsFor(recordsToRename);
  await addGenerationContexts(recordsToRename, definitions);
  const usedNames = await collectUsedImageStems();
  const usedShortNames = await collectUsedShortNames();
  const imageMoves = [];
  const fileMoves = [];
  const fileWrites = [];
  const mappings = [];
  for (const record of recordsToRename) {
    const policy = nameGenerationPolicy(record);
    const generated = generateNameForRecord(record, definitions, usedNames, usedShortNames);
    const imageTargetName = `${generated.fileStem}${path.extname(record.imageName).toLowerCase()}`;
    const sourcePath = path.join(record.directory, record.imageName);
    const targetPath = path.join(record.directory, imageTargetName);
    const sourceRelativePath = relativeGalleryPath(sourcePath);
    const targetRelativePath = relativeGalleryPath(targetPath);
    imageMoves.push({ sourcePath, targetPath, sourceRelativePath, targetRelativePath });
    fileMoves.push({ sourcePath, targetPath });

    let metadataMapping = "";
    if (record.metadataName) {
      const metadataTargetName = `${generated.fileStem}.json`;
      fileMoves.push({
        sourcePath: path.join(record.directory, record.metadataName),
        targetPath: path.join(record.directory, metadataTargetName),
      });
      metadataMapping = ` + ${record.metadataName} -> ${metadataTargetName}`;
    }
    const nameMetadataTargetName = `${generated.fileStem}${nameMetadataSuffix}`;
    if (record.nameMetadataName) {
      fileMoves.push({
        sourcePath: path.join(record.directory, record.nameMetadataName),
        targetPath: path.join(record.directory, nameMetadataTargetName),
      });
    }
    if (policy.shortNames.length > 0) {
      fileWrites.push({
        targetPath: path.join(record.directory, nameMetadataTargetName),
        contents: nameMetadataContents(record.sourceMetadataSchema, generated.generatorSchema, generated.shortName, generated.components),
        replaceExisting: Boolean(record.nameMetadataName),
      });
    }
    mappings.push(
      `- ${sourceRelativePath} -> ${targetRelativePath}${metadataMapping}` +
      (generated.shortName ? ` + ${nameMetadataTargetName} (${Object.values(generated.shortName).join(" / ")})` : ""),
    );
  }

  console.log(`${dryRun ? "Would rename" : "Renaming"} ${recordsToRename.length} existing batched image${recordsToRename.length === 1 ? "" : "s"}.`);
  if (dryRun) {
    for (const mapping of mappings) console.log(mapping);
    return;
  }

  const createdCachePaths = await preparePreviewCopies(imageMoves);
  try {
    await executeMoves(fileMoves, [], fileWrites);
  } catch (error) {
    await Promise.all(createdCachePaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
  if (createdCachePaths.length > 0) {
    console.log(`Preserved ${createdCachePaths.length} cached preview${createdCachePaths.length === 1 ? "" : "s"}.`);
  }
  console.log("Existing batch images have been renamed.");
}

async function backfillGeneratedNameMetadata() {
  const records = await collectBatchedImageRecords({ allowInvalidNameMetadata: true });
  const recordsWithShortNames = records.filter((record) => (nameGenerationPolicy(record)?.shortNames.length ?? 0) > 0);
  if (recordsWithShortNames.length === 0) {
    console.log("No configured source metadata schema requests generated short names.");
    return;
  }
  const definitions = await nameDefinitionsFor(recordsWithShortNames);
  const usedShortNames = await collectUsedShortNames();
  const fileWrites = [];
  const mappings = [];
  const skipped = [];

  for (const record of recordsWithShortNames) {
    const relativePath = relativeGalleryPath(path.join(record.directory, record.imageName));
    if (record.nameMetadataInvalid) {
      skipped.push(`- ${relativePath}: invalid name metadata requires manual repair`);
      continue;
    }
    const policy = nameGenerationPolicy(record);
    const missingRepresentations = policy.shortNames.filter((representation) => !record.shortName?.[representation]);
    if (missingRepresentations.length === 0) {
      skipped.push(`- ${relativePath}: already has every configured short-name representation`);
      continue;
    }
    const definition = definitions.get(policy.definition);

    const fileStem = path.basename(record.imageName, path.extname(record.imageName));
    let generatedShortName;
    try {
      generatedShortName = generateShortNameForStem(definition, fileStem, missingRepresentations, usedShortNames);
    } catch (error) {
      skipped.push(`- ${relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const targetName = `${fileStem}${nameMetadataSuffix}`;
    fileWrites.push({
      targetPath: path.join(record.directory, targetName),
      contents: nameMetadataContents(record.sourceMetadataSchema, policy.definition, {
        ...record.shortName,
        ...generatedShortName,
      }),
      replaceExisting: Boolean(record.nameMetadataName),
    });
    mappings.push(`- ${relativePath} + ${targetName} (${Object.values(generatedShortName).join(" / ")})`);
  }

  console.log(`${dryRun ? "Would add" : "Adding"} name metadata for ${fileWrites.length} image${fileWrites.length === 1 ? "" : "s"}.`);
  if (skipped.length > 0) {
    console.log(`Skipping ${skipped.length} image${skipped.length === 1 ? "" : "s"}:`);
    for (const message of skipped) console.log(message);
  }
  if (dryRun || fileWrites.length === 0) return;

  await executeMoves([], [], fileWrites);
  console.log("Generated-name metadata backfill is complete.");
}

async function processIncomingBatch() {
  const orphanedMetadataFiles = [];
  const records = await readImageRecords(galleryRoot, {
    allowOrphanedMetadata: true,
    orphanedMetadataFiles,
  });
  const incomingMissingMetadata = records.filter((record) => !record.metadataName).length;
  const printReport = ({
    added = 0,
    renamed = 0,
    generatedMetadataAdded = 0,
    sourceMetadataPreserved = 0,
    duplicatesQuarantined = 0,
    metadataCollisionsRetained = 0,
  } = {}) => {
    const planned = dryRun ? " (dry run)" : "";
    console.log(`\nBatch report${planned}:`);
    console.log(`- Incoming images found: ${records.length}`);
    console.log(`- Images ${dryRun ? "that would be added" : "added"}: ${added}`);
    console.log(`- Incoming images missing source JSON: ${incomingMissingMetadata}`);
    console.log(`- Source metadata files ${dryRun ? "that would be preserved" : "preserved"}: ${sourceMetadataPreserved}`);
    console.log(`- Images ${dryRun ? "that would be renamed" : "renamed"}: ${renamed}`);
    console.log(`- Generated name metadata files ${dryRun ? "that would be added" : "added"}: ${generatedMetadataAdded}`);
    console.log(`- Duplicate images ${dryRun ? "that would be quarantined" : "quarantined"}: ${duplicatesQuarantined}`);
    console.log(`- Metadata collisions retained: ${metadataCollisionsRetained}`);
    console.log(
      `- Orphan source JSON files ${dryRun ? "that would be quarantined" : "quarantined"}: ` +
      orphanedMetadataFiles.length,
    );
  };

  if (records.length === 0 && orphanedMetadataFiles.length === 0) {
    console.log("No root-level images are ready to process. Checking the full gallery for missing previews.");
    try {
      await cacheMissingPreviews();
    } catch (error) {
      console.error("Preview caching failed. Re-run ./process-batch.sh when the service is available.");
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    printReport();
    return;
  }

  const { duplicates, metadataCollisions, uniqueRecords } = await classifyIncomingRecords(records);
  const quarantineTarget = duplicates.length > 0 || orphanedMetadataFiles.length > 0
    ? await nextQuarantineTarget()
    : undefined;
  const batchTarget = uniqueRecords.length > 0 ? await nextBatchTarget() : undefined;
  const definitions = await nameDefinitionsFor(uniqueRecords);
  await addGenerationContexts(uniqueRecords, definitions);
  const generatedNameCount = uniqueRecords.filter((record) => nameGenerationPolicy(record)).length;
  const usedNames = generatedNameCount > 0 ? await collectUsedImageStems() : new Set();
  const usedShortNames = generatedNameCount > 0 ? await collectUsedShortNames() : { en: new Set(), ja: new Set() };
  const imageMoves = [];
  const fileMoves = [];
  const fileWrites = [];
  const newDirectories = [];
  const mappings = [];
  const quarantineMappings = [];
  const quarantineSummary = [
    duplicates.length > 0
      ? `${duplicates.length} duplicate image${duplicates.length === 1 ? "" : "s"}`
      : undefined,
    orphanedMetadataFiles.length > 0
      ? `${orphanedMetadataFiles.length} orphan source JSON file${orphanedMetadataFiles.length === 1 ? "" : "s"}`
      : undefined,
  ].filter(Boolean).join(" and ");
  let metadataCount = 0;
  let renamedCount = 0;

  if (quarantineTarget) {
    newDirectories.push(quarantineTarget.quarantineDirectory);
    for (const orphanedMetadataFile of orphanedMetadataFiles) {
      const orphanedMetadataName = path.basename(orphanedMetadataFile);
      fileMoves.push({
        sourcePath: path.join(galleryRoot, orphanedMetadataFile),
        targetPath: path.join(quarantineTarget.quarantineDirectory, orphanedMetadataName),
      });
      quarantineMappings.push(
        `- ${orphanedMetadataFile} -> ${quarantineTarget.quarantineRelativeDirectory}/ ` +
        "(orphan source JSON; no same-name image)",
      );
    }
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
      if (duplicate.record.nameMetadataName) {
        fileMoves.push({
          sourcePath: path.join(duplicate.record.directory, duplicate.record.nameMetadataName),
          targetPath: path.join(quarantineTarget.quarantineDirectory, duplicate.record.nameMetadataName),
        });
        metadataMapping += ` + ${duplicate.record.nameMetadataName}`;
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
    const policy = nameGenerationPolicy(record);
    const generated = generateNameForRecord(record, definitions, usedNames, usedShortNames);
    const targetStem = generated?.fileStem ?? sourceStem;
    const imageTargetName = `${targetStem}${path.extname(record.imageName)}`;
    const sourcePath = path.join(galleryRoot, record.imageName);
    const targetPath = path.join(batchTarget.batchDirectory, imageTargetName);
    const sourceRelativePath = relativeGalleryPath(sourcePath);
    const targetRelativePath = `${batchTarget.batchName}/${imageTargetName}`;
    if (record.imageName !== imageTargetName) renamedCount += 1;
    imageMoves.push({ sourcePath, targetPath, sourceRelativePath, targetRelativePath });
    fileMoves.push({ sourcePath, targetPath });

    let metadataMapping = "";
    if (record.metadataName) {
      metadataCount += 1;
      const metadataTargetName = generated ? `${targetStem}.json` : record.metadataName;
      fileMoves.push({
        sourcePath: path.join(galleryRoot, record.metadataName),
        targetPath: path.join(batchTarget.batchDirectory, metadataTargetName),
      });
      metadataMapping = generated
        ? ` + ${record.metadataName} -> ${metadataTargetName}`
        : ` + ${record.metadataName}`;
    }
    let nameMetadataMapping = "";
    if (generated && policy.shortNames.length > 0) {
      const nameMetadataTargetName = `${targetStem}${nameMetadataSuffix}`;
      fileWrites.push({
        targetPath: path.join(batchTarget.batchDirectory, nameMetadataTargetName),
        contents: nameMetadataContents(record.sourceMetadataSchema, generated.generatorSchema, generated.shortName, generated.components),
      });
      nameMetadataMapping = ` + ${nameMetadataTargetName} (${Object.values(generated.shortName).join(" / ")})`;
    }
    mappings.push(generated
      ? `- ${record.imageName} -> ${imageTargetName}${metadataMapping}${nameMetadataMapping}`
      : `- ${record.imageName}${metadataMapping}`);
  }

  if (duplicates.length > 0 || orphanedMetadataFiles.length > 0) {
    console.log(
      `${dryRun ? "Would quarantine" : "Quarantining"} ${quarantineSummary} ` +
      `in ${quarantineTarget.quarantineRelativeDirectory}/`,
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
      `to ${batchTarget.batchName}/${generatedNameCount > 0 ? ` using generated names for ${generatedNameCount}` : ""}`,
    );
  } else {
    console.log("No unique images remain to batch.");
  }
  if (dryRun) {
    for (const mapping of mappings) console.log(mapping);
    printReport({
      added: uniqueRecords.length,
      renamed: renamedCount,
      generatedMetadataAdded: fileWrites.length,
      sourceMetadataPreserved: metadataCount,
      duplicatesQuarantined: duplicates.length,
      metadataCollisionsRetained: metadataCollisions.length,
    });
    return;
  }

  const createdCachePaths = await preparePreviewCopies(imageMoves);
  try {
    await executeMoves(fileMoves, newDirectories, fileWrites);
  } catch (error) {
    await Promise.all(createdCachePaths.map((filePath) => rm(filePath, { force: true })));
    throw error;
  }
  if (createdCachePaths.length > 0) {
    console.log(`Preserved ${createdCachePaths.length} cached preview${createdCachePaths.length === 1 ? "" : "s"}.`);
  }
  if (duplicates.length > 0 || orphanedMetadataFiles.length > 0) {
    console.log(`Quarantined ${quarantineSummary} in ${quarantineTarget.quarantineRelativeDirectory}/.`);
  }

  if (!batchTarget) {
    printReport({
      duplicatesQuarantined: duplicates.length,
      metadataCollisionsRetained: metadataCollisions.length,
    });
    return;
  }

  console.log(`Batch ${batchTarget.batchName}/ is ready.`);
  try {
    await cacheMissingPreviews(batchTarget.batchName);
  } catch (error) {
    console.error("The batch was organized successfully, but preview caching failed. Re-run ./process-batch.sh when the service is available.");
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
  printReport({
    added: uniqueRecords.length,
    renamed: renamedCount,
    generatedMetadataAdded: fileWrites.length,
    sourceMetadataPreserved: metadataCount,
    duplicatesQuarantined: duplicates.length,
    metadataCollisionsRetained: metadataCollisions.length,
  });
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

await validateBatchSchemas();

if (renameExisting) await renameExistingBatches();
else if (backfillNameMetadata) await backfillGeneratedNameMetadata();
else await processIncomingBatch();
