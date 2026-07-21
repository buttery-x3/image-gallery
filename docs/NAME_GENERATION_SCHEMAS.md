# Name generation schemas

Name generation is routed by the source metadata schema detected in an image's ordinary same-stem JSON sidecar. Generator definitions describe how to create names; `gallery.config.json` decides which source schemas use them and which short-name representations are required.

## Attach a generator

Place a definition in `name-generation-schemas/`, validate it, and preview a few generated filenames:

```sh
npm run process-new-name-schema -- --definition name-generation-schemas/example-v1.json --preview 5
```

Attach it to an enabled source metadata schema and request English, Japanese, or both:

```sh
npm run process-new-name-schema -- --definition name-generation-schemas/example-v1.json --attach-to example/v1 --short-names en,ja --preview 5
```

The attachment command updates only `gallery.config.json`; it never reads or writes `gallery/`. Omit `--short-names` to generate filesystem names without creating display-name sidecars. Omitting `nameGeneration` from a source policy retains original filenames. One generator definition can be attached to several source schemas, and different source schemas can use different generators simultaneously.

For a `pipeline/v1` definition, contextual execution must be opted into explicitly. Representative metadata can be supplied to exercise its real canonical context during preview:

```sh
npm run process-new-name-schema -- --definition name-generation-schemas/creature-byname-v1.json --attach-to anime_creature_lite_v4/v1 --pipeline contextual/v1 --short-names en,ja --sample-dir /path/to/examples --preview 10
```

See [Contextual name generation pipelines](NAME_GENERATION_PIPELINES.md) for the data flow, stage types, fallback behavior, and semantic Japanese requirements.

The equivalent configuration is:

```json
{
  "metadata": {
    "schemas": {
      "example/v1": {
        "enabled": true,
        "category": "men",
        "nameGeneration": {
          "definition": "image-gallery/name-generator/example/v1",
          "shortNames": ["en", "ja"]
        }
      }
    }
  }
}
```

## Definition format

The included `waifu-japanese-fantasy-v1.json` definition is the canonical working example. Version 1 uses the small `mora-pair/v1` engine:

```json
{
  "definitionVersion": 1,
  "schema": "image-gallery/name-generator/example/v1",
  "engine": "mora-pair/v1",
  "fileName": {
    "partSeparator": "-",
    "givenMiddleCount": 7,
    "familyMiddleCount": 8
  },
  "representations": {
    "en": {
      "partSeparator": " ",
      "capitalizeParts": true,
      "givenMoraRange": [1, 5],
      "familyMoraRange": [2, 4]
    },
    "ja": {
      "partSeparator": "・",
      "script": "katakana"
    }
  },
  "weights": {
    "middleCommon": 6,
    "initialCommon": 3
  },
  "mora": {
    "middle": ["ka", "ki", "ku"],
    "common": ["ka", "ki"],
    "initialExcluded": [],
    "ending": ["kaku"],
    "katakana": { "ka": "カ", "ki": "キ", "ku": "ク" }
  }
}
```

- `fileName` controls the long, filesystem-safe stem.
- `mora.middle`, `common`, and `ending` provide and weight name components.
- `representations.en` controls shortened romanized display names.
- `representations.ja` plus `mora.katakana` controls Japanese display names.
- Representation data is validated only when that representation is requested in config. Japanese mappings therefore do not block an English-only or filename-only source schema.

Invalid configured definitions and missing requested representation rules stop processing before files move. Definitions that are installed but unused do not affect batching.

The second bundled definition, `creature-byname-v1.json`, uses the composable `pipeline/v1` engine. Its given-name stage references the canonical waifu generator, while its byname stage uses canonical metadata tags. Dependencies are resolved by schema ID from `name-generation-schemas/` and validated together.

## Sidecars and migration

New short names use `image-gallery/name/v2` sidecars with source and generator provenance. Either `en` or `ja` may be present, and pipeline-generated sidecars may also carry generic component provenance. Existing `image-gallery/name/v1` sidecars remain readable and are retained when name generation is disabled. Direct mora-pair backfill writes v2 only when a configured representation is missing; it preserves existing valid names and warns about records it cannot update safely. Contextual pipeline names require generation-time metadata and are not reconstructed from existing filenames.

`BATCH_NAME_STYLE` has been removed. If it is still present, the batcher exits with instructions to move the selection into `metadata.schemas.<source-schema>.nameGeneration`.
