import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  generateName,
  generateShortNameForStem,
  validateNameGenerationDefinition,
} from "./gallery-name-generator.mjs";

const definitionPath = new URL("./name-generation-schemas/waifu-japanese-fantasy-v1.json", import.meta.url);
const rawDefinition = JSON.parse(await readFile(definitionPath, "utf8"));

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
