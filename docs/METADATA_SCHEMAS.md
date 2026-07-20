# Metadata schemas

The gallery keeps file organization separate from metadata interpretation. `process-gallery-batch.mjs` accepts any syntactically valid same-stem JSON sidecar and preserves it with the image. Definition files in `metadata-schemas/` decide which schemas provide gallery categories, search data, filters, and prompt details.

## Enable schemas

`gallery.config.json` may list the enabled source schemas:

```json
{
  "metadata": {
    "enabledSchemas": [
      "anime_waifu_lite/v1",
      "anime_creature_lite_v4/v1"
    ]
  }
}
```

When `enabledSchemas` is omitted, every non-draft definition is enabled. An unknown or disabled schema is preserved but is not normalized. Its image remains visible under **All**.

The definition's `category` is independent of its tags. A male creature remains in `creatures`; a future men-only generator should use a definition whose category is `men`.

## Add a schema

Scaffold a draft from one representative sample:

```sh
npm run process-new-schema -- --sample /path/to/example.json --category men --scaffold --output metadata-schemas/example-v1.json
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
npm run process-new-schema -- --definition metadata-schemas/example-v1.json --sample-dir /path/to/examples --enable
```

The tool reads samples but never changes them or writes inside `gallery/`.

## Definition format

```json
{
  "definitionVersion": 1,
  "schema": "example/v1",
  "recordPath": "optional_wrapper",
  "category": "men",
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

If a future format requires computation that cannot be expressed by these operations, add a narrowly scoped coded adapter rather than expanding the definition format into a programming language.

## Runtime behavior

Definitions are loaded from `metadata-schemas/` at server startup. Invalid definitions, duplicate schema declarations, or enabled schemas without definitions cause a clear startup error. Parsed sidecars are cached by path, size, and modification time; changing a sidecar causes it to be normalized again.

Compact image responses contain category and support status. Full tags and prompts remain in the detailed background response. The metadata dialog distinguishes missing, unsupported, disabled, and successfully normalized sidecars.
