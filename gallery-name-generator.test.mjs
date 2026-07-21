import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  generateName,
  generateShortNameForStem,
  loadNameGenerationDefinitions,
  validateNameGenerationDefinition,
} from "./gallery-name-generator.mjs";

const definitionPath = new URL("./name-generation-schemas/waifu-japanese-fantasy-v1.json", import.meta.url);
const rawDefinition = JSON.parse(await readFile(definitionPath, "utf8"));
const creatureSchema = "image-gallery/name-generator/creature-byname/v1";
const rawCreatureDefinition = JSON.parse(await readFile(
  new URL("./name-generation-schemas/creature-byname-v1.json", import.meta.url),
  "utf8",
));
const creatureDefinition = (await loadNameGenerationDefinitions(
  fileURLToPath(new URL("./name-generation-schemas", import.meta.url)),
  new Map([[creatureSchema, ["en", "ja"]]]),
)).get(creatureSchema);

test("the existing waifu rules validate and generate both configured representations", () => {
  const definition = validateNameGenerationDefinition(rawDefinition, ["en", "ja"]);
  const generated = generateName(definition, ["en", "ja"], new Set(), { en: new Set(), ja: new Set() });
  assert.match(generated.fileStem, /^[a-z]+-[a-z]+$/);
  assert.match(generated.shortName.en, /^[A-Z]/);
  assert.match(generated.shortName.ja, /[\u30a0-\u30ff]/u);
});

test("unrequested representation rules are not required", () => {
  const fileOnly = structuredClone(rawDefinition);
  delete fileOnly.representations;
  delete fileOnly.mora.katakana;
  const definition = validateNameGenerationDefinition(fileOnly, []);
  const generated = generateName(definition);
  assert.equal(generated.shortName, undefined);
});

test("Japanese rules are blocking only when Japanese is requested", () => {
  const withoutJapanese = structuredClone(rawDefinition);
  delete withoutJapanese.representations.ja;
  delete withoutJapanese.mora.katakana;
  assert.doesNotThrow(() => validateNameGenerationDefinition(withoutJapanese, ["en"]));
  assert.throws(
    () => validateNameGenerationDefinition(withoutJapanese, ["ja"]),
    /missing requested Japanese representation rules/,
  );
});

test("a generated filename can be backfilled with only a newly requested representation", () => {
  const definition = validateNameGenerationDefinition(rawDefinition, ["ja"]);
  const generated = generateName(definition);
  const shortName = generateShortNameForStem(definition, generated.fileStem, ["ja"], { ja: new Set() });
  assert.deepEqual(Object.keys(shortName), ["ja"]);
  assert.match(shortName.ja, /[\u30a0-\u30ff]/u);
});

test("contextual pipelines reuse generated mora given names and never render literal species", () => {
  const generated = generateName(creatureDefinition, ["en", "ja"], new Set(), { en: new Set(), ja: new Set() }, {
    creature_family: "CANINE",
    species: "fox",
    creature_color_primary: "white",
  });
  assert.match(generated.fileStem, /^[a-z]+-(?:white|soft|wild|bright|swift)(?:tail|paw|fang|ear)$/);
  assert.match(generated.shortName.en, /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.doesNotMatch(generated.shortName.en, /fox/i);
  assert.ok(Array.isArray(generated.components.given.mora));
  assert.match(generated.components.given.fullStem, /^[a-z]+$/);
});

test("creature bynames use semantic Japanese vocabulary instead of phonetic English", () => {
  let whiteName;
  for (let attempt = 0; attempt < 100 && !whiteName; attempt += 1) {
    const generated = generateName(creatureDefinition, ["en", "ja"], new Set(), { en: new Set(), ja: new Set() }, {
      creature_family: "CANINE",
      species: "fox",
      creature_color_primary: "white",
    });
    if (generated.components.byname.prefix === "white") whiteName = generated;
  }
  assert.ok(whiteName);
  assert.match(whiteName.shortName.ja, /・白い(?:尾|肉球|牙|耳)$/u);
  assert.doesNotMatch(whiteName.shortName.ja, /ホワイト|テイル/u);
});

test("arachnids use the generic arthropod pool and absent metadata falls back", () => {
  const spider = generateName(creatureDefinition, ["en"], new Set(), { en: new Set() }, {
    creature_family: "ARACHNID",
    species: "spider",
  });
  assert.equal(spider.components.byname.family, "arthropod");
  assert.ok(["web", "fang"].includes(spider.components.byname.feature));

  const fallback = generateName(creatureDefinition, ["en"], new Set(), { en: new Set() });
  assert.equal(fallback.components.byname.family, "supernatural");
});

test("pipeline Japanese vocabulary is required only when Japanese is requested", () => {
  const withoutJapanese = structuredClone(rawCreatureDefinition);
  delete withoutJapanese.stages[1].prefixes.white.jaAttributive;
  const options = {
    resolveDefinition: (_schema, representations) => validateNameGenerationDefinition(rawDefinition, representations),
  };
  assert.doesNotThrow(() => validateNameGenerationDefinition(withoutJapanese, ["en"], options));
  assert.throws(
    () => validateNameGenerationDefinition(withoutJapanese, ["en", "ja"], options),
    /prefixes\.white\.jaAttributive/,
  );
});

test("the contextual name space supports a substantial batch without suffixes", () => {
  const usedNames = new Set();
  const usedShortNames = { en: new Set(), ja: new Set() };
  for (let index = 0; index < 250; index += 1) {
    const generated = generateName(creatureDefinition, ["en", "ja"], usedNames, usedShortNames, {
      creature_family: "DRAGON",
      species: "dragon",
      creature_color_primary: "blue",
      creature_color_secondary: "gold",
    });
    assert.doesNotMatch(generated.fileStem, /-\d+$/);
  }
  assert.equal(usedNames.size, 250);
  assert.equal(usedShortNames.en.size, 250);
  assert.equal(usedShortNames.ja.size, 250);
});
