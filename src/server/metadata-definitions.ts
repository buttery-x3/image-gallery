import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GalleryCategory, GalleryMetadata } from "../shared/types.js";

type Scalar = string | number | boolean | null;

interface DefinitionCondition {
  path: string;
  equals: Scalar;
}

interface PathMapping {
  path: string;
  excludeWhen?: DefinitionCondition;
}

interface SelectMapping {
  select: {
    path: string;
    cases: Record<string, string>;
  };
}

type ValueMapping = PathMapping | SelectMapping;

export interface MetadataDefinition {
  definitionVersion: 1;
  draft?: boolean;
  schema: string;
  category: GalleryCategory;
  recordPath?: string;
  resolvedPrompt?: PathMapping;
  tags: Record<string, ValueMapping>;
  searchTokensPath?: string;
  valueRules?: {
    trim?: boolean;
    omitEmpty?: boolean;
    omitContaining?: string[];
  };
}

export interface MetadataDefinitionRegistry {
  definitions: ReadonlyMap<string, MetadataDefinition>;
  enabledSchemas: ReadonlySet<string>;
}

export interface NormalizedMetadataResult {
  schema?: string;
  supported: boolean;
  enabled: boolean;
  category?: GalleryCategory;
  metadata?: GalleryMetadata;
}

