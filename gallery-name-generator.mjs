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

function validateMoraPairDefinition(value, requestedRepresentations = []) {
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

function validateRequestedRepresentations(schema, requestedRepresentations) {
  for (const representation of requestedRepresentations) {
    if (!supportedRepresentations.has(representation)) throw new Error(`${schema} does not support requested representation ${representation}.`);
  }
  if (new Set(requestedRepresentations).size !== requestedRepresentations.length) {
    throw new Error(`${schema} requested representations must not contain duplicates.`);
  }
}

function validatePipelineToken(value, label, requestedRepresentations, japaneseField) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const en = requiredString(value.en, `${label}.en`);
  if (!/^[A-Za-z]+$/.test(en)) throw new Error(`${label}.en must contain ASCII letters only.`);
  let ja;
  if (requestedRepresentations.includes("ja")) ja = requiredString(value[japaneseField], `${label}.${japaneseField}`);
  return { en, ...(ja ? { [japaneseField]: ja } : {}) };
}

function validateContextualCompoundStage(value, label, requestedRepresentations) {
  if (!isRecord(value.context)) throw new Error(`${label}.context must be an object.`);
  const familyContext = requiredString(value.context.family, `${label}.context.family`);
  const speciesContext = requiredString(value.context.species, `${label}.context.species`);
  const traitContexts = stringArray(value.context.traits, `${label}.context.traits`);
  if (!isRecord(value.prefixes) || Object.keys(value.prefixes).length === 0) throw new Error(`${label}.prefixes must contain tokens.`);
  if (!isRecord(value.features) || Object.keys(value.features).length === 0) throw new Error(`${label}.features must contain tokens.`);
  const prefixes = {};
  for (const [id, token] of Object.entries(value.prefixes)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`${label}.prefixes.${id} must use a lowercase identifier.`);
    prefixes[id] = validatePipelineToken(token, `${label}.prefixes.${id}`, requestedRepresentations, "jaAttributive");
  }
  const features = {};
  for (const [id, token] of Object.entries(value.features)) {
    if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`${label}.features.${id} must use a lowercase identifier.`);
    features[id] = validatePipelineToken(token, `${label}.features.${id}`, requestedRepresentations, "jaNoun");
  }
  if (!isRecord(value.families) || Object.keys(value.families).length === 0) throw new Error(`${label}.families must contain pools.`);
  const families = {};
  for (const [familyId, familyValue] of Object.entries(value.families)) {
    const familyLabel = `${label}.families.${familyId}`;
    if (!isRecord(familyValue)) throw new Error(`${familyLabel} must be an object.`);
    const familyFeatures = stringArray(familyValue.features, `${familyLabel}.features`);
    const fallbackPrefixes = stringArray(familyValue.fallbackPrefixes, `${familyLabel}.fallbackPrefixes`);
    if (familyFeatures.some((id) => !features[id])) throw new Error(`${familyLabel}.features references an unknown feature.`);
    if (fallbackPrefixes.some((id) => !prefixes[id])) throw new Error(`${familyLabel}.fallbackPrefixes references an unknown prefix.`);
    const speciesFeatures = {};
    if (familyValue.speciesFeatures !== undefined) {
      if (!isRecord(familyValue.speciesFeatures)) throw new Error(`${familyLabel}.speciesFeatures must be an object.`);
      for (const [species, featureIds] of Object.entries(familyValue.speciesFeatures)) {
        const validated = stringArray(featureIds, `${familyLabel}.speciesFeatures.${species}`);
        if (validated.some((id) => !features[id])) throw new Error(`${familyLabel}.speciesFeatures.${species} references an unknown feature.`);
        speciesFeatures[species.toLocaleLowerCase("en-US")] = validated;
      }
    }
    families[familyId] = { features: familyFeatures, fallbackPrefixes, speciesFeatures };
  }
  if (!isRecord(value.familyAliases) || Object.keys(value.familyAliases).length === 0) throw new Error(`${label}.familyAliases must contain mappings.`);
  const familyAliases = {};
  for (const [sourceFamily, familyId] of Object.entries(value.familyAliases)) {
    if (typeof familyId !== "string" || !families[familyId]) throw new Error(`${label}.familyAliases.${sourceFamily} references an unknown family.`);
    familyAliases[sourceFamily.toLocaleLowerCase("en-US")] = familyId;
  }
  const defaultFamily = requiredString(value.defaultFamily, `${label}.defaultFamily`);
  if (!families[defaultFamily]) throw new Error(`${label}.defaultFamily references an unknown family.`);
  if (!Array.isArray(value.traitRules)) throw new Error(`${label}.traitRules must be an array.`);
  const traitRules = value.traitRules.map((rule, index) => {
    const ruleLabel = `${label}.traitRules[${index}]`;
    if (!isRecord(rule)) throw new Error(`${ruleLabel} must be an object.`);
    const context = requiredString(rule.context, `${ruleLabel}.context`);
    if (!traitContexts.includes(context)) throw new Error(`${ruleLabel}.context is not declared in context.traits.`);
    if (!isRecord(rule.values) || Object.keys(rule.values).length === 0) throw new Error(`${ruleLabel}.values must contain mappings.`);
    const values = {};
    for (const [sourceValue, prefixId] of Object.entries(rule.values)) {
      if (typeof prefixId !== "string" || !prefixes[prefixId]) throw new Error(`${ruleLabel}.values.${sourceValue} references an unknown prefix.`);
      values[sourceValue.toLocaleLowerCase("en-US")] = prefixId;
    }
    return { context, values, weight: integer(rule.weight ?? 1, `${ruleLabel}.weight`, 1) };
  });
  const fallbackWeight = integer(value.fallbackWeight ?? 1, `${label}.fallbackWeight`, 1);
  return {
    id: requiredString(value.id, `${label}.id`),
    type: "contextual-compound/v1",
    context: { family: familyContext, species: speciesContext, traits: traitContexts },
    prefixes,
    features,
    familyAliases,
    families,
    defaultFamily,
    traitRules,
    fallbackWeight,
  };
}

