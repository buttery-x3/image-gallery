import { access, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { generateName, loadNameGenerationDefinitions, validateNameGenerationDefinition } from "./gallery-name-generator.mjs";
import { extractMetadataContext, loadMetadataContextDefinitions } from "./gallery-metadata-context.mjs";

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const definitionPath = option("--definition");
const sourceSchema = option("--attach-to");
const pipeline = option("--pipeline");
const samplePath = option("--sample");
const sampleDirectory = option("--sample-dir");
const shortNamesOption = option("--short-names");
const previewOption = option("--preview") ?? "5";
const knownOptions = new Set(["--definition", "--attach-to", "--pipeline", "--sample", "--sample-dir", "--short-names", "--preview"]);
const unknownOptions = args.filter((argument, index) =>
  argument.startsWith("--") && (!knownOptions.has(argument) || index === args.length - 1)
);
const shortNames = shortNamesOption === undefined || shortNamesOption === ""
  ? []
  : shortNamesOption.split(",").map((value) => value.trim()).filter(Boolean);
const previewCount = Number(previewOption);

if (
  !definitionPath || unknownOptions.length > 0 || !Number.isInteger(previewCount) || previewCount < 0 || previewCount > 25 ||
  shortNames.some((representation) => representation !== "en" && representation !== "ja") ||
  new Set(shortNames).size !== shortNames.length || (pipeline !== undefined && pipeline !== "contextual/v1") ||
  (samplePath && sampleDirectory) || ((samplePath || sampleDirectory) && !sourceSchema)
) {
  console.error("Usage:");
  console.error("  npm run process-new-name-schema -- --definition <definition.json> [--short-names en,ja] [--preview <0-25>]");
  console.error("  npm run process-new-name-schema -- --definition <definition.json> --attach-to <source-schema> [--pipeline contextual/v1] [--short-names en,ja] [--sample <json> | --sample-dir <dir>] [--preview <0-25>]");
  process.exit(2);
}

async function parseJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function writeAtomic(filePath, contents) {
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

const projectRoot = path.resolve(process.cwd());
const galleryRoot = path.join(projectRoot, "gallery");
const definitionsDirectory = path.join(projectRoot, "name-generation-schemas");
const metadataDefinitionsDirectory = path.join(projectRoot, "metadata-schemas");
const absoluteDefinitionPath = path.resolve(definitionPath);
const relativeToGallery = path.relative(galleryRoot, absoluteDefinitionPath);
if (relativeToGallery === "" || (!relativeToGallery.startsWith("..") && !path.isAbsolute(relativeToGallery))) {
  throw new Error("Name generation definitions cannot be read from or written inside gallery/.");
}

const rawDefinition = await parseJson(absoluteDefinitionPath);
let definition;
if (rawDefinition?.engine === "pipeline/v1") {
  if (path.dirname(absoluteDefinitionPath) !== definitionsDirectory) {
    throw new Error(`Move pipeline definitions into ${definitionsDirectory} so their component dependencies can be resolved.`);
  }
  const schema = typeof rawDefinition.schema === "string" ? rawDefinition.schema.trim() : "";
  definition = (await loadNameGenerationDefinitions(definitionsDirectory, new Map([[schema, shortNames]]))).get(schema);
} else {
  definition = validateNameGenerationDefinition(rawDefinition, shortNames);
}
if (definition.engine === "pipeline/v1" && sourceSchema && pipeline !== "contextual/v1") {
  throw new Error("Pipeline definitions must be attached with --pipeline contextual/v1.");
}
if (definition.engine !== "pipeline/v1" && pipeline !== undefined) {
  throw new Error("--pipeline contextual/v1 can only attach a pipeline/v1 definition.");
}
console.log(`Validated ${definition.schema} for filename generation${shortNames.length > 0 ? ` and ${shortNames.join("/")} short names` : ""}.`);

async function collectJsonFiles(directory) {
  const files = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && entry.name.endsWith(".json") && !entry.name.endsWith(".gallery-name.json")) files.push(absolutePath);
    }
  }
  await walk(directory);
  return files;
}

let previewContexts = [];
if (samplePath || sampleDirectory) {
  const metadataDefinition = (await loadMetadataContextDefinitions(
    metadataDefinitionsDirectory,
    new Set([sourceSchema]),
  )).get(sourceSchema);
  const files = samplePath ? [path.resolve(samplePath)] : await collectJsonFiles(path.resolve(sampleDirectory));
  for (const file of files) {
    const context = extractMetadataContext(await parseJson(file), metadataDefinition);
    if (Object.keys(context).length > 0) previewContexts.push({ file, context });
  }
  if (previewContexts.length === 0) throw new Error(`No samples matched ${sourceSchema}.`);
  console.log(`Loaded contextual tags from ${previewContexts.length} matching metadata sample${previewContexts.length === 1 ? "" : "s"}.`);
}

if (previewCount > 0) {
  console.log("Preview:");
  const usedNames = new Set();
  const usedShortNames = { en: new Set(), ja: new Set() };
  for (let index = 0; index < previewCount; index += 1) {
    const contextualSample = previewContexts.length > 0 ? previewContexts[index % previewContexts.length] : undefined;
    const generated = generateName(definition, shortNames, usedNames, usedShortNames, contextualSample?.context);
    const suffix = generated.shortName ? ` (${Object.values(generated.shortName).join(" / ")})` : "";
    const source = contextualSample ? ` <= ${path.basename(contextualSample.file)}` : "";
    console.log(`- ${generated.fileStem}${suffix}${source}`);
  }
}

if (sourceSchema) {
  if (path.dirname(absoluteDefinitionPath) !== definitionsDirectory) {
    throw new Error(`Move the definition into ${definitionsDirectory} before attaching it.`);
  }
  const configPath = path.join(projectRoot, "gallery.config.json");
  if (!await access(configPath).then(() => true, () => false)) throw new Error("gallery.config.json was not found.");
  const config = await parseJson(configPath);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("gallery.config.json must contain an object.");
  const metadata = config.metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("gallery.config.json metadata.schemas must be configured before attaching name generation.");
  }
  if (metadata.enabledSchemas !== undefined) throw new Error("Migrate metadata.enabledSchemas to metadata.schemas before attaching name generation.");
  const schemas = metadata.schemas;
  if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) {
    throw new Error("gallery.config.json metadata.schemas must be an object.");
  }
  const sourcePolicy = schemas[sourceSchema];
  if (!sourcePolicy || typeof sourcePolicy !== "object" || Array.isArray(sourcePolicy)) {
    throw new Error(`Source metadata schema ${sourceSchema} is not configured in gallery.config.json.`);
  }
  if (sourcePolicy.enabled !== true) throw new Error(`Source metadata schema ${sourceSchema} must be enabled before name generation can be attached.`);
  schemas[sourceSchema] = {
    ...sourcePolicy,
    nameGeneration: { definition: definition.schema, ...(pipeline ? { pipeline } : {}), shortNames },
  };
  await writeAtomic(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Attached ${definition.schema} to ${sourceSchema} in gallery.config.json.`);
}
