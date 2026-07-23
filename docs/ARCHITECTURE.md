# Architecture

## Runtime boundaries

- `src/web-next` is the default Svelte 5 public gallery. Components own rendering and interaction state; framework-independent services own storage, clipboard, routing, masonry placement, and media scheduling.
- `src/web` is the retired framework-free frontend, retained only as a temporary rollback and parity reference. Normal development, production builds, and serving do not use it.
- `src/server` is the Express read-only media and catalog service.
- `src/shared` defines browser/server API contracts.
- Schema and name-generation definitions remain declarative and independent from gallery UI behavior.
- Operator tools are the only code allowed to mutate gallery media, and only through their documented safeguards.

## Catalog loading

`GET /api/v2/images` returns the compact media manifest, including intrinsic dimensions. `GET /api/v2/gallery-index` independently returns normalized search text, canonical tags, and generated short names. Full metadata remains on demand through `GET /api/image-details`.

Dimensions are read with Sharp and cached at `DIMENSION_CACHE_PATH`, which must remain outside `GALLERY_DIR`. Cache entries are invalidated by file size and modification time. The cache is derived data and can be deleted safely.

## Gallery rendering

The masonry engine is pure TypeScript. It calculates stable absolute rectangles from the catalog before image loads. A spatial bucket index selects only rectangles near the viewport, keeping DOM size bounded as the catalog grows.

One media scheduler owns URL assignment. It prioritizes viewport tiles, permits no more than four active loads, and then drains the complete catalog in the background. Virtual tile unmounting does not cancel or duplicate completed work.

The header uses CSS grid, flexbox, and container queries for its responsive rows. It does not continuously measure element widths in JavaScript. Gallery routes, type-specific routes, slideshow return links, and direct media URLs are resolved relative to the deployed base so the same build works at `/` and behind a stripped proxy prefix.

## Browser state

Existing favorites, theme, language, consent, report, and overlay storage keys remain compatible. Appearance settings use the versioned `image-gallery:appearance:v1` key and are validated atomically before use. Malformed or unknown versions fall back to the Compact + Portrait defaults.

## Extension rules

Add an interface only when current running behavior has at least one real implementation. Future capabilities belong in `ROADMAP.md` until implementation begins. Avoid commented-out implementations, placeholder endpoints, unused database clients, and speculative authentication classes.
