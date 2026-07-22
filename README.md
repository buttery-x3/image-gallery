# Image Gallery

A small, private, self-hosted image gallery. Copy images and GIFs into a folder, refresh the page, and they are displayed in a full-width masonry gallery. Search defaults to filenames; metadata search and filters can be enabled in `gallery.config.json`.

Gallery media is shown at exactly 300px wide with its natural height. Clicking an image opens it against a dark lightbox. The Slideshow button plays the currently filtered images in a randomized loop, changing every five seconds with a fade; press Escape or click the black margin to close it. On desktop, hover actions can copy either the image itself or its direct public URL; mobile relies on native image controls.

## Requirements

- Node.js 24 LTS (Node.js 22 LTS also works)
- npm
- Caddy, or another reverse proxy, for a public HTTPS site

## Quick start

```sh
npm install
copy .env.example .env
npm run dev
```

On Linux or macOS, use `cp .env.example .env` instead of `copy`.

The default media directory is `gallery/`. Put JPEG, PNG, GIF, WebP, or AVIF files there, then open `http://localhost:5173`.

## Gallery configuration

Edit [`gallery.config.json`](gallery.config.json) before building or starting the development server:

| Setting | Default | Description |
| --- | --- | --- |
| `siteName` | `Image Gallery` | Page heading, browser title, and social-preview title |
| `searchMetadata` | `false` | When enabled, search also indexes cached JSON metadata and generated names; otherwise it searches filenames only |
| `showTypeToggle` | `false` | Show the schema-driven gallery type selector when at least two configured types are present |
| `showLanguageToggle` | `false` | Show the EN / JP interface-language control |
| `showNames` | `false` | Show image names in tiles and the lightbox |
| `metadata.schemas` | configured per schema | Enables source schemas and optionally assigns a display type, category, and name generator |
| `enableReporting` | `false` | Show controls for reporting an image as explicit content |
| `enableSupportEmbed` | `false` | Allow a locally configured support/donation embed; an `.env` override and private HTML file can enable it for one deployment |
| `showWatermark` | `true` | Show the watermark in the lightbox |
| `watermarkText` | `waiaifu.lol` | Text shown in the lightbox watermark |
| `watermarkPosition` | `bottom-right` | Watermark corner: `top-left`, `top-right`, `bottom-left`, or `bottom-right` |

Each configured `typeLabel` also provides a direct gallery path using its lowercase URL slug. For example, `Waifus` is available at `/waifus` and `Beastais` at `/beastais`. Opening one of these paths selects that type immediately; changing the type selector updates the path, and selecting **All** returns to the gallery root. Direct paths continue to work behind a stripped reverse-proxy prefix.

The file is intentionally conservative for a fresh clone: metadata search, the language toggle, and image names are disabled. Rebuild after changing browser-facing settings and restart the server after changing metadata schema policies. Runtime and deployment settings such as `GALLERY_DIR`, `PORT`, and SMTP credentials remain in `.env` or the service environment.

Support embeds are also private and disabled for fresh clones. To enable one deployment without committing account-specific markup, set `ENABLE_SUPPORT_EMBED=true`, keep the fragment at `.private/support-embed.html`, and rebuild. The fragment is inserted into the existing responsive header/card placement and may contain trusted third-party embed markup. If it loads scripts from another origin, list each origin in `SUPPORT_SCRIPT_ORIGINS` so the server can add it to the Content Security Policy. The entire `.private/` directory is ignored by Git; the build fails if support is enabled but its fragment is missing or empty.

## Production build

```sh
npm ci
npm run typecheck
npm run build
npm start
```

