# Image Gallery

A small, private, self-hosted image gallery. Copy images and GIFs into a folder, refresh the page, and they are displayed in a full-width masonry gallery. Search is available in the header, with advanced metadata filters when matching JSON sidecars are present.

Gallery media is shown at exactly 300px wide with its natural height. Clicking an image opens it against a dark lightbox. On desktop, hover actions can copy either the image itself or its direct public URL; mobile relies on native image controls.

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
| `GALLERY_TITLE` | `Image Gallery` | Page heading, document title, and social-preview title (applied at build time) |
| `GALLERY_DESCRIPTION` | `A simple private image gallery.` | Description used in browser and social metadata (applied at build time) |
| `SITE_URL` | unset | Full public gallery URL used for canonical and absolute social-preview URLs (applied at build time) |
| `BATCH_NAME_STYLE` | unset | Set to `japanese-fantasy` to generate long fantasy names while batching |
| `PM2_APP_NAME` | unset | Existing PM2 process name restarted by `deploy.sh`; must be set per instance |
| `HOST` | `127.0.0.1` | Address used by the Express server |
| `PORT` | `8080` | Port used by the Express server |

Hidden entries, symbolic links, and unsupported files are ignored. New files appear after a page refresh; no rebuild is required. Images near the viewport are loaded first, then loading continues through the full gallery in the background with no more than four media files loading concurrently.

Images may have a same-name JSON sidecar in the same directory. The `anime_waifu_lite/v1` format is used for prompt search and advanced tag filters; invalid, unsupported, or missing metadata does not prevent the image from appearing. Every image also exposes its filename stem as a searchable display name. The containing subdirectory is available as a Batch filter.

Enable **Searchable only** in the header to temporarily hide images that do not yet have supported metadata.

GIF and PNG tiles use automatically generated 300px-wide lossy WebP previews. GIF previews remain animated, and WebP preserves PNG transparency. Previews are created on first view and cached outside the gallery; the original file is still used in the lightbox and by the desktop Copy image/Copy link controls.

To organize every root-level image into a timestamped batch and cache only that batch's missing previews, run this while the server is running:

```sh
bash ./process-batch.sh
```

Images without JSON metadata are included. When a same-name JSON sidecar is present, it is validated and moved alongside its image. Orphaned or invalid JSON stops the batch before anything moves. Before moving anything, the batcher indexes existing metadata and file sizes, then SHA-256 hashes only plausible same-size duplicate candidates. Exact duplicate image/JSON pairs are moved recoverably into `GALLERY_DIR/.duplicates/<timestamp>/`, which remains hidden from the site; metadata matches with different image content stay in the normal batch and are reported. Duplicate images are also detected when metadata is missing or has changed.

When `BATCH_NAME_STYLE=japanese-fantasy` is set, each unique image and sidecar receives the same generated name during the move. Existing previews remain valid across moves and renames, and only missing previews are requested, with up to four concurrent requests.

Use `bash ./process-batch.sh --dry-run` to inspect the proposed batch and duplicate quarantine without changing files, or pass the public base URL as the final argument when the service is not available on its configured local port. Running the command when there are no root-level images checks the full gallery and generates only missing previews, which also provides the retry path if preview warming previously failed.

To force a one-time rename of every image already inside a batch directory, first enable the same naming style and preview the complete mapping:

```sh
bash ./rename-existing.sh --dry-run
bash ./rename-existing.sh
```

Root-level incoming files are left alone by this alternate command. Existing same-name sidecars are validated and renamed with their images, and cached previews are copied to their new cache keys instead of being regenerated. Re-running the command intentionally generates a fresh set of names.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite frontend and Express server with live reload |
| `npm run typecheck` | Check browser and server TypeScript |
| `npm run build` | Compile the browser and server production output |
| `npm start` | Run the compiled production server |
| `bash ./process-batch.sh` | Organize root-level uploads and generate only missing previews |
| `bash ./rename-existing.sh` | Force generated names onto images already inside batch directories |

On the Linux server described in the installation guide, deploy an update with `sudo ./deploy.sh`.

## Project layout

```text
src/server/    Express server, directory scanning, and media delivery
src/shared/    Types shared by the browser and server
src/web/       Single-page gallery interface
docs/          Installation documentation plus Caddy and systemd examples
gallery/       Default local media directory (contents are ignored by Git)
```

Future coding agents should read [AGENTS.md](AGENTS.md) before making changes.
