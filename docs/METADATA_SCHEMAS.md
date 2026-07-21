# Metadata schemas

The gallery keeps file organization separate from metadata interpretation. `process-gallery-batch.mjs` accepts any syntactically valid same-stem JSON sidecar and preserves it with the image. Definition files in `metadata-schemas/` decide how source schemas provide search data, filters, prompt details, and canonical context for an explicitly enabled name-generation pipeline. Product category and naming behavior are assigned separately in `gallery.config.json`.

## Enable schemas

`gallery.config.json` configures each source schema:

```json
{
  "showTypeToggle": true,
  "metadata": {
    "schemas": {
      "anime_waifu_lite/v1": { "enabled": true, "typeLabel": "Waifus", "category": "women" },
      "anime_creature_lite_v4/v1": { "enabled": true, "typeLabel": "Beastais", "category": "creatures" },
      "future_men/v1": { "enabled": false, "typeLabel": "Husbundai", "category": "men" }
    }
  }
}
```

When `metadata.schemas` is omitted, every non-draft definition is enabled without a product category. An unknown or explicitly disabled schema is preserved but is not normalized. Its image remains visible under **All**.

`typeLabel` is the browser-facing name for that exact source schema. With `showTypeToggle: true`, only labels whose schemas are present in the current gallery are rendered. The selector is hidden with zero or one present type. Each schema remains a distinct fast bucket, so eight present configured schemas produce eight type choices without scanning tags.

Category remains a separate product-level policy independent of reusable tag mappings and the schema type selector. A male creature source can remain in `creatures`; a future men-only source can be assigned to `men` while displaying the label `Husbundai`.

## Add a schema

Scaffold a draft from one representative sample:

```sh
npm run process-new-schema -- --sample /path/to/example.json --scaffold --output metadata-schemas/example-v1.json
```

The draft lists discovered string leaf paths but deliberately does not guess their meanings. Map the useful paths into canonical tags, remove `"draft": true`, and validate it:

```sh
npm run process-new-schema -- --definition metadata-schemas/example-v1.json --sample /path/to/example.json
```

Validate broader coverage before enabling it:

```sh
npm run process-new-schema -- --definition metadata-schemas/example-v1.json --sample-dir /path/to/examples
```

To validate and add the schema to `gallery.config.json` in one explicit step:

```sh
npm run process-new-schema -- --definition metadata-schemas/example-v1.json --sample-dir /path/to/examples --enable --category men --type-label Husbundai
```

The tool reads samples but never changes them or writes inside `gallery/`.

## Definition format

```json
{
  "definitionVersion": 1,
  "schema": "example/v1",
  "recordPath": "optional_wrapper",
  "resolvedPrompt": { "path": "resolved_prompt" },
  "searchTokensPath": "search_tokens",
  "tags": {
    "hair_style": { "path": "selections.hair_style" },
    "outfit": {
      "select": {
        "path": "gender",
        "cases": {
          "woman": "selections.outfit_woman",
          "man": "selections.outfit_man"
        }
      }
    },
    "trim": {
      "path": "trim",
      "excludeWhen": { "path": "active_flags.trim_active", "equals": false }
    }
  },
  "valueRules": {
    "trim": true,
    "omitEmpty": true,
    "omitContaining": ["@@"]
  }
}
```

The mapper intentionally supports a small set of operations:

- `path` reads a string through a dotted object path.
- `select` chooses a source path from the string value at another path.
- `excludeWhen` omits a value when a source field equals a scalar value.
- `resolvedPrompt` identifies the prompt string.
- `searchTokensPath` imports a record whose values are string arrays.
- `valueRules` trims values and omits empty or unresolved template strings.

Use lowercase snake-case canonical tag names. Equivalent concepts should share a name across definitions—for example, different source fields representing a scene should all map to `scene`. Schema-specific concepts such as `creature_family` may remain distinct.

Contextual name pipelines reference these canonical tag names, never raw JSON paths. A configured pipeline may require that tags such as `creature_family`, `species`, and `creature_color_primary` are declared here, while individual records may omit their values and use the pipeline's fallback pools. Adding an equivalent source format therefore means mapping its fields to the expected canonical tags and attaching the pipeline in config; no batcher code changes are required.

If a future format requires computation that cannot be expressed by these operations, add a narrowly scoped coded adapter rather than expanding the definition format into a programming language.

## Runtime behavior

Definitions are loaded from `metadata-schemas/` at server startup. Invalid definitions, duplicate schema declarations, or enabled schemas without definitions cause a clear startup error. The legacy `metadata.enabledSchemas` shape is rejected with migration guidance. Parsed sidecars are cached by path, size, and modification time; changing a sidecar causes it to be normalized again.

Compact image responses contain category and support status. Full tags and prompts remain in the detailed background response. The metadata dialog distinguishes missing, unsupported, disabled, and successfully normalized sidecars.
