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
| `showLanguageToggle` | `false` | Show the EN / JP interface-language control |
| `showNames` | `false` | Show image names in tiles and the lightbox |
| `metadata.enabledSchemas` | all installed definitions | Metadata schemas normalized for categories, search, and filters |
| `enableReporting` | `false` | Show controls for reporting an image as explicit content |
| `showWatermark` | `true` | Show the watermark in the lightbox |
| `watermarkText` | `waiaifu.lol` | Text shown in the lightbox watermark |
| `watermarkPosition` | `bottom-right` | Watermark corner: `top-left`, `top-right`, `bottom-left`, or `bottom-right` |

The file is intentionally conservative for a fresh clone: metadata search, the language toggle, and image names are disabled. These settings are build-time configuration, so rebuild after changing them. Runtime and deployment settings such as `GALLERY_DIR`, `PORT`, and SMTP credentials remain in `.env` or the service environment.

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
| `BATCH_NAME_STYLE` | unset | Set to `japanese-fantasy` to generate long fantasy names while batching |
| `PM2_APP_NAME` | unset | Existing PM2 process name restarted by `deploy.sh`; must be set per instance |
| `HOST` | `127.0.0.1` | Address used by the Express server |
| `PORT` | `8080` | Port used by the Express server |
| `REPORT_LIST_PATH` | `./reported-image-paths.txt` | Local file that receives one absolute media path per explicit-content report |

Hidden entries, symbolic links, and unsupported files are ignored. New files appear after a page refresh; no rebuild is required. Images near the viewport are loaded first, then loading continues through the full gallery in the background with no more than four media files loading concurrently.

Images may have a same-name JSON sidecar in the same directory. Batching preserves any valid JSON sidecar regardless of its schema. Definitions under `metadata-schemas/` normalize enabled schemas into common gallery categories and tags; unsupported, disabled, or missing metadata does not prevent the image from appearing. The top-level All / Women / Creatures / Men selector uses each definition's category, while advanced filters combine canonical tags across every enabled schema. Every image exposes its filename stem to the default filename search. The containing subdirectory is available as a Batch filter.

The included definitions support `anime_waifu_lite/v1` as Women and `anime_creature_lite_v4/v1` as Creatures. Future formats, including a men-only generator, can be added without changing the gallery UI or batcher. See [Metadata schemas](docs/METADATA_SCHEMAS.md) for the definition format and `process-new-schema` workflow.

Generated fantasy names also receive a `<long-name>.gallery-name.json` sidecar using the `image-gallery/name/v1` schema. It stores a short English display name and its katakana equivalent. When `showNames` is enabled, the lightbox can show the full filename stem and bilingual short names, with the English text colored from the first two usable metadata colors and a white/black fallback. Lightbox controls can hide the bilingual name or cycle it through all four corners; those choices persist in the browser. A lowercase black `waiaifu.lol` mark remains at 50% opacity in the diagonally opposite corner. Both name versions become searchable when `searchMetadata` is enabled, and the EN / JP control is available when `showLanguageToggle` is enabled.

GIF and PNG tiles use automatically generated 300px-wide lossy WebP previews. GIF previews remain animated, and WebP preserves PNG transparency. Previews are created on first view and cached outside the gallery; the original file is still used in the lightbox and by the desktop Copy image/Copy link controls.

To organize every root-level image into a timestamped batch and cache only that batch's missing previews, run this while the server is running:

```sh
bash ./process-batch.sh
```

Images without JSON metadata are included. When a same-name JSON sidecar is present, its JSON syntax is validated and it is moved alongside its image without requiring a recognized schema. Orphaned or invalid JSON stops the batch before anything moves and is never deleted automatically. Before moving anything, the batcher indexes existing metadata and file sizes, then SHA-256 hashes only plausible same-size duplicate candidates. Exact duplicate image/JSON pairs are moved recoverably into `GALLERY_DIR/.duplicates/<timestamp>/`, which remains hidden from the site; metadata matches with different image content stay in the normal batch and are reported. Duplicate images are also detected when metadata is missing or has changed.

When `BATCH_NAME_STYLE=japanese-fantasy` is set, each unique image and prompt sidecar receives the same long generated name during the move. The batcher also creates generated-name metadata containing a 1–5-mora given-name prefix, a 2–4-mora family-name prefix, and the matching katakana display name. Existing previews remain valid across moves and renames, and only missing previews are requested, with up to four concurrent requests.

Use `bash ./process-batch.sh --dry-run` to inspect the proposed batch and duplicate quarantine without changing files, or pass the public base URL as the final argument when the service is not available on its configured local port. Running the command when there are no root-level images checks the full gallery and generates only missing previews, which also provides the retry path if preview warming previously failed.

To force a one-time rename of every image already inside a batch directory, first enable the same naming style and preview the complete mapping:

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

The backfill leaves existing name sidecars untouched and reports filenames that cannot be parsed confidently as generated names. Invalid existing name sidecars require manual repair and are never overwritten automatically.

To audit every existing batch without changing the gallery, run `npm run scan-for-duplicates` or `bash ./scan-for-duplicates.sh`. The scan hashes every supported image in non-hidden batch directories with SHA-256, reports complete matching groups, and exits with status 1 when duplicates are found. Root-level incoming files, hidden directories, and symbolic links are excluded.

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
docs/          Installation documentation plus Caddy and systemd examples
gallery/       Default local media directory (contents are ignored by Git)
```

Future coding agents should read [AGENTS.md](AGENTS.md) before making changes.
