import { randomInt } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const supportedRepresentations = new Set(["en", "ja"]);

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value.trim();
}

function separator(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item)) {
    throw new Error(`${label} must be a non-empty array of strings.`);
  }
  return [...value];
}

function integer(value, label, minimum = 0) {
  if (!Number.isInteger(value) || value < minimum) throw new Error(`${label} must be an integer of at least ${minimum}.`);
  return value;
}

function range(value, label) {
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`${label} must be a two-item range.`);
  const minimum = integer(value[0], `${label}[0]`, 1);
  const maximum = integer(value[1], `${label}[1]`, minimum);
  if (maximum < minimum) throw new Error(`${label} maximum must not be below its minimum.`);
  return [minimum, maximum];
}

function moraParser(mora) {
  const moraByLength = [...mora].sort((left, right) => right.length - left.length);
  return (value) => {
    const normalized = value.toLocaleLowerCase("en-US");
    const result = [];
    let offset = 0;
    while (offset < normalized.length) {
      const match = moraByLength.find((candidate) => normalized.startsWith(candidate, offset));
      if (!match) throw new Error(`Could not parse generated name at "${normalized.slice(offset)}".`);
      result.push(match);
      offset += match.length;
    }
    return result;
  };
}

export function validateNameGenerationDefinition(value, requestedRepresentations = []) {
  if (!isRecord(value)) throw new Error("Name generation definition must contain an object.");
  if (value.definitionVersion !== 1) throw new Error("Name generation definitionVersion must be 1.");
  const schema = requiredString(value.schema, "Name generation schema");
  if (value.engine !== "mora-pair/v1") throw new Error(`${schema} uses unsupported engine ${String(value.engine)}.`);
  for (const representation of requestedRepresentations) {
    if (!supportedRepresentations.has(representation)) throw new Error(`${schema} does not support requested representation ${representation}.`);
  }
  if (new Set(requestedRepresentations).size !== requestedRepresentations.length) {
    throw new Error(`${schema} requested representations must not contain duplicates.`);
  }

  if (!isRecord(value.fileName)) throw new Error(`${schema}.fileName must be an object.`);
  const partSeparator = separator(value.fileName.partSeparator, `${schema}.fileName.partSeparator`);
  if (!/^[0-9_-]+$/.test(partSeparator)) throw new Error(`${schema} filename separator must be filesystem-safe and distinct from mora text.`);
  const givenMiddleCount = integer(value.fileName.givenMiddleCount, `${schema}.fileName.givenMiddleCount`);
  const familyMiddleCount = integer(value.fileName.familyMiddleCount, `${schema}.fileName.familyMiddleCount`);

  if (!isRecord(value.mora)) throw new Error(`${schema}.mora must be an object.`);
  const middle = stringArray(value.mora.middle, `${schema}.mora.middle`);
  const common = stringArray(value.mora.common, `${schema}.mora.common`);
  if (middle.some((item) => !/^[a-z]+$/.test(item))) throw new Error(`${schema}.mora.middle must contain lowercase ASCII mora.`);
  if (value.mora.initialExcluded !== undefined && (
    !Array.isArray(value.mora.initialExcluded) || value.mora.initialExcluded.some((item) => typeof item !== "string")
  )) throw new Error(`${schema}.mora.initialExcluded must be an array of strings.`);
  const initialExcluded = value.mora.initialExcluded ?? [];
  const ending = stringArray(value.mora.ending, `${schema}.mora.ending`);
  if (common.some((item) => !middle.includes(item))) throw new Error(`${schema}.mora.common must be a subset of middle.`);
  if (initialExcluded.some((item) => !middle.includes(item))) throw new Error(`${schema}.mora.initialExcluded must be a subset of middle.`);
  const initial = middle.filter((item) => !initialExcluded.includes(item));
  if (initial.length === 0) throw new Error(`${schema} has no available initial mora.`);
  if (common.some((item) => !initial.includes(item))) throw new Error(`${schema}.mora.common cannot include an excluded initial mora.`);
  const splitMora = moraParser(middle);
  for (const valueToParse of ending) splitMora(valueToParse);

  if (!isRecord(value.weights)) throw new Error(`${schema}.weights must be an object.`);
  const middleCommon = integer(value.weights.middleCommon, `${schema}.weights.middleCommon`, 1);
  const initialCommon = integer(value.weights.initialCommon, `${schema}.weights.initialCommon`, 1);

  const representations = {};
  if (requestedRepresentations.includes("en")) {
    if (!isRecord(value.representations?.en)) throw new Error(`${schema} is missing requested English representation rules.`);
    if (typeof value.representations.en.capitalizeParts !== "boolean") {
      throw new Error(`${schema}.representations.en.capitalizeParts must be true or false.`);
    }
    representations.en = {
      partSeparator: separator(value.representations.en.partSeparator, `${schema}.representations.en.partSeparator`),
      capitalizeParts: value.representations.en.capitalizeParts === true,
      givenMoraRange: range(value.representations.en.givenMoraRange, `${schema}.representations.en.givenMoraRange`),
      familyMoraRange: range(value.representations.en.familyMoraRange, `${schema}.representations.en.familyMoraRange`),
    };
  }
  if (requestedRepresentations.includes("ja")) {
    if (!isRecord(value.representations?.ja)) throw new Error(`${schema} is missing requested Japanese representation rules.`);
    if (value.representations.ja.script !== "katakana") throw new Error(`${schema}.representations.ja.script must be katakana.`);
    const katakana = value.mora.katakana;
    if (!isRecord(katakana)) throw new Error(`${schema}.mora.katakana is required for Japanese names.`);
    for (const mora of middle) {
      if (typeof katakana[mora] !== "string" || !katakana[mora]) throw new Error(`${schema} has no Japanese representation for mora "${mora}".`);
    }
    representations.ja = {
      partSeparator: separator(value.representations.ja.partSeparator, `${schema}.representations.ja.partSeparator`),
      katakana: { ...katakana },
    };
  }

  return {
    definitionVersion: 1,
    schema,
    engine: "mora-pair/v1",
    fileName: { partSeparator, givenMiddleCount, familyMiddleCount },
    representations,
    mora: { middle, common, initial, ending },
    weights: { middleCommon, initialCommon },
    splitMora,
  };
}

