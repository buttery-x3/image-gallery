import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  locateMetadataRecord,
  normalizeParsedMetadata,
  stringLeafPaths,
  validateMetadataDefinition,
  type MetadataDefinitionRegistry,
} from "../server/metadata-definitions.js";
import type { GalleryCategory } from "../shared/types.js";

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
function hasFlag(name: string): boolean {
  return args.includes(name);
}

const samplePath = option("--sample");
const sampleDirectory = option("--sample-dir");
const definitionPath = option("--definition");
const outputPath = option("--output");
const category = option("--category") as GalleryCategory | undefined;
const typeLabel = option("--type-label")?.trim();
const scaffold = hasFlag("--scaffold");
const enable = hasFlag("--enable");

if (
  (samplePath && sampleDirectory) || (scaffold && (!samplePath || !outputPath)) ||
  (!scaffold && !definitionPath) || (!samplePath && !sampleDirectory) ||
  (category && !["women", "creatures", "men"].includes(category)) ||
  (args.includes("--type-label") && !typeLabel)
) {
  console.error("Usage:");
  console.error("  npm run process-new-schema -- --sample <json> --scaffold --output <definition.json>");
  console.error("  npm run process-new-schema -- --definition <definition.json> (--sample <json> | --sample-dir <dir>) [--enable] [--category <women|creatures|men>] [--type-label <label>]");
  process.exit(2);
}

const projectRoot = path.resolve(process.cwd());
const galleryRoot = path.join(projectRoot, "gallery");

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function parseJson(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sampleFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".json" && !entry.name.endsWith(".gallery-name.json")) {
        files.push(absolutePath);
      }
    }
  }
  await walk(directory);
  return files;
}

async function writeAtomic(filePath: string, contents: string, replaceExisting = false): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  if (!replaceExisting && await access(filePath).then(() => true, () => false)) {
    throw new Error(`Refusing to overwrite existing file: ${filePath}`);
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
  try {
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

if (scaffold) {
  const absoluteSamplePath = path.resolve(samplePath!);
  const parsed = await parseJson(absoluteSamplePath);
  const located = locateMetadataRecord(parsed);
  if (!located.schema || !located.record) throw new Error("The sample does not contain one unambiguous schema-bearing record.");
  const absoluteOutputPath = path.resolve(outputPath!);
  if (isInside(galleryRoot, absoluteOutputPath)) throw new Error("Schema definitions cannot be written inside gallery/.");
  const candidatePaths = stringLeafPaths(located.record).filter((candidate) => candidate !== "schema");
  const draft = {
    definitionVersion: 1,
    draft: true,
    schema: located.schema,
    ...(candidatePaths.includes("resolved_prompt") ? { resolvedPrompt: { path: "resolved_prompt" } } : {}),
    tags: {},
    valueRules: { trim: true, omitEmpty: true, omitContaining: ["@@"] },
    candidatePaths,
  };
  await writeAtomic(absoluteOutputPath, `${JSON.stringify(draft, null, 2)}\n`);
  console.log(`Created draft metadata definition at ${absoluteOutputPath}.`);
  console.log("Map the candidate paths into canonical tags and remove draft: true before enabling it.");
  process.exit(0);
}

const absoluteDefinitionPath = path.resolve(definitionPath!);
const definition = validateMetadataDefinition(await parseJson(absoluteDefinitionPath), path.basename(absoluteDefinitionPath));
const registry: MetadataDefinitionRegistry = {
  definitions: new Map([[definition.schema, definition]]),
  enabledSchemas: new Set([definition.schema]),
  categories: new Map(category ? [[definition.schema, category]] : []),
};
const files = samplePath ? [path.resolve(samplePath)] : await sampleFiles(path.resolve(sampleDirectory!));
if (files.length === 0) throw new Error("No JSON samples were found.");

let matched = 0;
const tagCounts = new Map<string, number>();
let firstPreview;
for (const file of files) {
  const parsed = await parseJson(file);
  const located = locateMetadataRecord(parsed);
  if (located.schema !== definition.schema) {
    if (samplePath) throw new Error(`${file} contains ${located.schema ?? "no detectable schema"}, not ${definition.schema}.`);
    continue;
  }
  const result = normalizeParsedMetadata(parsed, registry);
  if (!result.metadata) throw new Error(`${file} could not be normalized by ${definition.schema}.`);
  matched += 1;
  firstPreview ??= result.metadata;
  for (const tag of Object.keys(result.metadata.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
}
if (matched === 0) throw new Error(`No samples matched ${definition.schema}.`);

console.log(`Validated ${definition.schema} against ${matched} sample${matched === 1 ? "" : "s"}.`);
if (category) console.log(`Configured category: ${category}`);
if (typeLabel) console.log(`Configured type label: ${typeLabel}`);
console.log("Tag coverage:");
for (const [tag, count] of [...tagCounts].sort(([left], [right]) => left.localeCompare(right))) {
  console.log(`- ${tag}: ${count}/${matched}`);
}
console.log("Normalized preview:");
console.log(JSON.stringify(firstPreview, null, 2));

if (enable) {
  if (definition.draft) throw new Error("A draft definition cannot be enabled.");
  const configuredDefinitionsDirectory = path.join(projectRoot, "metadata-schemas");
  if (path.dirname(absoluteDefinitionPath) !== configuredDefinitionsDirectory) {
    throw new Error(`Move the definition into ${configuredDefinitionsDirectory} before enabling it.`);
  }
  const configPath = path.join(projectRoot, "gallery.config.json");
  const config = await parseJson(configPath);
  if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("gallery.config.json must contain an object.");
  const configRecord = config as Record<string, unknown>;
  const metadata = configRecord.metadata && typeof configRecord.metadata === "object" && !Array.isArray(configRecord.metadata)
    ? configRecord.metadata as Record<string, unknown>
    : {};
  if (metadata.enabledSchemas !== undefined) throw new Error("Migrate metadata.enabledSchemas to metadata.schemas before enabling a definition.");
  const schemas = metadata.schemas && typeof metadata.schemas === "object" && !Array.isArray(metadata.schemas)
    ? metadata.schemas as Record<string, unknown>
    : {};
  const existing = schemas[definition.schema] && typeof schemas[definition.schema] === "object" && !Array.isArray(schemas[definition.schema])
    ? schemas[definition.schema] as Record<string, unknown>
    : {};
  schemas[definition.schema] = {
    ...existing,
    enabled: true,
    ...(category ? { category } : {}),
    ...(typeLabel ? { typeLabel } : {}),
  };
  configRecord.metadata = { ...metadata, schemas };
  await writeAtomic(configPath, `${JSON.stringify(configRecord, null, 2)}\n`, true);
  console.log(`Enabled ${definition.schema} in gallery.config.json.`);
}