The server listens on `127.0.0.1:8080` by default. See [docs/INSTALL.md](docs/INSTALL.md) for a complete Linux, systemd, and Caddy installation.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GALLERY_DIR` | `./gallery` | Directory scanned recursively for media |
| `PREVIEW_CACHE_DIR` | `./.cache/previews` | Directory outside the gallery for generated GIF and PNG WebP previews |
| `GALLERY_DESCRIPTION` | `A simple private image gallery.` | Description used in browser and social metadata (applied at build time) |
| `SITE_URL` | unset | Full public gallery URL used for canonical and absolute social-preview URLs (applied at build time) |
| `ENABLE_SUPPORT_EMBED` | value from `gallery.config.json` | Optional `true`/`false` deployment override for the support embed (applied at build and runtime) |
| `SUPPORT_EMBED_FILE` | `.private/support-embed.html` | Ignored, trusted HTML fragment inserted when the support embed is enabled (applied at build time) |
| `SUPPORT_SCRIPT_ORIGINS` | unset | Space- or comma-separated script origins required by the private embed's CSP (applied at runtime) |
| `PM2_APP_NAME` | unset | Existing PM2 process name restarted by `deploy.sh`; must be set per instance |
| `HOST` | `127.0.0.1` | Address used by the Express server |
| `PORT` | `8080` | Port used by the Express server |
| `REPORT_LIST_PATH` | `./reported-image-paths.txt` | Local file that receives one absolute media path per explicit-content report |

Hidden entries, symbolic links, and unsupported files are ignored. New files appear after a page refresh; no rebuild is required. Images near the viewport are loaded first, then loading continues through the full gallery in the background with no more than four media files loading concurrently.

Images may have a same-name JSON sidecar in the same directory. Batching preserves any valid JSON sidecar regardless of its schema. Definitions under `metadata-schemas/` normalize enabled schemas into common gallery tags; `gallery.config.json` assigns display types, product categories, and optional name generation to each source schema. Unsupported, disabled, or missing metadata does not prevent the image from appearing. When `showTypeToggle` is enabled, the top selector contains **All** plus one `typeLabel` for each configured source schema actually present in the gallery. It is hidden when fewer than two configured types are present; eight present schemas produce eight independent type choices. Advanced filters continue to combine canonical tags across every enabled schema. Every image exposes its filename stem to the default filename search. The containing subdirectory is available as a Batch filter.

The included configuration labels `anime_waifu_lite/v1` as **Waifus** and `anime_creature_lite_v4/v1` as **Beastais**. Waifus use the direct mora-pair generator. Beastais explicitly opt into a contextual pipeline that reuses the same given-name construction but replaces the human family name with a family- and trait-aware byname, such as `Mika Whitetail`; its Japanese form combines the katakana given name with semantic Japanese trait vocabulary. A future men schema can independently use **Husbundai**. See [Metadata schemas](docs/METADATA_SCHEMAS.md), [Name generation schemas](docs/NAME_GENERATION_SCHEMAS.md), and [Contextual name generation pipelines](docs/NAME_GENERATION_PIPELINES.md).

When configured short-name representations are requested, generated names also receive a `<long-name>.gallery-name.json` sidecar using the `image-gallery/name/v2` schema. It records the source metadata schema, generator schema, and whichever of `en` and `ja` were requested. Legacy `image-gallery/name/v1` sidecars remain readable. When `showNames` is enabled, available names appear in tiles and lightbox overlays; if the selected language is absent, the gallery falls back to the other representation and then the filename. Generated names become searchable when `searchMetadata` is enabled.

GIF and PNG tiles use automatically generated 300px-wide lossy WebP previews. GIF previews remain animated, and WebP preserves PNG transparency. Previews are created on first view and cached outside the gallery; the original file is still used in the lightbox and by the desktop Copy image/Copy link controls.

To organize every root-level image into a timestamped batch and cache only that batch's missing previews, run this while the server is running:

```sh
bash ./process-batch.sh
```

Images without JSON metadata are included. When a same-name JSON sidecar is present, its JSON syntax is validated and it is moved alongside its image without requiring a recognized schema. Source JSON without a same-name image is skipped, moved recoverably into `GALLERY_DIR/.duplicates/<timestamp>/`, and counted in the batch report so valid pairs can continue. Invalid JSON paired with an image still stops the batch before anything moves. Before moving anything, the batcher indexes existing metadata and file sizes, then SHA-256 hashes only plausible same-size duplicate candidates. Exact duplicate image/JSON pairs use the same hidden quarantine; metadata matches with different image content stay in the normal batch and are reported. Duplicate images are also detected when metadata is missing or has changed.

For each incoming image, the batcher reads the source metadata schema and applies its `nameGeneration` policy from `gallery.config.json`. Schemas without that policy retain their original filenames. A policy may generate filenames only or also request `en`, `ja`, or both short-name representations. Advanced contextual generation requires the explicit per-source `pipeline: "contextual/v1"` flag. It consumes canonical tags from that source's metadata definition and gracefully falls back when optional record values are absent. Composed names are checked for filename and display-name collisions and retried without numeric suffixes. Existing previews remain valid across moves and renames, and only missing previews are requested, with up to four concurrent requests. The removed `BATCH_NAME_STYLE` variable now produces a migration error instead of being silently ignored.

Use `bash ./process-batch.sh --dry-run` to inspect the proposed batch and duplicate quarantine without changing files, or pass the public base URL as the final argument when the service is not available on its configured local port. Running the command when there are no root-level images checks the full gallery and generates only missing previews, which also provides the retry path if preview warming previously failed.

New configuration affects new batches only during normal processing. To force a one-time rename of existing batched images whose source schemas have name generation configured, preview the complete mapping first:

```sh
bash ./rename-existing.sh --dry-run
bash ./rename-existing.sh
```

Root-level incoming files are left alone by this alternate command. Existing same-name sidecars are validated and renamed with their images, and cached previews are copied to their new cache keys instead of being regenerated. Re-running the command intentionally generates a fresh set of names.

To add generated-name metadata to older, already-named batches without renaming any images, preview and then run the backfill:

```sh
npm run backfill-name-metadata -- --dry-run
npm run backfill-name-metadata
```

The backfill adds only representations requested by the current source-schema policy and already missing from a valid sidecar. It upgrades changed sidecars to v2 while retaining existing names. Filenames that cannot be parsed confidently are reported; invalid existing sidecars require manual repair and are never overwritten automatically. Contextual pipeline names cannot be reconstructed from a filename, so use the explicit rename workflow if an intentional migration is ever required.

To audit every existing batch without changing the gallery, run `npm run scan-for-duplicates` or `bash ./scan-for-duplicates.sh`. The scan hashes every supported image in non-hidden batch directories with SHA-256, reports complete matching groups, and exits with status 1 when duplicates are found. Root-level incoming files, hidden directories, and symbolic links are excluded.

Two operator-only cleanup commands are available. Both are dry runs unless `--apply` is supplied. An applied cleanup must run in an interactive terminal and requires typing the exact confirmation phrase shown by Node; there is deliberately no non-interactive override.

To remove only generated-name sidecars and the preview cache while preserving images, source JSON metadata, duplicate quarantine, and `.gitkeep`:

```sh
npm run clear-generated-artifacts
npm run clear-generated-artifacts -- --apply
```

To permanently empty the gallery—including images, source metadata, generated metadata, and `.duplicates`—and clear the preview cache:

```sh
npm run clear-gallery
npm run clear-gallery -- --apply
```

The full cleanup preserves the gallery root and `.gitkeep`. Stop the gallery service before applying either command to avoid concurrent preview generation, then restart or refresh it afterward.

To permanently remove an image, pass its absolute direct media URL to the removal command:

```sh
bash ./remove-image.sh 'https://gallery.example.com/media/2026-07-17_15-25-59/example.png'
```

The command does not prompt. It validates the URL and gallery path, then removes the original image, its matching metadata sidecars, and any current or legacy generated preview. It also accepts deployments whose media route is below a stripped prefix, such as `/image-gallery/media/...`. Run it as the account that owns the gallery files; on the documented Linux installation, use `sudo -u image-gallery bash /opt/image-gallery/remove-image.sh '<url>'`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite frontend and Express server with live reload |
| `npm run typecheck` | Check browser and server TypeScript |
| `npm run build` | Compile the browser and server production output |
| `npm start` | Run the compiled production server |
| `bash ./process-batch.sh` | Organize root-level uploads and generate only missing previews |
| `bash ./rename-existing.sh` | Force generated names onto images already inside batch directories |
| `npm run backfill-name-metadata` | Add missing EN/JP display-name sidecars without renaming images |
| `npm run process-new-schema` | Scaffold, validate, and optionally enable a declarative metadata schema |
| `npm run process-new-name-schema` | Validate, preview, and optionally attach a declarative name generator |
| `npm run clear-generated-artifacts` | Dry-run removal of generated-name sidecars and preview cache; add `-- --apply` to confirm interactively |
| `npm run clear-gallery` | Dry-run permanent removal of all gallery content and preview cache; add `-- --apply` to confirm interactively |
| `bash ./remove-image.sh '<url>'` | Permanently remove an image, its sidecars, and generated preview |
| `npm run scan-for-duplicates` / `bash ./scan-for-duplicates.sh` | SHA-256 scan all batched images and report exact duplicates |

On the Linux server described in the installation guide, deploy an update with `sudo ./deploy.sh`.

## Project layout

```text
src/server/    Express server, directory scanning, and media delivery
src/shared/    Types shared by the browser and server
src/web/       Single-page gallery interface
src/tools/     Local schema onboarding tools
metadata-schemas/ Declarative metadata-to-gallery mappings
name-generation-schemas/ Declarative filename and short-name generators
gallery-metadata-context.mjs Canonical metadata extraction for contextual naming
docs/          Installation documentation plus Caddy and systemd examples
gallery/       Default local media directory (contents are ignored by Git)
```

Future coding agents should read [AGENTS.md](AGENTS.md) before making changes.