export async function loadNameGenerationDefinitions(directory, requestedBySchema) {
  if (requestedBySchema.size === 0) return new Map();
  const parsedBySchema = new Map();
  const parseErrors = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || !entry.isFile() || path.extname(entry.name).toLowerCase() !== ".json") continue;
    const filePath = path.join(directory, entry.name);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      parseErrors.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    const schema = isRecord(parsed) && typeof parsed.schema === "string" ? parsed.schema.trim() : "";
    if (!schema || !requestedBySchema.has(schema)) continue;
    if (parsedBySchema.has(schema)) throw new Error(`Name generation schema ${schema} is defined more than once.`);
    parsedBySchema.set(schema, parsed);
  }

  const definitions = new Map();
  for (const [schema, representations] of requestedBySchema) {
    const parsed = parsedBySchema.get(schema);
    if (!parsed) {
      const parseHint = parseErrors.length > 0 ? ` Unreadable definitions: ${parseErrors.join("; ")}` : "";
      throw new Error(`Configured name generation schema ${schema} was not found in ${directory}.${parseHint}`);
    }
    definitions.set(schema, validateNameGenerationDefinition(parsed, representations));
  }
  return definitions;
}

function pick(values, previous) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = values[randomInt(values.length)];
    const consecutiveComplexMora = candidate.length > 3 && (previous?.length ?? 0) > 3;
    if (candidate !== previous && !consecutiveComplexMora && !(candidate.length === 1 && previous?.length === 1)) return candidate;
  }
  return values[randomInt(values.length)];
}

function namePart(definition, middleCount, weightedInitial, weightedMiddle) {
  const selected = [pick(weightedInitial)];
  for (let index = 0; index < middleCount; index += 1) selected.push(pick(weightedMiddle, selected.at(-1)));
  selected.push(pick(definition.mora.ending, selected.at(-1)));
  return { filePart: selected.join(""), mora: selected.flatMap(definition.splitMora) };
}

function romanization(mora, capitalize) {
  const value = mora.join("");
  return capitalize ? value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1) : value;
}