function validateContextualPoolStage(value, label, requestedRepresentations) {
  const contexts = stringArray(value.contexts, `${label}.contexts`);
  if (!isRecord(value.values)) throw new Error(`${label}.values must be an object.`);
  const validateTokens = (tokens, tokenLabel) => {
    if (!Array.isArray(tokens) || tokens.length === 0) throw new Error(`${tokenLabel} must be a non-empty array.`);
    return tokens.map((token, index) => {
      const validated = validatePipelineToken(token, `${tokenLabel}[${index}]`, requestedRepresentations, "ja");
      const stem = requiredString(token.stem, `${tokenLabel}[${index}].stem`);
      if (!/^[a-z0-9_-]+$/.test(stem)) throw new Error(`${tokenLabel}[${index}].stem must contain only lowercase ASCII letters, digits, underscores, or hyphens.`);
      return { stem, representations: { en: validated.en, ...(validated.ja ? { ja: validated.ja } : {}) } };
    });
  };
  const values = {};
  for (const [sourceValue, tokens] of Object.entries(value.values)) values[sourceValue.toLocaleLowerCase("en-US")] = validateTokens(tokens, `${label}.values.${sourceValue}`);
  return {
    id: requiredString(value.id, `${label}.id`),
    type: "contextual-pool/v1",
    contexts,
    values,
    fallback: validateTokens(value.fallback, `${label}.fallback`),
  };
}

