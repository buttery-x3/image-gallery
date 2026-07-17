# Agent instructions

## Purpose

This repository is intentionally a small private image gallery. Keep the implementation direct and avoid adding infrastructure intended for a large production team.

## Architecture

- `src/server` contains the Node.js/Express service.
- `src/web` contains the framework-free Vite/TypeScript SPA.
- `src/shared` contains the API types shared by both sides.
- `gallery` is local content and must never be committed, modified, or deleted by application code.
- The production build is generated under `dist` and is not committed.

## Product invariants

- Gallery images are exactly 300px wide above the narrow-mobile breakpoint.
- Image height is always natural and unconstrained; never crop thumbnails.
- Gallery images have rounded corners.
- Lightbox images have square corners and use `object-fit: contain` with a viewport margin.
- GIF animation must be preserved.
- Media files must be viewport-prioritized and limited to four concurrent loads, then continue through the full gallery in the background; do not assign every image URL during initial rendering.
- The Copy link control must produce an absolute direct media URL. Copy image may fall back to that URL when image clipboard writing is unsupported.
- All browser requests must remain compatible with both `/` and a stripped Caddy prefix such as `/image-gallery/`.
- The server is read-only and must not add upload, delete, rename, or image-processing behavior unless explicitly requested.
- Hidden files and symbolic links must not be exposed.

## Scope discipline

Do not add Docker, Go, a database, authentication, CI workflows, a frontend framework, or a large test suite unless the user explicitly changes the scope.

## Before handing off changes

Run only the lightweight checks appropriate to this project:

```sh
npm run typecheck
npm run build
```

For visual changes, perform a short browser smoke check covering the gallery layout, Copy control, and lightbox. Do not introduce a browser test harness solely for that check.
