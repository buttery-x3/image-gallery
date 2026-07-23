import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { GalleryCategory, GalleryMetadata, GalleryMetadataDisplay } from "../shared/types.js";

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
  detect?: {
    requiredPaths: string[];
  };
  recordPath?: string;
  resolvedPrompt?: PathMapping;
  tags: Record<string, ValueMapping>;
  searchTokensPath?: string;
  facetsPath?: string;
  valueRules?: {
    trim?: boolean;
    omitEmpty?: boolean;
    omitContaining?: string[];
  };
}

export interface MetadataDefinitionRegistry {
  definitions: ReadonlyMap<string, MetadataDefinition>;
  enabledSchemas: ReadonlySet<string>;
  categories: ReadonlyMap<string, GalleryCategory>;
  displays: ReadonlyMap<string, {
    nameTag: string;
    subtitleTag?: string;
    subtitleUrlTag?: string;
  }>;
}

export interface NormalizedMetadataResult {
  schema?: string;
  supported: boolean;
  enabled: boolean;
  category?: GalleryCategory;
  metadata?: GalleryMetadata;
  metadataDisplay?: GalleryMetadataDisplay;
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
  if (!isRecord(value.tags)) throw new Error(`${source}.tags must be an object.`);

  let detect: MetadataDefinition["detect"];
  if (value.detect !== undefined) {
    if (!isRecord(value.detect) || !Array.isArray(value.detect.requiredPaths) || value.detect.requiredPaths.length === 0) {
      throw new Error(`${source}.detect.requiredPaths must be a non-empty array.`);
    }
    detect = {
      requiredPaths: value.detect.requiredPaths.map((entry, index) =>
        nonEmptyString(entry, `${source}.detect.requiredPaths.${index}`)
      ),
    };
    if (new Set(detect.requiredPaths).size !== detect.requiredPaths.length) {
      throw new Error(`${source}.detect.requiredPaths must not contain duplicates.`);
    }
  }

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
    ...(detect ? { detect } : {}),
    ...(value.recordPath === undefined ? {} : { recordPath: nonEmptyString(value.recordPath, `${source}.recordPath`) }),
    ...(resolvedPrompt ? { resolvedPrompt } : {}),
    tags,
    ...(value.searchTokensPath === undefined ? {} : {
      searchTokensPath: nonEmptyString(value.searchTokensPath, `${source}.searchTokensPath`),
    }),
    ...(value.facetsPath === undefined ? {} : {
      facetsPath: nonEmptyString(value.facetsPath, `${source}.facetsPath`),
    }),
    ...(valueRules ? { valueRules } : {}),
  };
}

export function loadMetadataDefinitions(
  directory: string,
  configuredSchemas?: Readonly<Record<string, {
    enabled: boolean;
    category?: GalleryCategory;
    display?: {
      nameTag: string;
      subtitleTag?: string;
      subtitleUrlTag?: string;
    };
  }>>,
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

  const enabledSchemas = configuredSchemas === undefined
    ? new Set(definitions.keys())
    : new Set(Object.entries(configuredSchemas).filter(([, schema]) => schema.enabled).map(([sourceSchema]) => sourceSchema));
  const categories = new Map<string, GalleryCategory>();
  const displays = new Map<string, {
    nameTag: string;
    subtitleTag?: string;
    subtitleUrlTag?: string;
  }>();
  for (const [sourceSchema, schemaConfig] of Object.entries(configuredSchemas ?? {})) {
    if (schemaConfig.category) categories.set(sourceSchema, schemaConfig.category);
    if (schemaConfig.display) displays.set(sourceSchema, schemaConfig.display);
  }
  for (const schema of enabledSchemas) {
    if (!definitions.has(schema)) throw new Error(`Enabled metadata schema ${schema} does not have a definition.`);
    const display = displays.get(schema);
    const definition = definitions.get(schema);
    if (display && definition) {
      for (const [field, tag] of Object.entries(display)) {
        if (!(tag in definition.tags)) {
          throw new Error(`Metadata schema ${schema} display.${field} references undeclared tag ${tag}.`);
        }
      }
    }
  }
  return { definitions, enabledSchemas, categories, displays };
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
  let located = locateMetadataRecord(parsed);
  let detectedWithoutMarker = false;
  if (!located.schema && isRecord(parsed)) {
    const detected = [...registry.definitions.values()].filter((definition) =>
      definition.detect?.requiredPaths.every((requiredPath) => valueAtPath(parsed, requiredPath) !== undefined)
    );
    if (detected.length === 1) {
      located = { schema: detected[0]!.schema, record: parsed };
      detectedWithoutMarker = true;
    }
  }
  if (!located.schema || !located.record) return { supported: false, enabled: false };
  const definition = registry.definitions.get(located.schema);
  if (!definition) return { schema: located.schema, supported: false, enabled: false };
  if (!registry.enabledSchemas.has(located.schema)) {
    return { schema: located.schema, supported: true, enabled: false };
  }

  const record = definition.recordPath
    ? valueAtPath(parsed, definition.recordPath)
    : located.record;
  if (!isRecord(record) || (!detectedWithoutMarker && record.schema !== definition.schema)) {
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
    if (Array.isArray(tokenRecord)) {
      const tokens = tokenRecord.flatMap((value) => {
        const normalized = normalizedString(value, definition);
        return normalized === undefined ? [] : [normalized];
      });
      if (tokens.length > 0) {
        searchTokens[definition.searchTokensPath.split(".").at(-1)!] = tokens;
      }
    } else if (isRecord(tokenRecord)) {
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
  const category = registry.categories.get(definition.schema);
  const displayConfig = registry.displays.get(definition.schema);
  const displayName = displayConfig ? tags[displayConfig.nameTag] : undefined;
  const subtitle = displayConfig?.subtitleTag ? tags[displayConfig.subtitleTag] : undefined;
  const configuredSubtitleUrl = displayConfig?.subtitleUrlTag ? tags[displayConfig.subtitleUrlTag] : undefined;
  let subtitleUrl: string | undefined;
  if (configuredSubtitleUrl) {
    try {
      const candidate = new URL(configuredSubtitleUrl);
      if (candidate.protocol === "http:" || candidate.protocol === "https:") subtitleUrl = candidate.href;
    } catch {
      // An invalid or unsafe link remains available as a tag but is not rendered as a link.
    }
  }

  const facets: Record<string, string[]> = {};
  if (definition.facetsPath) {
    const facetValues = valueAtPath(record, definition.facetsPath);
    if (Array.isArray(facetValues)) {
      const values = [...new Set(facetValues.flatMap((value) => {
        const normalized = normalizedString(value, definition);
        return normalized === undefined ? [] : [normalized];
      }))];
      if (values.length > 0) facets[definition.facetsPath.split(".").at(-1)!] = values;
    }
  }
  const metadataDisplay = displayName ? {
    name: displayName,
    ...(subtitle ? { subtitle } : {}),
    ...(subtitleUrl ? { subtitleUrl } : {}),
  } : undefined;
  return {
    schema: definition.schema,
    supported: true,
    enabled: true,
    ...(category ? { category } : {}),
    ...(metadataDisplay ? { metadataDisplay } : {}),
    metadata: {
      schema: definition.schema,
      ...(category ? { category } : {}),
      resolvedPrompt,
      tags,
      searchTokens,
      facets,
    },
  };
}