export interface LocatedMetadataRecord {
  schema?: string;
  record?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function validateCondition(value: unknown, label: string): DefinitionCondition {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const conditionPath = nonEmptyString(value.path, `${label}.path`);
  const equals = value.equals;
  if (equals !== null && !["string", "number", "boolean"].includes(typeof equals)) {
    throw new Error(`${label}.equals must be a scalar value.`);
  }
  return { path: conditionPath, equals: equals as Scalar };
}

function validateMapping(value: unknown, label: string): ValueMapping {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if ("path" in value) {
    const mapping: PathMapping = { path: nonEmptyString(value.path, `${label}.path`) };
    if (value.excludeWhen !== undefined) mapping.excludeWhen = validateCondition(value.excludeWhen, `${label}.excludeWhen`);
    return mapping;
  }
  if (isRecord(value.select)) {
    const selectPath = nonEmptyString(value.select.path, `${label}.select.path`);
    if (!isRecord(value.select.cases) || Object.keys(value.select.cases).length === 0) {
      throw new Error(`${label}.select.cases must contain at least one mapping.`);
    }
    const cases: Record<string, string> = {};
    for (const [key, mappedPath] of Object.entries(value.select.cases)) {
      cases[key] = nonEmptyString(mappedPath, `${label}.select.cases.${key}`);
    }
    return { select: { path: selectPath, cases } };
  }
  throw new Error(`${label} must define path or select.`);
}

export function validateMetadataDefinition(value: unknown, source = "metadata definition"): MetadataDefinition {
  if (!isRecord(value)) throw new Error(`${source} must contain a JSON object.`);
  if (value.definitionVersion !== 1) throw new Error(`${source}.definitionVersion must be 1.`);
  if (value.draft !== undefined && typeof value.draft !== "boolean") throw new Error(`${source}.draft must be true or false.`);
  const schema = nonEmptyString(value.schema, `${source}.schema`);
  if (value.category !== "women" && value.category !== "creatures" && value.category !== "men") {
    throw new Error(`${source}.category must be women, creatures, or men.`);
  }
  if (!isRecord(value.tags)) throw new Error(`${source}.tags must be an object.`);

  const tags: Record<string, ValueMapping> = {};
  for (const [tag, mapping] of Object.entries(value.tags)) {
    if (!/^[a-z][a-z0-9_]*$/.test(tag)) throw new Error(`${source}.tags.${tag} is not a canonical tag name.`);
    tags[tag] = validateMapping(mapping, `${source}.tags.${tag}`);
  }

  let resolvedPrompt: PathMapping | undefined;
  if (value.resolvedPrompt !== undefined) {
    const mapping = validateMapping(value.resolvedPrompt, `${source}.resolvedPrompt`);
    if (!("path" in mapping)) throw new Error(`${source}.resolvedPrompt must use a path mapping.`);
    resolvedPrompt = mapping;
  }

  let valueRules: MetadataDefinition["valueRules"];
  if (value.valueRules !== undefined) {
    if (!isRecord(value.valueRules)) throw new Error(`${source}.valueRules must be an object.`);
    const omitContaining = value.valueRules.omitContaining;
    if (omitContaining !== undefined && (!Array.isArray(omitContaining) || omitContaining.some((item) => typeof item !== "string"))) {
      throw new Error(`${source}.valueRules.omitContaining must be an array of strings.`);
    }
    valueRules = {
      trim: value.valueRules.trim === true,
      omitEmpty: value.valueRules.omitEmpty === true,
      ...(omitContaining ? { omitContaining: [...omitContaining] as string[] } : {}),
    };
  }

  return {
    definitionVersion: 1,
    ...(value.draft === true ? { draft: true } : {}),
    schema,
    category: value.category,
    ...(value.recordPath === undefined ? {} : { recordPath: nonEmptyString(value.recordPath, `${source}.recordPath`) }),
    ...(resolvedPrompt ? { resolvedPrompt } : {}),
    tags,
    ...(value.searchTokensPath === undefined ? {} : {
      searchTokensPath: nonEmptyString(value.searchTokensPath, `${source}.searchTokensPath`),
    }),
    ...(valueRules ? { valueRules } : {}),
  };
}

export function loadMetadataDefinitions(
  directory: string,
  configuredEnabledSchemas?: readonly string[],
): MetadataDefinitionRegistry {
  const definitions = new Map<string, MetadataDefinition>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isFile() || path.extname(entry.name) !== ".json") continue;
    const filePath = path.join(directory, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (error) {
      throw new Error(`Could not parse metadata definition ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const definition = validateMetadataDefinition(parsed, entry.name);
    if (definition.draft) continue;
    if (definitions.has(definition.schema)) throw new Error(`Metadata schema ${definition.schema} is defined more than once.`);
    definitions.set(definition.schema, definition);
  }
  if (definitions.size === 0) throw new Error(`No metadata definitions were found in ${directory}.`);

  const enabledSchemas = configuredEnabledSchemas === undefined
    ? new Set(definitions.keys())
    : new Set(configuredEnabledSchemas);
  for (const schema of enabledSchemas) {
    if (!definitions.has(schema)) throw new Error(`Enabled metadata schema ${schema} does not have a definition.`);
  }
  return { definitions, enabledSchemas };
}

function valueAtPath(value: unknown, dottedPath: string): unknown {
  let current = value;
  for (const segment of dottedPath.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function locateMetadataRecord(parsed: unknown): LocatedMetadataRecord {
  if (!isRecord(parsed)) return {};
  if (typeof parsed.schema === "string" && parsed.schema.trim()) return { schema: parsed.schema.trim(), record: parsed };
  const matches = Object.values(parsed).filter(
    (candidate): candidate is Record<string, unknown> => isRecord(candidate) && typeof candidate.schema === "string" && Boolean(candidate.schema.trim()),
  );
  return matches.length === 1 ? { schema: (matches[0]!.schema as string).trim(), record: matches[0] } : {};
}

export function stringLeafPaths(value: unknown, prefix = ""): string[] {
  if (!isRecord(value)) return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (typeof child === "string") paths.push(childPath);
    else if (isRecord(child)) paths.push(...stringLeafPaths(child, childPath));
  }
  return paths;
}

function mappingValue(record: Record<string, unknown>, mapping: ValueMapping): unknown {
  if ("path" in mapping) {
    if (mapping.excludeWhen && valueAtPath(record, mapping.excludeWhen.path) === mapping.excludeWhen.equals) return undefined;
    return valueAtPath(record, mapping.path);
  }
  const selector = valueAtPath(record, mapping.select.path);
  if (typeof selector !== "string") return undefined;
  const selectedPath = mapping.select.cases[selector];
  return selectedPath ? valueAtPath(record, selectedPath) : undefined;
}

function normalizedString(value: unknown, definition: MetadataDefinition): string | undefined {
  if (typeof value !== "string") return undefined;
  const rules = definition.valueRules;
  const result = rules?.trim ? value.trim() : value;
  if (rules?.omitEmpty && !result) return undefined;
  if (rules?.omitContaining?.some((marker) => result.includes(marker))) return undefined;
  return result || undefined;
}

export function normalizeParsedMetadata(
  parsed: unknown,
  registry: MetadataDefinitionRegistry,
): NormalizedMetadataResult {
  const located = locateMetadataRecord(parsed);
  if (!located.schema || !located.record) return { supported: false, enabled: false };
  const definition = registry.definitions.get(located.schema);
  if (!definition) return { schema: located.schema, supported: false, enabled: false };
  if (!registry.enabledSchemas.has(located.schema)) {
    return { schema: located.schema, supported: true, enabled: false };
  }

  const record = definition.recordPath
    ? valueAtPath(parsed, definition.recordPath)
    : located.record;
  if (!isRecord(record) || record.schema !== definition.schema) {
    return { schema: located.schema, supported: true, enabled: true };
  }

  const tags: Record<string, string> = {};
  for (const [tag, mapping] of Object.entries(definition.tags)) {
    const value = normalizedString(mappingValue(record, mapping), definition);
    if (value !== undefined) tags[tag] = value;
  }

  const searchTokens: Record<string, string[]> = {};
  if (definition.searchTokensPath) {
    const tokenRecord = valueAtPath(record, definition.searchTokensPath);
    if (isRecord(tokenRecord)) {
      for (const [field, values] of Object.entries(tokenRecord)) {
        if (!Array.isArray(values)) continue;
        const tokens = values.flatMap((value) => {
          const normalized = normalizedString(value, definition);
          return normalized === undefined ? [] : [normalized];
        });
        if (tokens.length > 0) searchTokens[field] = tokens;
      }
    }
  }

  const resolvedPrompt = definition.resolvedPrompt
    ? normalizedString(mappingValue(record, definition.resolvedPrompt), definition) ?? ""
    : "";
  return {
    schema: definition.schema,
    supported: true,
    enabled: true,
    category: definition.category,
    metadata: {
      schema: definition.schema,
      category: definition.category,
      resolvedPrompt,
      tags,
      searchTokens,
    },
  };
}
