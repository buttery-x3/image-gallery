# Image Gallery

A small, private, self-hosted image gallery. Copy images and GIFs into a folder, refresh the page, and they are displayed in a full-width masonry gallery. Search is available in the header, with advanced metadata filters when matching JSON sidecars are present.

Gallery media is shown at exactly 300px wide with its natural height. Clicking an image opens it against a dark lightbox, while the hover Copy button copies its direct public URL.

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
| `HOST` | `127.0.0.1` | Address used by the Express server |
| `PORT` | `8080` | Port used by the Express server |

Hidden entries, symbolic links, and unsupported files are ignored. New files appear after a page refresh; no rebuild is required. Images and GIFs are loaded shortly before they enter the viewport, with no more than four media files loading concurrently.

Images may have a same-name JSON sidecar in the same directory. The `anime_waifu_lite/v1` format is used for prompt search and advanced tag filters; invalid, unsupported, or missing metadata does not prevent the image from appearing. The containing subdirectory is also available as a Batch filter.

Enable **Searchable only** in the header to temporarily hide images that do not yet have supported metadata.

GIF and PNG tiles use automatically generated 300px-wide lossy WebP previews. GIF previews remain animated, and WebP preserves PNG transparency. Previews are created on first view and cached outside the gallery; the original file is still used in the lightbox and by the Copy control.

To organize every root-level image into a timestamped batch and cache only that batch's missing previews, run this while the server is running:

```sh
npm run process-batch
```

Images without JSON metadata are included. When a same-name JSON sidecar is present, it is validated and moved alongside its image. Orphaned or invalid JSON stops the batch before anything moves. Existing previews remain valid when an image moves into its batch, and only missing previews are requested, with up to four concurrent requests.

Use `npm run process-batch -- --dry-run` to inspect the proposed move, or append the public base URL after `--` when the service is not available on its configured local port. Running the command when there are no root-level images checks the full gallery and generates only missing previews, which also provides the retry path if preview warming previously failed.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Vite frontend and Express server with live reload |
| `npm run typecheck` | Check browser and server TypeScript |
| `npm run build` | Compile the browser and server production output |
| `npm start` | Run the compiled production server |
| `npm run process-batch` | Organize root-level uploads and generate only missing previews |

On the Linux server described in the installation guide, deploy an update with `sudo ./deploy.sh`.

## Project layout

```text
src/server/    Express server, directory scanning, and media delivery
src/shared/    Types shared by the browser and server
src/web/       Single-page gallery interface
deploy/        Caddy and systemd examples
docs/          Installation documentation
gallery/       Default local media directory (contents are ignored by Git)
```

Future coding agents should read [AGENTS.md](AGENTS.md) before making changes.
