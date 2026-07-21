import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { extractMetadataContext } from "./gallery-metadata-context.mjs";

const definition = JSON.parse(await readFile(
  new URL("./metadata-schemas/anime-creature-lite-v4-v1.json", import.meta.url),
  "utf8",
));

test("extracts canonical naming context through the metadata definition", () => {
  const context = extractMetadataContext({ anime_creature_lite_v4: {
    schema: "anime_creature_lite_v4/v1",
    creature_family: "CANINE",
    species: "fox",
    global_selections: {
      creature_color_primary: "white",
      creature_color_secondary: "black",
    },
  } }, definition);
  assert.equal(context.creature_family, "CANINE");
  assert.equal(context.species, "fox");
  assert.equal(context.creature_color_primary, "white");
  assert.equal(context.creature_color_secondary, "black");
});

test("missing optional metadata values produce a partial non-blocking context", () => {
  assert.deepEqual(extractMetadataContext({ anime_creature_lite_v4: {
    schema: "anime_creature_lite_v4/v1",
    creature_family: "ARACHNID",
  } }, definition), { creature_family: "ARACHNID" });
});