function validatePipelineDefinition(value, requestedRepresentations, resolveDefinition) {
  const schema = requiredString(value.schema, "Name generation schema");
  validateRequestedRepresentations(schema, requestedRepresentations);
  if (!Array.isArray(value.stages) || value.stages.length < 2) throw new Error(`${schema}.stages must contain at least two stages.`);
  const stages = [];
  const stageIds = new Set();
  for (let index = 0; index < value.stages.length; index += 1) {
    const stage = value.stages[index];
    const label = `${schema}.stages[${index}]`;
    if (!isRecord(stage)) throw new Error(`${label} must be an object.`);
    let validated;
    if (stage.type === "generator-component/v1") {
      const id = requiredString(stage.id, `${label}.id`);
      const definitionSchema = requiredString(stage.definition, `${label}.definition`);
      if (stage.component !== "given" && stage.component !== "family") throw new Error(`${label}.component must be given or family.`);
      if (typeof resolveDefinition !== "function") throw new Error(`${schema} requires definition resolver support.`);
      const dependency = resolveDefinition(definitionSchema, [...new Set(["en", ...requestedRepresentations])]);
      if (dependency.engine !== "mora-pair/v1") throw new Error(`${label}.definition must use mora-pair/v1.`);
      validated = { id, type: stage.type, component: stage.component, definition: dependency };
    } else if (stage.type === "contextual-compound/v1") {
      validated = validateContextualCompoundStage(stage, label, requestedRepresentations);
    } else if (stage.type === "contextual-pool/v1") {
      validated = validateContextualPoolStage(stage, label, requestedRepresentations);
    } else if (stage.type === "compose-name/v1") {
      if (!Array.isArray(stage.components) || stage.components.length === 0 || stage.components.some((id) => typeof id !== "string")) {
        throw new Error(`${label}.components must be an array of stage IDs.`);
      }
      const representationSeparators = { en: separator(stage.representationSeparators?.en, `${label}.representationSeparators.en`) };
      if (requestedRepresentations.includes("ja")) representationSeparators.ja = separator(stage.representationSeparators?.ja, `${label}.representationSeparators.ja`);
      validated = {
        id: requiredString(stage.id, `${label}.id`),
        type: stage.type,
        components: [...stage.components],
        fileSeparator: separator(stage.fileSeparator, `${label}.fileSeparator`),
        representationSeparators,
      };
    } else {
      throw new Error(`${label} uses unsupported stage type ${String(stage.type)}.`);
    }
    if (stageIds.has(validated.id)) throw new Error(`${schema} defines stage ${validated.id} more than once.`);
    if (validated.type === "compose-name/v1" && validated.components.some((id) => !stageIds.has(id))) {
      throw new Error(`${label}.components must reference earlier stages.`);
    }
    stageIds.add(validated.id);
    stages.push(validated);
  }
  if (stages.at(-1)?.type !== "compose-name/v1") throw new Error(`${schema} must end with compose-name/v1.`);
  return { definitionVersion: 1, schema, engine: "pipeline/v1", stages };
}

export function validateNameGenerationDefinition(value, requestedRepresentations = [], options = {}) {
  if (!isRecord(value)) throw new Error("Name generation definition must contain an object.");
  if (value.definitionVersion !== 1) throw new Error("Name generation definitionVersion must be 1.");
  if (value.engine === "mora-pair/v1") return validateMoraPairDefinition(value, requestedRepresentations);
  if (value.engine === "pipeline/v1") return validatePipelineDefinition(value, requestedRepresentations, options.resolveDefinition);
  const schema = typeof value.schema === "string" ? value.schema : "Name generation definition";
  throw new Error(`${schema} uses unsupported engine ${String(value.engine)}.`);
}

export async function loadNameGenerationDefinitions(directory, requestedBySchema, options = {}) {
  if (requestedBySchema.size === 0 && options.validateAll !== true) return new Map();
  const parsedBySchema = new Map();
  const sourceBySchema = new Map();
  const duplicateSchemas = new Set();
  const parseErrors = [];
  const missingSchemaFiles = [];
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
    if (!schema) {
      if (options.validateAll === true) missingSchemaFiles.push(entry.name);
      continue;
    }
    if (parsedBySchema.has(schema)) duplicateSchemas.add(schema);
    parsedBySchema.set(schema, parsed);
    sourceBySchema.set(schema, entry.name);
  }

  if (options.validateAll === true && parseErrors.length > 0) {
    throw new Error(`Invalid name generation definition JSON: ${parseErrors.join("; ")}`);
  }
  if (options.validateAll === true && missingSchemaFiles.length > 0) {
    throw new Error(`Invalid name generation definition: ${missingSchemaFiles.join(", ")} must declare a non-empty schema.`);
  }
  if (options.validateAll === true && duplicateSchemas.size > 0) {
    throw new Error(`Name generation schema ${[...duplicateSchemas].join(", ")} is defined more than once.`);
  }

  const definitions = new Map();
  const validating = new Set();
  const resolveDefinition = (schema, representations) => {
    const cacheKey = `${schema}\0${[...representations].sort().join(",")}`;
    if (definitions.has(cacheKey)) return definitions.get(cacheKey);
    if (validating.has(cacheKey)) throw new Error(`Name generation definition dependency cycle includes ${schema}.`);
    if (duplicateSchemas.has(schema)) throw new Error(`Name generation schema ${schema} is defined more than once.`);
    const parsed = parsedBySchema.get(schema);
    if (!parsed) {
      const parseHint = parseErrors.length > 0 ? ` Unreadable definitions: ${parseErrors.join("; ")}` : "";
      throw new Error(`Configured name generation schema ${schema} was not found in ${directory}.${parseHint}`);
    }
    validating.add(cacheKey);
    try {
      let definition;
      try {
        definition = validateNameGenerationDefinition(parsed, representations, { resolveDefinition });
      } catch (error) {
        const source = sourceBySchema.get(schema) ?? schema;
        throw new Error(`Invalid name generation definition ${source}: ${error instanceof Error ? error.message : String(error)}`);
      }
      definitions.set(cacheKey, definition);
      return definition;
    } finally {
      validating.delete(cacheKey);
    }
  };
  if (options.validateAll === true) {
    for (const [schema, parsed] of parsedBySchema) {
      const declaredRepresentations = parsed.engine === "mora-pair/v1" && isRecord(parsed.representations)
        ? Object.keys(parsed.representations).filter((representation) => supportedRepresentations.has(representation))
        : [];
      resolveDefinition(schema, declaredRepresentations);
    }
  }
  const requestedDefinitions = new Map();
  for (const [schema, representations] of requestedBySchema) {
    requestedDefinitions.set(schema, resolveDefinition(schema, representations));
  }
  return requestedDefinitions;
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

