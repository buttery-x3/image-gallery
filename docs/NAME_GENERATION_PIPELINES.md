# Contextual name generation pipelines

Contextual naming is an optional, per-source-schema extension of ordinary declarative name generation. The batcher remains unaware of creatures, people, species, or naming styles: a `pipeline/v1` definition composes named stages from canonical metadata tags, and `gallery.config.json` explicitly opts a source schema into that behavior.

## Data flow

```text
source JSON
    -> metadata-schemas/<definition>.json
    -> canonical tag context
    -> name-generation-schemas/<pipeline>.json
    -> filename and optional EN/JA display names
```

The metadata definition is the only layer that knows source JSON paths. Both gallery filters and contextual names consume the same canonical tags, so a naming definition can be reused with another source format that maps equivalent data to those tags. Contextual values are extracted from the already parsed sidecar; the name generator does not reopen metadata or interpret raw schema fields.

## Enable a pipeline

Pipeline execution is disabled unless the source policy contains the explicit flag:

```json
{
  "metadata": {
    "schemas": {
      "anime_creature_lite_v4/v1": {
        "enabled": true,
        "category": "creatures",
        "nameGeneration": {
          "definition": "image-gallery/name-generator/creature-byname/v1",
          "pipeline": "contextual/v1",
          "shortNames": ["en", "ja"]
        }
      }
    }
  }
}
```

`category` is independent product configuration. It is not available to a naming pipeline and is not a substitute for canonical metadata tags.

Use the onboarding command to validate, preview against representative source JSON, and attach a pipeline:

```sh
npm run process-new-name-schema -- \
  --definition name-generation-schemas/creature-byname-v1.json \
  --attach-to anime_creature_lite_v4/v1 \
  --pipeline contextual/v1 \
  --short-names en,ja \
  --sample-dir /path/to/representative-metadata \
  --preview 10
```

The command reads samples, updates only `gallery.config.json`, and never modifies the samples or `gallery/`. Because `--attach-to` writes the policy after a successful preview, review the command and definition in version control before running it in another environment.

## Pipeline stages

`pipeline/v1` currently supports four feature-neutral stage types:

- `generator-component/v1` reuses the `given` or `family` component from a `mora-pair/v1` definition. The creature definition uses the exact waifu given-name pools and construction rules, including its configured range of short lengths.
- `contextual-compound/v1` chooses a prefix and feature from declarative family, species, trait, and fallback mappings.
- `contextual-pool/v1` selects a complete token from the first matching canonical context value, with a required fallback pool.
- `compose-name/v1` joins prior stage outputs into a filesystem stem and requested display representations.

Stages produce a filesystem-safe stem, representation text, and optional provenance data. The composer is therefore suitable for other contextual naming methods without adding domain rules to the batcher.

The bundled creature pipeline is a concrete example. It maps source family values to generic pools (`furry`, `scaled`, `feathered`, `aquatic`, `arthropod`, `smooth`, and `supernatural`), restricts feature choices when a known species is available, and weights prefixes that match available color tags. Arachnids use the arthropod pool and bats use the furry pool. Literal species names are never rendered.

## Missing context and language rules

Every canonical tag referenced by a configured pipeline must be declared by the source metadata definition. This is a configuration error and blocks processing before files move.

Values themselves are optional. Missing family, species, or trait values use declarative defaults and fallback pools, so incomplete records remain processable. This makes family-aware naming the baseline and trait-aware naming an enhancement.

English tokens use the configured display words. Japanese contextual tokens must provide semantic Japanese vocabulary such as an attributive prefix and noun; the generator does not transliterate English byname sounds into katakana. The reused mora given name remains katakana. Japanese vocabulary is validated only when `ja` is requested in the source policy.

## Uniqueness and sidecars

Pipeline filenames use their composed short components, for example `mika-whitetail`. The generator checks both the complete filename stem and requested display representations against names already reserved for the batch. It retries generation up to 1,000 times and fails clearly if the configured name space is exhausted; it never appends a numeric suffix.

Generated `image-gallery/name/v2` sidecars may include a generic `components` object containing pipeline provenance. New batches receive this automatically. Existing images are never renamed or backfilled automatically, and pipeline display names cannot be reconstructed safely from a filename alone. Use `rename-existing` only when an intentional migration is required.
