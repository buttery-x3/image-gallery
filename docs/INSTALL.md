# Server installation

This guide installs Image Gallery from the repository on a Linux server, runs it with systemd, and publishes it below `/image-gallery/` with Caddy.

## 1. Install prerequisites

Install Node.js 24 LTS, npm, Git, and Caddy using the method appropriate for your Linux distribution. Confirm the commands are available:

```sh
node --version
npm --version
caddy version
```

## 2. Create the service account and directories

```sh
sudo useradd --system --home /opt/image-gallery --shell /usr/sbin/nologin image-gallery
sudo mkdir -p /opt/image-gallery /srv/image-gallery/images /var/cache/image-gallery
sudo chown -R image-gallery:image-gallery /opt/image-gallery /srv/image-gallery /var/cache/image-gallery
```

Copy or clone the repository into `/opt/image-gallery`, then give the service account ownership:

```sh
sudo chown -R image-gallery:image-gallery /opt/image-gallery
```

## 3. Build the application

```sh
cd /opt/image-gallery
sudo -u image-gallery npm ci
sudo -u image-gallery npm run typecheck
sudo -u image-gallery npm run build
```

## 4. Configure the service

Create `/etc/image-gallery.env`:

```ini
GALLERY_DIR=/srv/image-gallery/images
PREVIEW_CACHE_DIR=/var/cache/image-gallery
# Optional for the waifu-gallery instance:
# BATCH_NAME_STYLE=japanese-fantasy
HOST=127.0.0.1
PORT=8080
```

Install the service definition:

```sh
sudo cp docs/image-gallery.service /etc/systemd/system/image-gallery.service
sudo systemctl daemon-reload
sudo systemctl enable --now image-gallery
sudo systemctl status image-gallery
```

The health endpoint should now respond locally:

```sh
curl http://127.0.0.1:8080/healthz
```

If Node.js is installed somewhere other than `/usr/bin/node`, update `ExecStart` in the service to the path reported by `command -v node`.

## 5. Add the Caddy route

Add the following inside the relevant site block in your Caddyfile:

```caddyfile
redir /image-gallery /image-gallery/ 308

handle_path /image-gallery/* {
    reverse_proxy 127.0.0.1:8080
}
```

Validate and reload Caddy:

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

The gallery will be available at `https://www.example.com/image-gallery/`.

To publish it at the root of a dedicated hostname instead, use:

```caddyfile
gallery.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

## 6. Add media

Copy supported files into `/srv/image-gallery/images`. Subdirectories are scanned automatically. A same-name JSON sidecar using the `anime_waifu_lite/v1` schema enables prompt search and advanced tag filters for its image.

```sh
sudo -u image-gallery cp /path/to/picture.jpg /srv/image-gallery/images/
```

Refresh the gallery page to see additions or removals. The application never modifies the media directory.

Supported formats are JPEG, PNG, GIF, WebP, and AVIF. Hidden files, hidden directories, symbolic links, and other formats are ignored.

GIF and PNG gallery tiles use automatically generated 300px-wide WebP previews. GIF previews remain animated,
and WebP preserves PNG transparency. The previews are cached in `PREVIEW_CACHE_DIR`; the original file is served
unchanged when its tile is opened or its link is copied.

For regular uploads, place the new images and any same-name JSON sidecars directly in `/srv/image-gallery/images`, then run:

```sh
sudo -u image-gallery bash /opt/image-gallery/process-batch.sh
```

The command moves every unique root-level image into one timestamped batch subdirectory and caches only that batch's missing previews. Images without metadata are included; same-name JSON sidecars are validated and moved with their images. Existing metadata and file sizes provide a cheap duplicate candidate index, and SHA-256 confirms image equality before an incoming image is rejected. Exact duplicate pairs are moved to the hidden, recoverable `.duplicates/<timestamp>/` directory; equal metadata with different image content is reported and retained. When `BATCH_NAME_STYLE=japanese-fantasy` is present, images and sidecars receive matching generated names. Existing previews remain valid across moves and renames and are skipped. Add `--dry-run` to inspect both the batch and quarantine without changing files.

To apply generated names once to images already organized into batch directories, inspect and then run the explicit alternate command:

```sh
sudo -u image-gallery bash /opt/image-gallery/rename-existing.sh --dry-run
sudo -u image-gallery bash /opt/image-gallery/rename-existing.sh
```

This command requires `BATCH_NAME_STYLE=japanese-fantasy`, leaves root-level uploads alone, and renames matching JSON sidecars with their images. Running it again deliberately replaces the generated names with new ones.

Run the same script with no root-level images to check the full gallery and generate only missing previews. This also retries preview warming after a previous service or network failure.

To permanently remove an image using the absolute direct URL copied from the gallery, run:

```sh
sudo -u image-gallery bash /opt/image-gallery/remove-image.sh 'https://www.example.com/image-gallery/media/2026-07-17_15-25-59/example.png'
```

The command does not prompt. It removes the original image, matching metadata sidecars, and its generated preview cache entries. No rebuild or service restart is required.

## Updating

From `/opt/image-gallery`:

```sh
sudo ./deploy.sh
```

The script pulls with fast-forward only, installs the locked dependencies, type-checks and builds the
application, then restarts the `image-gallery` service. It runs repository commands as the repository
owner so generated files do not become owned by root.

## Troubleshooting

View application logs:

```sh
sudo journalctl -u image-gallery -e
```

If the page reports that the gallery directory cannot be read, check that every parent directory is searchable by the `image-gallery` user and the media files are readable.

If `/image-gallery` works incorrectly but the root URL works, confirm the trailing-slash redirect and `handle_path` block are both present in Caddy.