function weightedMora(definition) {
  return {
    middle: [
      ...Array.from({ length: definition.weights.middleCommon }, () => definition.mora.common).flat(),
      ...definition.mora.middle,
    ],
    initial: [
      ...Array.from({ length: definition.weights.initialCommon }, () => definition.mora.common).flat(),
      ...definition.mora.initial,
    ],
  };
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

function generateMoraPairName(definition, requestedRepresentations, usedNames, usedShortNames) {
  const weighted = weightedMora(definition);
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const given = namePart(definition, definition.fileName.givenMiddleCount, weighted.initial, weighted.middle);
    const family = namePart(definition, definition.fileName.familyMiddleCount, weighted.initial, weighted.middle);
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

function generateMoraComponent(definition, component, requestedRepresentations) {
  const weighted = weightedMora(definition);
  const middleCount = component === "given" ? definition.fileName.givenMiddleCount : definition.fileName.familyMiddleCount;
  const rangeName = component === "given" ? "givenMoraRange" : "familyMoraRange";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const generated = namePart(definition, middleCount, weighted.initial, weighted.middle);
    const range = definition.representations.en[rangeName];
    const maximum = Math.min(range[1], generated.mora.length);
    if (maximum < range[0]) continue;
    const shortLength = randomInt(range[0], maximum + 1);
    const shortMora = generated.mora.slice(0, shortLength);
    const representations = { en: romanization(shortMora, definition.representations.en.capitalizeParts) };
    if (requestedRepresentations.includes("ja")) {
      representations.ja = shortMora.map((part) => definition.representations.ja.katakana[part]).join("");
    }
    return {
      stem: romanization(shortMora, false),
      representations,
      data: { fullStem: generated.filePart, mora: shortMora },
    };
  }
  throw new Error(`Could not generate ${component} component from ${definition.schema}.`);
}

function weightedChoice(values) {
  return values[randomInt(values.length)];
}

function generateContextualCompound(stage, requestedRepresentations, context) {
  const sourceFamily = typeof context?.[stage.context.family] === "string"
    ? context[stage.context.family].toLocaleLowerCase("en-US")
    : "";
  const familyId = stage.familyAliases[sourceFamily] ?? stage.defaultFamily;
  const family = stage.families[familyId];
  const species = typeof context?.[stage.context.species] === "string"
    ? context[stage.context.species].toLocaleLowerCase("en-US")
    : "";
  const featureIds = family.speciesFeatures[species] ?? family.features;
  const prefixCandidates = [];
  for (const rule of stage.traitRules) {
    const sourceValue = typeof context?.[rule.context] === "string"
      ? context[rule.context].toLocaleLowerCase("en-US")
      : "";
    const prefixId = rule.values[sourceValue];
    if (!prefixId) continue;
    for (let index = 0; index < rule.weight; index += 1) prefixCandidates.push({ id: prefixId, context: rule.context });
  }
  for (const prefixId of family.fallbackPrefixes) {
    for (let index = 0; index < stage.fallbackWeight; index += 1) prefixCandidates.push({ id: prefixId });
  }
  const selectedPrefix = weightedChoice(prefixCandidates);
  const featureId = weightedChoice(featureIds);
  const prefix = stage.prefixes[selectedPrefix.id];
  const feature = stage.features[featureId];
  const representations = { en: `${prefix.en}${feature.en.toLocaleLowerCase("en-US")}` };
  if (requestedRepresentations.includes("ja")) representations.ja = `${prefix.jaAttributive}${feature.jaNoun}`;
  return {
    stem: representations.en.toLocaleLowerCase("en-US"),
    representations,
    data: {
      family: familyId,
      prefix: selectedPrefix.id,
      feature: featureId,
      contextSources: [stage.context.family, ...(species ? [stage.context.species] : []), ...(selectedPrefix.context ? [selectedPrefix.context] : [])],
    },
  };
}

function generateContextualPool(stage, requestedRepresentations, context) {
  let candidates;
  let contextSource;
  for (const contextKey of stage.contexts) {
    const sourceValue = typeof context?.[contextKey] === "string" ? context[contextKey].toLocaleLowerCase("en-US") : "";
    if (!stage.values[sourceValue]) continue;
    candidates = stage.values[sourceValue];
    contextSource = contextKey;
    break;
  }
  const selected = weightedChoice(candidates ?? stage.fallback);
  return {
    stem: selected.stem,
    representations: Object.fromEntries(
      Object.entries(selected.representations).filter(([representation]) => representation === "en" || requestedRepresentations.includes(representation)),
    ),
    data: { ...(contextSource ? { contextSources: [contextSource] } : {}) },
  };
}

function generatePipelineCandidate(definition, requestedRepresentations, context) {
  const results = new Map();
  for (const stage of definition.stages) {
    if (stage.type === "generator-component/v1") {
      results.set(stage.id, generateMoraComponent(stage.definition, stage.component, requestedRepresentations));
    } else if (stage.type === "contextual-compound/v1") {
      results.set(stage.id, generateContextualCompound(stage, requestedRepresentations, context));
    } else if (stage.type === "contextual-pool/v1") {
      results.set(stage.id, generateContextualPool(stage, requestedRepresentations, context));
    } else if (stage.type === "compose-name/v1") {
      const components = stage.components.map((id) => results.get(id));
      const fileStem = components.map((component) => component.stem).join(stage.fileSeparator);
      const shortName = {};
      for (const representation of requestedRepresentations) {
        shortName[representation] = components.map((component) => component.representations[representation]).join(stage.representationSeparators[representation]);
      }
      return {
        fileStem,
        ...(requestedRepresentations.length > 0 ? { shortName } : {}),
        components: Object.fromEntries(stage.components.map((id) => [id, results.get(id).data])),
      };
    }
  }
  throw new Error(`${definition.schema} did not compose a name.`);
}

function generatePipelineName(definition, requestedRepresentations, usedNames, usedShortNames, context) {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const generated = generatePipelineCandidate(definition, requestedRepresentations, context);
    const comparisonName = generated.fileStem.toLocaleLowerCase("en-US");
    if (usedNames.has(comparisonName)) continue;
    if (requestedRepresentations.some((representation) =>
      usedShortNames[representation]?.has(generated.shortName[representation].toLocaleLowerCase("en-US"))
    )) continue;
    usedNames.add(comparisonName);
    for (const representation of requestedRepresentations) {
      usedShortNames[representation] ??= new Set();
      usedShortNames[representation].add(generated.shortName[representation].toLocaleLowerCase("en-US"));
    }
    return { ...generated, generatorSchema: definition.schema };
  }
  throw new Error(`Could not generate a unique name with ${definition.schema}.`);
}

export function generateName(
  definition,
  requestedRepresentations = [],
  usedNames = new Set(),
  usedShortNames = {},
  context = {},
) {
  if (definition.engine === "mora-pair/v1") return generateMoraPairName(definition, requestedRepresentations, usedNames, usedShortNames);
  if (definition.engine === "pipeline/v1") return generatePipelineName(definition, requestedRepresentations, usedNames, usedShortNames, context);
  throw new Error(`Unsupported name generation engine ${String(definition.engine)}.`);
}

export function generateShortNameForStem(definition, fileStem, requestedRepresentations = [], usedShortNames = {}) {
  if (definition.engine !== "mora-pair/v1") {
    throw new Error(`Backfill from filename is not supported for ${definition.engine}; generated component provenance is required.`);
  }
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
