import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import {
  locateMetadataRecord,
  normalizeParsedMetadata,
  validateMetadataDefinition,
  type MetadataDefinitionRegistry,
} from "./metadata-definitions.js";

function definition(fileName: string) {
  return validateMetadataDefinition(
    JSON.parse(readFileSync(path.resolve("metadata-schemas", fileName), "utf8")),
    fileName,
  );
}

function registryFor(fileName: string, enabled = true, category?: "women" | "creatures" | "men"): MetadataDefinitionRegistry {
  const selected = definition(fileName);
  return {
    definitions: new Map([[selected.schema, selected]]),
    enabledSchemas: new Set(enabled ? [selected.schema] : []),
    categories: new Map(category ? [[selected.schema, category]] : []),
    displays: new Map(),
  };
}

test("locates root and singly wrapped schema records", () => {
  assert.equal(locateMetadataRecord({ schema: "root/v1" }).schema, "root/v1");
  assert.equal(locateMetadataRecord({ wrapper: { schema: "wrapped/v1" } }).schema, "wrapped/v1");
  assert.equal(locateMetadataRecord({ first: { schema: "a/v1" }, second: { schema: "b/v1" } }).schema, undefined);
});

test("normalizes the existing women schema and respects active flags", () => {
  const result = normalizeParsedMetadata({
    schema: "anime_waifu_lite/v1",
    resolved_prompt: " prompt ",
    hair_style: " bob ",
    hair_accent: "blue tips",
    active_flags: { hair_accent_active: false },
    search_tokens: { style: [" soft ", 42] },
  }, registryFor("anime-waifu-lite-v1.json", true, "women"));

  assert.equal(result.category, "women");
  assert.equal(result.metadata?.resolvedPrompt, "prompt");
  assert.deepEqual(result.metadata?.tags, { hair_style: "bob" });
  assert.deepEqual(result.metadata?.searchTokens, { style: ["soft"] });
});

test("normalizes creature fields, selects an outfit, and omits templates", () => {
  const result = normalizeParsedMetadata({
    anime_creature_lite_v4: {
      schema: "anime_creature_lite_v4/v1",
      resolved_prompt: "creature prompt",
      gender: "man",
      species: "dragon",
      creature_family: "REPTILE",
      global_selections: {
        outfit_woman: "dress",
        outfit_man: "coat",
        hair_style: "with @@HAIR@@",
        pose: "standing",
        creature_color_primary: "green"
      }
    }
  }, registryFor("anime-creature-lite-v4-v1.json", true, "creatures"));

  assert.equal(result.category, "creatures");
  assert.equal(result.metadata?.tags.outfit, "coat");
  assert.equal(result.metadata?.tags.hair_style, undefined);
  assert.equal(result.metadata?.tags.pose, "standing");
  assert.equal(result.metadata?.tags.creature_color_primary, "green");
});

test("preserves status for unsupported and disabled schemas", () => {
  const womenRegistry = registryFor("anime-waifu-lite-v1.json");
  assert.deepEqual(normalizeParsedMetadata({ schema: "future/v1" }, womenRegistry), {
    schema: "future/v1",
    supported: false,
    enabled: false,
  });

  const disabled = normalizeParsedMetadata({ schema: "anime_waifu_lite/v1" }, registryFor("anime-waifu-lite-v1.json", false));
  assert.equal(disabled.supported, true);
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.metadata, undefined);
});

test("detects schema-less Tenor metadata and derives configured display fields", () => {
  const selected = definition("tenor-v1.json");
  const registry: MetadataDefinitionRegistry = {
    definitions: new Map([[selected.schema, selected]]),
    enabledSchemas: new Set([selected.schema]),
    categories: new Map(),
    displays: new Map([["tenor/v1", {
      nameTag: "title",
      subtitleTag: "username",
      subtitleUrlTag: "username_url",
    }]]),
  };
  const result = normalizeParsedMetadata({
    id: "85887463331712354",
    title: " Reaching Stare ",
    username: "strangerthings",
    user_url: "https://tenor.com/users/strangerthings",
    tenor_url: "https://tenor.com/view/reaching-stare-gif-14538912",
    tags: ["reaching", "stare"],
  }, registry);

  assert.equal(result.schema, "tenor/v1");
  assert.deepEqual(result.metadata?.searchTokens, {});
  assert.deepEqual(result.metadata?.facets, { tags: ["reaching", "stare"] });
  assert.deepEqual(result.metadata?.tags, {
    tenor_id: "85887463331712354",
    title: "Reaching Stare",
    username: "strangerthings",
    username_url: "https://tenor.com/users/strangerthings",
    tenor_url: "https://tenor.com/view/reaching-stare-gif-14538912",
  });
  assert.deepEqual(result.metadataDisplay, {
    name: "Reaching Stare",
    subtitle: "strangerthings",
    subtitleUrl: "https://tenor.com/users/strangerthings",
  });
});

test("rejects invalid definitions", () => {
  assert.throws(() => validateMetadataDefinition({ definitionVersion: 1, draft: "yes", schema: "x/v1", tags: {} }));
  assert.throws(() => validateMetadataDefinition({ definitionVersion: 1, schema: "x/v1", tags: { "Bad Tag": { path: "x" } } }));
  assert.throws(() => validateMetadataDefinition({ definitionVersion: 1, schema: "x/v1", detect: { requiredPaths: [] }, tags: {} }));
});
