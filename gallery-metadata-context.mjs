import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function validateCondition(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const equals = value.equals;
  if (equals !== null && !["string", "number", "boolean"].includes(typeof equals)) {
    throw new Error(`${label}.equals must be a scalar value.`);
  }
  return { path: nonEmptyString(value.path, `${label}.path`), equals };
}

function validateMapping(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if ("path" in value) {
    return {
      path: nonEmptyString(value.path, `${label}.path`),
      ...(value.excludeWhen === undefined ? {} : { excludeWhen: validateCondition(value.excludeWhen, `${label}.excludeWhen`) }),
    };
  }
  if (isRecord(value.select)) {
    if (!isRecord(value.select.cases) || Object.keys(value.select.cases).length === 0) {
      throw new Error(`${label}.select.cases must contain at least one mapping.`);
    }
    const cases = {};
    for (const [key, mappedPath] of Object.entries(value.select.cases)) {
      cases[key] = nonEmptyString(mappedPath, `${label}.select.cases.${key}`);
    }
    return { select: { path: nonEmptyString(value.select.path, `${label}.select.path`), cases } };
  }
  throw new Error(`${label} must define path or select.`);
}

export function validateMetadataContextDefinition(value, source = "Metadata definition") {
  if (!isRecord(value)) throw new Error(`${source} must contain a JSON object.`);
  if (value.definitionVersion !== 1) throw new Error(`${source}.definitionVersion must be 1.`);
  if (value.draft !== undefined && typeof value.draft !== "boolean") {
    throw new Error(`${source}.draft must be true or false.`);
  }
  const schema = nonEmptyString(value.schema, `${source}.schema`);
  if (!isRecord(value.tags)) throw new Error(`${source}.tags must be an object.`);
  let detect;
  if (value.detect !== undefined) {
    if (
      !isRecord(value.detect) || !Array.isArray(value.detect.requiredPaths) ||
      value.detect.requiredPaths.length === 0
    ) throw new Error(`${source}.detect.requiredPaths must be a non-empty array.`);
    detect = {
      requiredPaths: value.detect.requiredPaths.map((entry, index) =>
        nonEmptyString(entry, `${source}.detect.requiredPaths.${index}`)
      ),
    };
    if (new Set(detect.requiredPaths).size !== detect.requiredPaths.length) {
      throw new Error(`${source}.detect.requiredPaths must not contain duplicates.`);
    }
  }
  const tags = {};
  for (const [tag, mapping] of Object.entries(value.tags)) {
    if (!/^[a-z][a-z0-9_]*$/.test(tag)) throw new Error(`${source}.tags.${tag} is not a canonical tag name.`);
    tags[tag] = validateMapping(mapping, `${source}.tags.${tag}`);
  }
  let resolvedPrompt;
  if (value.resolvedPrompt !== undefined) {
    resolvedPrompt = validateMapping(value.resolvedPrompt, `${source}.resolvedPrompt`);
    if (!("path" in resolvedPrompt)) throw new Error(`${source}.resolvedPrompt must use a path mapping.`);
  }
  let valueRules;
  if (value.valueRules !== undefined) {
    if (!isRecord(value.valueRules)) throw new Error(`${source}.valueRules must be an object.`);
    if (value.valueRules.omitContaining !== undefined && (
      !Array.isArray(value.valueRules.omitContaining) || value.valueRules.omitContaining.some((item) => typeof item !== "string")
    )) throw new Error(`${source}.valueRules.omitContaining must be an array of strings.`);
    valueRules = {
      trim: value.valueRules.trim === true,
      omitEmpty: value.valueRules.omitEmpty === true,
      ...(value.valueRules.omitContaining ? { omitContaining: [...value.valueRules.omitContaining] } : {}),
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

function valueAtPath(value, dottedPath) {
  let current = value;
  for (const segment of dottedPath.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function mappedValue(record, mapping) {
  if (!isRecord(mapping)) return undefined;
  if (typeof mapping.path === "string") {
    if (
      isRecord(mapping.excludeWhen) && typeof mapping.excludeWhen.path === "string" &&
      valueAtPath(record, mapping.excludeWhen.path) === mapping.excludeWhen.equals
    ) return undefined;
    return valueAtPath(record, mapping.path);
  }
  if (isRecord(mapping.select) && typeof mapping.select.path === "string" && isRecord(mapping.select.cases)) {
    const selector = valueAtPath(record, mapping.select.path);
    const selectedPath = typeof selector === "string" ? mapping.select.cases[selector] : undefined;
    return typeof selectedPath === "string" ? valueAtPath(record, selectedPath) : undefined;
  }
  return undefined;
}

function normalizedString(value, rules) {
  if (typeof value !== "string") return undefined;
  const result = rules?.trim === true ? value.trim() : value;
  if (rules?.omitEmpty === true && !result) return undefined;
  if (Array.isArray(rules?.omitContaining) && rules.omitContaining.some((marker) =>
    typeof marker === "string" && result.includes(marker)
  )) return undefined;
  return result || undefined;
}

export function extractMetadataContext(parsed, definition) {
  const record = definition.recordPath ? valueAtPath(parsed, definition.recordPath) : parsed;
  const detected = definition.detect?.requiredPaths.every((requiredPath) => valueAtPath(parsed, requiredPath) !== undefined);
  if (!isRecord(record) || (record.schema !== definition.schema && !detected)) return {};
  const context = {};
  for (const [tag, mapping] of Object.entries(definition.tags)) {
    const value = normalizedString(mappedValue(record, mapping), definition.valueRules);
    if (value !== undefined) context[tag] = value;
  }
  return context;
}

export async function loadMetadataContextDefinitions(directory, requestedSchemas, options = {}) {
  if (requestedSchemas.size === 0 && options.validateAll !== true) return new Map();
  const definitions = new Map();
  const parseErrors = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(path.join(directory, entry.name), "utf8"));
    } catch (error) {
      parseErrors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const rawSchema = isRecord(parsed) && typeof parsed.schema === "string" ? parsed.schema.trim() : "";
    if (options.validateAll !== true && !requestedSchemas.has(rawSchema)) continue;
    let definition;
    try {
      definition = validateMetadataContextDefinition(parsed, entry.name);
    } catch (error) {
      throw new Error(`Invalid metadata definition ${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (definition.draft) continue;
    if (definitions.has(definition.schema)) throw new Error(`Metadata schema ${definition.schema} is defined more than once.`);
    definitions.set(definition.schema, definition);
  }
  if (options.validateAll === true && parseErrors.length > 0) {
    throw new Error(`Invalid metadata definition JSON: ${parseErrors.join("; ")}`);
  }
  for (const schema of requestedSchemas) {
    if (definitions.has(schema)) continue;
    const hint = parseErrors.length > 0 ? ` Unreadable definitions: ${parseErrors.join("; ")}` : "";
    throw new Error(options.validateAll === true
      ? `Configured metadata schema ${schema} does not have a valid definition in ${directory}.${hint}`
      : `Contextual name generation requires metadata definition ${schema}.${hint}`);
  }
  return definitions;
}
