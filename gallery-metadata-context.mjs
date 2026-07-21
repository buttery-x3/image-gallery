import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
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
  if (!isRecord(record) || record.schema !== definition.schema) return {};
  const context = {};
  for (const [tag, mapping] of Object.entries(definition.tags)) {
    const value = normalizedString(mappedValue(record, mapping), definition.valueRules);
    if (value !== undefined) context[tag] = value;
  }
  return context;
}

export async function loadMetadataContextDefinitions(directory, requestedSchemas) {
  if (requestedSchemas.size === 0) return new Map();
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
    const schema = isRecord(parsed) && typeof parsed.schema === "string" ? parsed.schema.trim() : "";
    if (!requestedSchemas.has(schema)) continue;
    if (definitions.has(schema)) throw new Error(`Metadata schema ${schema} is defined more than once.`);
    if (parsed.definitionVersion !== 1 || !isRecord(parsed.tags)) {
      throw new Error(`Metadata definition ${entry.name} cannot provide contextual name-generation tags.`);
    }
    definitions.set(schema, parsed);
  }
  for (const schema of requestedSchemas) {
    if (definitions.has(schema)) continue;
    const hint = parseErrors.length > 0 ? ` Unreadable definitions: ${parseErrors.join("; ")}` : "";
    throw new Error(`Contextual name generation requires metadata definition ${schema}.${hint}`);
  }
  return definitions;
}