function representationValues(definition, given, family, requestedRepresentations) {
  const values = {};
  if (requestedRepresentations.includes("en")) {
    const english = definition.representations.en;
    values.en = [romanization(given, english.capitalizeParts), romanization(family, english.capitalizeParts)].join(english.partSeparator);
  }
  if (requestedRepresentations.includes("ja")) {
    const japanese = definition.representations.ja;
    const render = (mora) => mora.map((part) => japanese.katakana[part]).join("");
    values.ja = [render(given), render(family)].join(japanese.partSeparator);
  }
  return values;
}

function lengthPairs(definition, requestedRepresentations) {
  const english = definition.representations.en;
  const givenRange = requestedRepresentations.includes("en") ? english.givenMoraRange : [1, 5];
  const familyRange = requestedRepresentations.includes("en") ? english.familyMoraRange : [2, 4];
  const pairs = [];
  for (let given = givenRange[0]; given <= givenRange[1]; given += 1) {
    for (let family = familyRange[0]; family <= familyRange[1]; family += 1) pairs.push({ given, family });
  }
  for (let index = pairs.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [pairs[index], pairs[swapIndex]] = [pairs[swapIndex], pairs[index]];
  }
  return pairs;
}

function availableShortName(definition, givenMora, familyMora, requestedRepresentations, usedShortNames) {
  for (const lengths of lengthPairs(definition, requestedRepresentations)) {
    if (givenMora.length < lengths.given || familyMora.length < lengths.family) continue;
    const values = representationValues(
      definition,
      givenMora.slice(0, lengths.given),
      familyMora.slice(0, lengths.family),
      requestedRepresentations,
    );
    const collides = requestedRepresentations.some((representation) =>
      usedShortNames[representation]?.has(values[representation].toLocaleLowerCase("en-US"))
    );
    if (collides) continue;
    return values;
  }
  return undefined;
}

export function generateName(definition, requestedRepresentations = [], usedNames = new Set(), usedShortNames = {}) {
  const weightedMiddle = [
    ...Array.from({ length: definition.weights.middleCommon }, () => definition.mora.common).flat(),
    ...definition.mora.middle,
  ];
  const weightedInitial = [
    ...Array.from({ length: definition.weights.initialCommon }, () => definition.mora.common).flat(),
    ...definition.mora.initial,
  ];
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const given = namePart(definition, definition.fileName.givenMiddleCount, weightedInitial, weightedMiddle);
    const family = namePart(definition, definition.fileName.familyMiddleCount, weightedInitial, weightedMiddle);
    const fileStem = `${given.filePart}${definition.fileName.partSeparator}${family.filePart}`;
    const comparisonName = fileStem.toLocaleLowerCase("en-US");
    if (usedNames.has(comparisonName)) continue;
    const shortName = requestedRepresentations.length > 0
      ? availableShortName(definition, given.mora, family.mora, requestedRepresentations, usedShortNames)
      : undefined;
    if (requestedRepresentations.length > 0 && !shortName) continue;
    usedNames.add(comparisonName);
    for (const representation of requestedRepresentations) {
      usedShortNames[representation] ??= new Set();
      usedShortNames[representation].add(shortName[representation].toLocaleLowerCase("en-US"));
    }
    return { fileStem, generatorSchema: definition.schema, ...(shortName ? { shortName } : {}) };
  }
  throw new Error(`Could not generate a unique name with ${definition.schema}.`);
}

export function generateShortNameForStem(definition, fileStem, requestedRepresentations = [], usedShortNames = {}) {
  const parts = fileStem.split(definition.fileName.partSeparator);
  if (parts.length !== 2 || parts.some((part) => !/^[a-z]+$/.test(part))) {
    throw new Error(`The filename stem is not a generated ${definition.schema} name.`);
  }
  const shortName = availableShortName(
    definition,
    definition.splitMora(parts[0]),
    definition.splitMora(parts[1]),
    requestedRepresentations,
    usedShortNames,
  );
  if (!shortName) throw new Error("Could not generate a unique short name for the filename stem.");
  for (const representation of requestedRepresentations) {
    usedShortNames[representation] ??= new Set();
    usedShortNames[representation].add(shortName[representation].toLocaleLowerCase("en-US"));
  }
  return shortName;
}
